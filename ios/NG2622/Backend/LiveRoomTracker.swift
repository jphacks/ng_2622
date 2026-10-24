import BackendAPI
import Foundation

/// WebSocket で部屋から届いたメッセージ（ServerMessage）を、画面に渡すできごと（GameEvent）に直す。
/// 通信はせず、前に届いた内容（自分の ID・参加者・ラウンドの番号）だけを覚えておく。
///
/// 部屋は状態が変わるたびに room と progress を続けて送り、つなぎ直した人には welcome・room・round・
/// progress・results を送り直す（backend/src/durable-objects/room.ts）。同じ round と results は 2 度渡さない
struct LiveRoomTracker {
  typealias Schemas = Components.Schemas

  enum Update: Equatable {
    /// join を受け付けた。playerId と token はつなぎ直すときと、音声を送るときに使う
    case welcome(playerID: String, token: String, isHost: Bool)
    case event(GameEvent)
    /// 受け付けられなかった操作（送った本人にだけ届く）
    case error(code: Schemas.ErrorCode, message: String)
  }

  /// 自分の参加者の ID（welcome で決まる）
  private(set) var selfID: String?
  /// 部屋のコード（4 桁）
  private(set) var roomID: String?
  /// 最後に届いた room の phase
  private(set) var phase: Schemas.RoomPhase?
  /// いまか最後のラウンドの番号。音声と skip に付ける
  private(set) var round: Int?
  /// 部屋にいる人（入った順）。progress には ID と状態しか無いので、名前と色はここから引く
  private var players: [Schemas.Player] = []
  /// 結果を渡したラウンドの番号
  private var resultsRound: Int?
  /// ホストの参加者の ID（最後に届いた room の hostId）
  private var hostID: String?

  mutating func apply(_ message: Schemas.ServerMessage) -> [Update] {
    switch message {
    case .welcome(let welcome):
      selfID = welcome.playerId
      return [.welcome(playerID: welcome.playerId, token: welcome.token, isHost: welcome.isHost)]

    case .room(let room):
      let previous = phase
      let previousHost = hostID
      roomID = room.roomId
      phase = room.phase
      players = room.players
      hostID = room.hostId
      // ラウンド中と結果発表の room は、参加者の名前と色を覚えるだけ（状態は続けて届く progress で渡す）。
      // ただしホストが抜けて替わったら、新しいホストがスタート・締め切り・もう一度を押せるよう知らせる
      guard room.phase == .lobby else {
        guard let previousHost, previousHost != room.hostId else { return [] }
        return [.event(.hostChanged(isSelf: room.hostId == selfID))]
      }
      let state = RoomState(code: room.roomId, members: room.players.map(lobbyParticipant))
      // 結果発表（かラウンド中）から待合に戻った。ホストの again か、つなぎ直したら戻っていた
      if let previous, previous != .lobby { return [.event(.returnedToLobby(state))] }
      return [.event(.room(state))]

    case .round(let message):
      // つなぎ直したときに届く、同じラウンドの round は渡さない（録音の画面からやり直しにならないよう）
      guard message.round != round else { return [] }
      round = message.round
      let info = RoundInfo(sceneID: message.sceneId, startsAt: Self.date(fromMilliseconds: message.startAt))
      return [.event(.roundStarted(info))]

    case .progress(let progress):
      guard progress.round == round else { return [] }
      let list = progress.players.compactMap { entry -> Participant? in
        guard let player = players.first(where: { $0.id == entry.id }) else { return nil }
        var p = participant(player)
        p.status = Self.status(entry.status)
        return p
      }
      return [.event(.participantsChanged(list))]

    case .results(let results):
      guard results.round != resultsRound else { return [] }
      resultsRound = results.round
      return [.event(.results(RoundResults(results, selfID: selfID)))]

    case .error(let error):
      return [.error(code: error.code, message: error.message)]
    }
  }

  /// 待合での参加者。つながっていない人は切断中
  private func lobbyParticipant(_ player: Schemas.Player) -> Participant {
    var p = participant(player)
    p.status = player.connected ? .connected : .offline
    return p
  }

  private func participant(_ player: Schemas.Player) -> Participant {
    Participant(
      id: player.id, name: player.name, color: Self.color(player.color), isSelf: player.id == selfID,
      isHost: player.isHost, status: .connected)
  }

  static func status(_ status: Schemas.PlayerStatus) -> Participant.Status {
    switch status {
    case .talking: .talking
    case .grading: .grading
    case .done: .done
    case .offline: .offline
    }
  }

  /// 0xRRGGBB の整数。範囲の外は 0xFFFFFF に収める
  static func color(_ value: Int) -> UInt32 {
    UInt32(clamping: min(max(value, 0), 0xFFFFFF))
  }

  /// UNIX 時刻のミリ秒
  static func date(fromMilliseconds ms: Int64) -> Date {
    Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
  }
}

extension RoundResults {
  /// results を結果の画面の形にする。順位の順に並べ、採点できなかった人（rank か score が null）は最後に置く。
  /// 自分（selfID）の講評と模範表現は myReview に入れる。模範表現の日本語訳はバックエンドが返さないので空
  init(_ message: Components.Schemas.ResultsMessage, selfID: String?) {
    let rows = message.players.map { p in
      let score = p.rank == nil ? nil : p.score?.value1
      return (
        rank: score == nil ? nil : p.rank,
        result: PlayerResult(
          id: p.id, name: p.name, color: LiveRoomTracker.color(p.color), isSelf: p.id == selfID,
          score: score.map {
            PlayerResult.Score(content: $0.content, expression: $0.expression, speaking: $0.speech, total: $0.total)
          },
          transcript: p.transcript, comment: p.comment),
        modelAnswer: p.modelAnswer
      )
    }
    // バックエンドも順位の順に送るが、同じ順位の中では届いた順を保って並べ直す
    let graded = rows.enumerated()
      .filter { $0.element.rank != nil }
      .sorted { ($0.element.rank ?? 0, $0.offset) < ($1.element.rank ?? 0, $1.offset) }
      .map(\.element)
    let ungraded = rows.filter { $0.rank == nil }
    let me = graded.first { $0.result.isSelf }

    self.init(
      sceneID: message.sceneId,
      sceneName: message.sceneName.isEmpty ? SceneCatalog.name(of: message.sceneId) : message.sceneName,
      players: (graded + ungraded).map(\.result),
      myReview: me.map {
        Review(comment: $0.result.comment, modelSentence: $0.modelAnswer, modelSentenceJa: "")
      })
  }
}
