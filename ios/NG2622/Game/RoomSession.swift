import Foundation
import Observation

/// 部屋に入ってから出るまでの状態。GameClient のできごとを受けて、どの画面を出すかを決める
@Observable
final class RoomSession {
  enum Phase: Equatable {
    /// 待合
    case lobby
    /// 回転中・録音中（1 つの画面）
    case playing(RoundInfo)
    /// 話し終えて、ほかの人を待っている
    case waiting(enteredAt: Date)
    /// ラウンドが終わり、結果がそろった
    case results(RoundResults)
  }

  let me: PlayerProfile
  private(set) var isHost = false
  private(set) var phase: Phase = .lobby
  /// ホストのスタートを受けて、部屋が場面を AI で作っている。待合の画面のまま、難易度とスタートを止める
  private(set) var isGenerating = false
  /// 部屋のコード（4 桁）。入るまでは nil
  private(set) var code: String?
  /// 参加者と状態。待合では接続の状態、ラウンド中は進み具合
  private(set) var participants: [Participant] = []
  /// 自分の声の録音。ラウンドが始まると用意し、録音中の画面で録り始める
  let recorder = VoiceRecorder()

  var isRoundOver: Bool {
    if case .results = phase { true } else { false }
  }

  private let client: any GameClient
  private var listener: Task<Void, Never>?

  /// 遊んだ記録を置く所（端末の中）
  private let records: PlayRecordStore
  /// 記録に入れる場面の配置の JSON を取る所
  private let scenes: SceneLayoutStore
  /// いまのラウンドの記録の ID と始まった時刻。結果が届いたら、この ID で 1 度だけ保存する
  private var roundRecord: RoundRecord?
  /// 記録の保存（テストが終わりを待つ）
  private(set) var recordSaving: Task<Void, Never>?

  enum MoveError: Error, Equatable {
    /// いまいる部屋のコードを打った
    case sameRoom
    /// もう別の部屋に移り始めている
    case alreadyMoving
  }

  private struct RoundRecord {
    let id = PlayRecordStore.newID()
    let info: RoundInfo
    var saved = false
  }

  init(
    client: any GameClient, me: PlayerProfile, records: PlayRecordStore = .shared,
    scenes: SceneLayoutStore = SceneLayouts.store
  ) {
    self.client = client
    self.me = me
    self.records = records
    self.scenes = scenes
  }

  /// 部屋を作り、ホストとして入る
  func create() async throws {
    listen()
    code = try await client.createRoom(as: me)
    // 待つ間に届いた room があれば、それに合わせる
    isHost = participants.first(where: \.isSelf)?.isHost ?? true
  }

  /// コードの部屋に入る
  func join(code: String) async throws {
    listen()
    try await client.joinRoom(code: code, as: me)
    self.code = code
    isHost = participants.first(where: \.isSelf)?.isHost ?? false
  }

  /// 部屋から抜ける
  func leave() {
    listener?.cancel()
    recorder.discard()
    client.leaveRoom()
  }

  // MARK: - 別の部屋に移る（待合の「他のルーム」）

  /// 自分のほかに、部屋に人がいる（切断中の人も数える）。いれば、移る前に確かめる
  var hasOthers: Bool {
    participants.contains { !$0.isSelf }
  }

  /// 「他のルーム」でコードがそろったときに、次にすること
  enum MoveStep: Equatable {
    /// いまいる部屋のコード。通信せずに「いまいる部屋です」と出す
    case sameRoom
    /// ほかの人がいるので、「この部屋を抜けて、別のルームに入りますか？」と確かめてから移る
    case confirm
    /// 自分しかいないので、確かめずに移る
    case move
  }

  /// コードがそろったときに、次にすることを決める（通信しない）
  func step(for code: String) -> MoveStep {
    if code == self.code { return .sameRoom }
    return hasOthers ? .confirm : .move
  }

  /// 別の部屋に移り始めた（move を呼んだ）。移っている間は、この部屋の場面が変わる知らせを受けない
  private(set) var isMoving = false

  /// next で code の部屋に入ってから、今の部屋を抜ける。入れなければ next を後始末して投げ、今の部屋のまま
  /// （もう一度移れる）。入れたあとの抜ける（leave）は、送れなくても進める。新しい部屋には入れているので、
  /// 今の部屋の側は、つながりが切れた人として扱う（前の部屋の知らせは、抜けたときから受けない）。
  /// 今いる部屋のコードは通信せずに MoveError.sameRoom、移っている途中の 2 度目は MoveError.alreadyMoving を投げる
  func move(to code: String, with next: RoomSession) async throws {
    guard code != self.code else { throw MoveError.sameRoom }
    guard !isMoving else { throw MoveError.alreadyMoving }
    isMoving = true
    do {
      try await next.join(code: code)
    } catch {
      next.leave()
      isMoving = false
      throw error
    }
    leave()
  }

