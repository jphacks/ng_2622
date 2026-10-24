import Foundation

/// 仮のデータで動く GameClient。通信せず、ほかの参加者を乱数で動かす（room.html・play.html と同じ動き）。
/// 振る舞いは Config/Mock.xcconfig の値で変える（AppConfig.mock）
final class MockGameClient: GameClient {
  struct Options: Equatable {
    /// 自分のほかの参加者の数（0〜7）。参加者として入るときは、うち 1 人がホスト
    var otherPlayers = 3
    /// ほかの参加者の 1 人がラウンドの途中で切断する
    var includesOffline = false
    /// 参加者として入ったとき、ホストがスタートするまで（秒）
    var hostStartDelay: TimeInterval = 6
  }

  /// このコードだけ「部屋が見つかりません」になる
  static let missingRoomCode = "0000"

  let events: AsyncStream<GameEvent>
  private let continuation: AsyncStream<GameEvent>.Continuation
  private let options: Options

  private var code = ""
  private var isHost = false
  /// いまのラウンドのシーン
  private var roundSceneID = ""
  /// 部屋にいる人（入った順。自分も入る）
  private var members: [Participant] = []
  /// ラウンドの途中で切断する人の ID
  private var dropperID: String?
  /// 待合でほかの人が入ってくる動き
  private var joinTask: Task<Void, Never>?
  /// 参加者として入ったときの、ホストのスタート
  private var hostTask: Task<Void, Never>?

  private struct Plan {
    /// ラウンド開始から話し終えるまで（秒）
    let recordingEnd: TimeInterval
    /// ラウンド開始から採点が終わるまで（秒）
    let gradingEnd: TimeInterval
  }

  private var roundStart: Date?
  private var plans: [String: Plan] = [:]
  /// ラウンド開始から自分の採点が終わるまで（秒）。話し終えるまでは nil
  private var selfGradingEnd: TimeInterval?
  private var lastSent: [Participant] = []
  private var ticker: Task<Void, Never>?
  private var roundRunning = false

  private static let names = ["たろう", "はなこ", "けん", "さくら", "ゆうと", "みお", "そうた", "あおい"]
  /// ほかの参加者の色。自分の色は除いて使う
  private static let colors: [UInt32] = PlayerProfile.colors + [0x5FAE3C, 0xE5484D]

  init(options: Options) {
    self.options = options
    (events, continuation) = AsyncStream.makeStream()
  }

  deinit {
    joinTask?.cancel()
    hostTask?.cancel()
    ticker?.cancel()
    continuation.finish()
  }

  // MARK: - 部屋

  func createRoom(as player: PlayerProfile) async throws -> String {
    try await Task.sleep(for: .milliseconds(300))
    code = String(format: "%04d", Int.random(in: 1000...9999))
    isHost = true
    let others = makeOthers(for: player, count: options.otherPlayers, hostFirst: false)
    enter(as: player, present: [], joining: others)
    return code
  }

