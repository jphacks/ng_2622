import Foundation
import Observation

/// 1 ラウンドの状態。GameClient のできごとを受けて、どの画面を出すかを決める
@Observable
final class RoundSession {
  enum Phase: Equatable {
    /// ラウンドの開始を待っている
    case starting
    /// 回転中・録音中（1 つの画面）
    case playing(RoundInfo)
    /// 話し終えて、ほかの人を待っている
    case waiting(enteredAt: Date)
    /// ラウンドが終わった
    case finished
  }

  private(set) var phase: Phase = .starting
  private(set) var participants: [Participant] = []
  var isHost: Bool { client.isHost }

  /// 完了していない人（話している・採点中・切断中）の数
  var remainingCount: Int {
    participants.filter { $0.status != .done }.count
  }

  private let client: any GameClient
  private var listener: Task<Void, Never>?

  init(client: any GameClient) {
    self.client = client
  }

  /// できごとを受け始め、ラウンドを始める
  func start() {
    let events = client.events
    listener = Task { [weak self] in
      for await event in events {
        self?.handle(event)
      }
    }
    Task { try? await client.startRound() }
  }

  /// 「話し終えた」か、20 秒たった
  func finishSpeaking() {
    guard case .playing = phase else { return }
    phase = .waiting(enteredAt: Date())
    Task { try? await client.finishSpeaking() }
  }

  /// ホストが締め切る
  func close() {
    Task { try? await client.closeRound() }
  }

  private func handle(_ event: GameEvent) {
    switch event {
    case .roundStarted(let info):
      phase = .playing(info)
    case .participantsChanged(let list):
      participants = list
    case .roundFinished:
      phase = .finished
      listener?.cancel()
    }
  }
}
