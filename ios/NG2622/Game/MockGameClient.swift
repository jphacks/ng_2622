import Foundation

/// 仮のデータで動く GameClient。通信せず、ほかの参加者を乱数で動かす（play.html と同じ動き）
final class MockGameClient: GameClient {
  struct Options: Equatable {
    var isHost = true
    /// 参加者の 1 人が途中で切断する
    var includesOffline = false
  }

  let isHost: Bool
  let events: AsyncStream<GameEvent>
  private let continuation: AsyncStream<GameEvent>.Continuation
  private let options: Options

  private struct Other {
    let participant: Participant
    /// ラウンド開始から話し終えるまで（秒）
    let recordingEnd: TimeInterval
    /// ラウンド開始から採点が終わるまで（秒）
    let gradingEnd: TimeInterval
    let goesOffline: Bool
  }

  private var roundStart: Date?
  private var others: [Other] = []
  /// ラウンド開始から自分の採点が終わるまで（秒）。話し終えるまでは nil
  private var selfGradingEnd: TimeInterval?
  private var lastSent: [Participant] = []
  private var ticker: Task<Void, Never>?
  private var finished = false

  private static let me = (name: "ゆうき", color: UInt32(0x5B5BE6))
  private static let names: [(String, UInt32)] = [("たろう", 0xF29A3A), ("はなこ", 0xB06AD9), ("けん", 0x2FAE9B)]

  init(options: Options) {
    self.options = options
    isHost = options.isHost
    (events, continuation) = AsyncStream.makeStream()
  }

  deinit {
    ticker?.cancel()
    continuation.finish()
  }

  func startRound() async throws {
    let start = Date()
    roundStart = start
    finished = false
    selfGradingEnd = nil
    others = Self.names.enumerated().map { i, entry in
      let recordingEnd = RoundTiming.intro + .random(in: 7...RoundTiming.recording)
      return Other(
        participant: Participant(id: "p\(i)", name: entry.0, color: entry.1, isSelf: false, status: .talking),
        recordingEnd: recordingEnd,
        gradingEnd: recordingEnd + .random(in: 2.5...6),
        goesOffline: options.includesOffline && i == Self.names.count - 1
      )
    }
    continuation.yield(.roundStarted(RoundInfo(sceneID: "park", startsAt: start)))
    publish()

    ticker?.cancel()
    ticker = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(100))
        self?.publish()
      }
    }
  }

  func finishSpeaking() async throws {
    guard selfGradingEnd == nil, let elapsed = elapsed() else { return }
    selfGradingEnd = elapsed + .random(in: 2.5...4.5)
    publish()
  }

  func closeRound() async throws {
    guard isHost else { return }
    finish(.closedByHost)
  }

  private func elapsed() -> TimeInterval? {
    roundStart.map { Date().timeIntervalSince($0) }
  }

  /// いまの状態を計算し、変わっていたら送る
  private func publish() {
    guard !finished, let r = elapsed() else { return }
    let selfStatus: Participant.Status =
      if let end = selfGradingEnd { r < end ? .grading : .done } else { .talking }
    var list = [Participant(id: "me", name: Self.me.name, color: Self.me.color, isSelf: true, status: selfStatus)]
    for other in others {
      var p = other.participant
      p.status =
        if other.goesOffline && r > RoundTiming.intro + 6 { .offline }
        else if r < other.recordingEnd { .talking }
        else if r < other.gradingEnd { .grading }
        else { .done }
      list.append(p)
    }
    if list != lastSent {
      lastSent = list
      continuation.yield(.participantsChanged(list))
    }
    // 全員の採点がそろったら終わる。切断中の人がいるときは、ホストが締め切る
    if list.allSatisfy({ $0.status == .done }) {
      finish(.allGraded)
    }
  }

  private func finish(_ reason: RoundFinishReason) {
    guard !finished else { return }
    finished = true
    ticker?.cancel()
    continuation.yield(.roundFinished(reason))
  }
}