  func joinRoom(code: String, as player: PlayerProfile) async throws {
    try await Task.sleep(for: .milliseconds(600))
    guard code != Self.missingRoomCode else { throw GameError.roomNotFound }
    self.code = code
    isHost = false
    // ホストは先にいる。ほかの人は後から入ってくる
    let others = makeOthers(for: player, count: max(1, options.otherPlayers), hostFirst: true)
    enter(as: player, present: Array(others.prefix(1)), joining: Array(others.dropFirst()))
    // ホストは「おまかせ」でスタートする（シーンはスタートのときに決まる）
    let delay = options.hostStartDelay
    hostTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(delay))
      if Task.isCancelled { return }
      try? await self?.beginRound(sceneID: nil)
    }
  }

  func leaveRoom() {
    joinTask?.cancel()
    hostTask?.cancel()
    ticker?.cancel()
    roundRunning = false
    continuation.finish()
  }

  func startRound(sceneID: String?) async throws {
    guard isHost else { return }
    try await beginRound(sceneID: sceneID)
  }

  func playAgain() async throws {
    guard isHost, !roundRunning else { return }
    continuation.yield(.returnedToLobby(roomState()))
  }

  /// 自分のほかの参加者を作る。名前と色は自分と重ねない
  private func makeOthers(for player: PlayerProfile, count: Int, hostFirst: Bool) -> [Participant] {
    let names = Self.names.filter { $0 != player.name }
    let colors = Self.colors.filter { $0 != player.color }
    let n = min(count, RoomLimit.members - 1, names.count, colors.count)
    return (0..<n).map { i in
      Participant(
        id: "p\(i)", name: names[i], color: colors[i], isSelf: false, isHost: hostFirst && i == 0,
        status: .connected)
    }
  }

  /// 部屋に入る。present の人は先にいて、joining の人は 1 人ずつ入ってくる
  private func enter(as player: PlayerProfile, present: [Participant], joining: [Participant]) {
    let me = Participant(
      id: "me", name: player.name, color: player.color, isSelf: true, isHost: isHost, status: .connected)
    members = present + [me]
    // 切断するのは最後に入ってくる人
    dropperID = options.includesOffline ? (joining.last ?? present.last)?.id : nil
    continuation.yield(.room(roomState()))

    joinTask?.cancel()
    joinTask = Task { [weak self] in
      for p in joining {
        try? await Task.sleep(for: .seconds(.random(in: 0.8...1.6)))
        guard let self, !Task.isCancelled else { return }
        members.append(p)
        continuation.yield(.room(roomState()))
      }
    }
  }

  private func roomState() -> RoomState {
    RoomState(code: code, members: members)
  }

  // MARK: - ラウンド

  /// sceneID が nil なら「おまかせ」で、ここでランダムに選ぶ（本物は部屋の側が選ぶ）
  private func beginRound(sceneID: String?) async throws {
    guard !roundRunning else { return }
    roundSceneID = sceneID ?? SceneCatalog.randomID()
    // まだ入ってきていない人は、このラウンドには入れない
    joinTask?.cancel()
    hostTask?.cancel()
    let start = Date()
    roundStart = start
    roundRunning = true
    selfGradingEnd = nil
    lastSent = []
    plans = [:]
    for p in members where !p.isSelf {
      let recordingEnd = RoundTiming.intro + .random(in: 7...RoundTiming.recording)
      plans[p.id] = Plan(recordingEnd: recordingEnd, gradingEnd: recordingEnd + .random(in: 2.5...6))
    }
    continuation.yield(.roundStarted(RoundInfo(sceneID: roundSceneID, startsAt: start)))
    publish()

    ticker?.cancel()
    ticker = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(100))
        self?.publish()
      }
    }
  }

  /// 音声は送らない（採点は仮の結果）
  func finishSpeaking(audio: RecordedAudio?) async throws {
    guard roundRunning, selfGradingEnd == nil, let elapsed = elapsed() else { return }
    selfGradingEnd = elapsed + .random(in: 2.5...4.5)
    publish()
  }

  func closeRound() async throws {
    guard isHost else { return }
    finish()
  }

  private func elapsed() -> TimeInterval? {
    roundStart.map { Date().timeIntervalSince($0) }
  }

  /// いまの状態を計算し、変わっていたら送る
  private func publish() {
    guard roundRunning, let r = elapsed() else { return }
    let list = members.map { member in
      var p = member
      if p.isSelf {
        p.status = if let end = selfGradingEnd { r < end ? .grading : .done } else { .talking }
      } else if let plan = plans[p.id] {
        p.status =
          if member.status == .offline || (p.id == dropperID && r > RoundTiming.intro + 6) { .offline }
          else if r < plan.recordingEnd { .talking }
          else if r < plan.gradingEnd { .grading }
          else { .done }
      }
      return p
    }
    if list != lastSent {
      lastSent = list
      continuation.yield(.participantsChanged(list))
    }
    // 全員の採点がそろったら終わる。切断中の人がいるときは、ホストが締め切る
    if list.allSatisfy({ $0.status == .done }) {
      finish()
    }
  }

  private func finish() {
    guard roundRunning else { return }
    roundRunning = false
    ticker?.cancel()
    let final = lastSent
    let results = RoundResults.mock(
      sceneID: roundSceneID,
      players: final.map { (id: $0.id, name: $0.name, color: $0.color, isSelf: $0.isSelf, graded: $0.status == .done) }
    )
    // 待合に戻ったときのために、切断した人は切断中のまま、ほかの人は待合の状態に戻す
    members = final.map { p in
      var m = p
      m.status = p.status == .offline ? .offline : .connected
      return m
    }
    continuation.yield(.results(results))
  }
}