  /// ホストが難易度だけを選んでラウンドを始める。どの場面かはホストにも前もって伝えず、round で届く
  func start(difficulty: SceneDifficulty) {
    guard isHost, phase == .lobby, !isGenerating else { return }
    Task { try? await client.startRound(difficulty: difficulty) }
  }

  /// 「話し終えた」か、20 秒たった
  func finishSpeaking() {
    guard case .playing = phase else { return }
    phase = .waiting(enteredAt: Date())
    let audio = recorder.stop()
    Task { try? await client.finishSpeaking(audio: audio) }
  }

  /// ホストの「同じ顔ぶれでもう一度」
  func again() {
    guard isHost else { return }
    Task { try? await client.playAgain() }
  }

  private func listen() {
    guard listener == nil else { return }
    let events = client.events
    listener = Task { [weak self] in
      for await event in events {
        self?.handle(event)
      }
    }
  }

  /// できごとを受けて状態を変える（テストからも呼ぶ）
  func handle(_ event: GameEvent) {
    // 別の部屋に入っている途中は、この部屋の場面が変わる知らせ（作り始め・開始・結果・待合に戻る）を受けない。
    // 一瞬 2 つの部屋にいる間に、前の部屋の知らせで画面が替わらないように
    if isMoving, event.changesPhase { return }
    switch event {
    case .room(let room):
      code = room.code
      participants = room.members
      updateHost(from: room.members)
      isGenerating = false
    case .generating(let room):
      code = room.code
      participants = room.members
      updateHost(from: room.members)
      isGenerating = true
    case .roundStarted(let info):
      // 前のラウンドの録音は消す
      recorder.prepare()
      isGenerating = false
      roundRecord = RoundRecord(info: info)
      phase = .playing(info)
    case .participantsChanged(let list):
      participants = list
      updateHost(from: list)
    case .results(let results):
      phase = .results(results)
      saveRecord(of: results)
    case .returnedToLobby(let room):
      code = room.code
      participants = room.members
      updateHost(from: room.members)
      isGenerating = false
      phase = .lobby
    case .hostChanged(let isSelf):
      isHost = isSelf
    }
  }

  /// 自分の採点の結果が届いたら、遊んだ記録を端末に残す（場面の配置の JSON・自分の結果・自分の録音）。
  /// 自分が採点できなかったラウンドは残さない。同じラウンドは 1 度だけ保存する
  private func saveRecord(of results: RoundResults) {
    guard let round = roundRecord, !round.saved, round.info.sceneID == results.sceneID,
      results.me?.score != nil
    else { return }
    roundRecord?.saved = true
    // 録音は次のラウンドか退出で消える。場面を取るのを待つ間に消されないよう、先に一時のフォルダへ写しておく
    // （records/ には、記録の json を書いてから写す。録音だけが残る状態を作らない）
    let audio = recorder.recording.flatMap { Self.holdAudio($0.url, id: round.id) }
    let records = records
    let scenes = scenes
    recordSaving = Task {
      defer { if let audio { try? FileManager.default.removeItem(at: audio) } }
      do {
        // 3D を出すときに取ってあるので、ふつうは通信しない
        let scene = try await scenes.document(of: results.sceneID, room: results.room)
        guard let record = try PlayRecord(id: round.id, playedAt: round.info.startsAt, scene: scene, results: results)
        else { return }
        try records.save(record, audio: audio)
      } catch {
        recordLog.error("遊んだ記録を保存できませんでした: \(error, privacy: .public)")
      }
    }
  }

  /// 録音を、記録に写すまで一時のフォルダに取っておく。写せなければ nil（録音なしの記録になる）
  private static func holdAudio(_ url: URL, id: String) -> URL? {
    let held = FileManager.default.temporaryDirectory.appending(path: "record-\(id).wav")
    do {
      try FileManager.default.copyItem(at: url, to: held)
      return held
    } catch {
      recordLog.notice("録音を取っておけませんでした: \(error, privacy: .public)")
      return nil
    }
  }

  /// ホストは、前のホストが抜けると部屋の側で替わる。届いた一覧の自分の isHost に合わせる（自分がいなければそのまま）
  private func updateHost(from members: [Participant]) {
    if let me = members.first(where: \.isSelf) {
      isHost = me.isHost
    }
  }
}

extension GameEvent {
  /// 部屋の場面（待合・場面を作っている・プレイ・結果）を替える知らせ。参加者やホストの知らせは替えない
  var changesPhase: Bool {
    switch self {
    case .generating, .roundStarted, .results, .returnedToLobby: true
    case .room, .participantsChanged, .hostChanged: false
    }
  }
}
