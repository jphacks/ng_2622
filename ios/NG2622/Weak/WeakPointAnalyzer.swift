import BackendAPI
import Foundation
import Observation

/// 苦手の画面の AI の分析を、作る・覚える・出す。アプリ全体で 1 つ（画面を閉じても、作っている途中の分析は捨てない）。
/// docs/design/weak-point-analysis.md の 7 章（覚える形・作り直す条件）と 9 章（失敗）
@Observable
final class WeakPointAnalyzer {
  /// いまの様子
  enum Phase: Equatable {
    /// 分析が無い（記録が 4 件以下で呼ばない）か、まだ開いていない
    case idle
    /// 作っている
    case loading
    /// 新しい分析を出している
    case ready
    /// 作れなかった。開き直すと、もう一度作る
    case failed(WeakPointFailure)
  }

  /// 画面に出す分析（新しい分析か、作り直している間・失敗したときの前回の分析）
  private(set) var analysis: WeakPointAnalysis?
  /// analysis が前回の分析か（作り直している間・失敗したとき）
  private(set) var isPrevious = false
  private(set) var phase = Phase.idle

  private let client: any WeakPointClient
  private let store: WeakPointStore
  /// 作っている途中の分析と、その元にした記録
  private var task: Task<Void, Never>?
  private var pendingIDs: [String] = []

  static let app: WeakPointAnalyzer = {
    // Mock では、起動の引数（-MockForgetWeakPoints YES）で覚えた分析を忘れてから始められる（UI テストで、作っている間を撮る）
    if AppConfig.current.mode == .mock, UserDefaults.standard.bool(forKey: "MockForgetWeakPoints") {
      try? WeakPointStore.app.delete()
    }
    return WeakPointAnalyzer(client: WeakPointClients.make(), store: .app)
  }()

  init(client: any WeakPointClient, store: WeakPointStore) {
    self.client = client
    self.store = store
  }

  /// 苦手の画面を開いたとき。records は今の全部の記録、existing は分析が返ったときの記録の ID を読み直す口
  /// （作っている間に記録が消されたら、その分析は覚えない）
  func open(records: [PlayRecord], existing: @escaping @MainActor () -> Set<String>) {
    let recent = WeakPointCounts.recent(records)
    let ids = Set(records.map(\.id))
    // 4 件以下は呼ばない。前回の分析も消す（数える分析の代わりだけにする）
    guard recent.count >= WeakPointCounts.minimumRecords else {
      task?.cancel()
      task = nil
      try? store.delete()
      analysis = nil
      isPrevious = false
      phase = .idle
      return
    }
    let stored = store.load().flatMap { $0.isUsable(existing: ids) ? $0 : nil }
    if let stored, !stored.needsRebuild(recent: recent, existing: ids) {
      task?.cancel()
      task = nil
      analysis = stored
      isPrevious = false
      phase = .ready
      return
    }
    guard let built = WeakPointRequestBuilder.build(recent: recent) else {
      analysis = stored
      isPrevious = stored != nil
      phase = .failed(.failed)
      return
    }
    // 同じ記録で作っている途中なら、それを待つ（開き直しても二重に頼まない）
    if task != nil, pendingIDs == built.recordIDs { return }
    task?.cancel()
    analysis = stored
    isPrevious = stored != nil
    phase = .loading
    pendingIDs = built.recordIDs
    let client = client
    let request = built.request
    task = Task { [weak self] in
      let outcome: Result<Components.Schemas.WeakPointResponse, WeakPointFailure>
      do {
        outcome = .success(try await WeakPointClients.withTimeout { try await client.analyze(request) })
      } catch is CancellationError {
        return
      } catch let failure as WeakPointFailure {
        outcome = .failure(failure)
      } catch {
        outcome = .failure(.failed)
      }
      guard let self, !Task.isCancelled else { return }
      self.finish(outcome, basedOn: built.recordIDs, existing: existing())
    }
  }

  private func finish(
    _ outcome: Result<Components.Schemas.WeakPointResponse, WeakPointFailure>, basedOn: [String], existing: Set<String>
  ) {
    task = nil
    pendingIDs = []
    switch outcome {
    case .success(let response):
      // 作っている間に元の記録が 1 つでも消えていたら、覚えずに捨てる
      guard basedOn.allSatisfy(existing.contains) else {
        phase = .failed(.failed)
        return
      }
      let made = WeakPointAnalysis(response, basedOn: basedOn, createdAt: Date())
      do {
        try store.save(made)
      } catch {
        recordLog.notice("苦手の分析を覚えられませんでした: \(error, privacy: .public)")
      }
      analysis = made
      isPrevious = false
      phase = .ready
    case .failure(let failure):
      phase = .failed(failure)
    }
  }

  /// 作っている途中の分析が終わるまで待つ（テスト用）
  func waitForPending() async {
    await task?.value
  }

  /// 「すべて消す」のあと。覚えている分析を忘れ、作っている途中のものも捨てる
  func forget() {
    task?.cancel()
    task = nil
    pendingIDs = []
    try? store.delete()
    analysis = nil
    isPrevious = false
    phase = .idle
  }
}
