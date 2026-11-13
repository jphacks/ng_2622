import BackendAPI
import Foundation
import Observation

/// 苦手の場面を、作る・覚える・出す。アプリ全体で 1 つ（WeakPointAnalyzer が持ち、分析の様子が変わるたびに呼ぶ）。
/// docs/design/part-generation.md。決まり（2026-11-14 リーダー）:
/// - AI の分析が届いたら、すぐ POST /weak-scenes を頼む（癖と次に試すことを付ける）。分析を作れなかったら、級と種類だけで頼む
/// - 場面は区切り（stage。内容の内訳のある記録の数 ÷ 5 の商）ごとに、作れたものを 1 つだけ。同じ区切りの中では、分析を
///   呼び直しても（種類だけで作ったあとで分析が通っても）作り直さない。区切りが替わったら「作っている」から作り直す
/// - 頼むのはアプリの中で 1 本だけ。画面を閉じても続け、開き直したら続きを出す。待つのは 100 秒まで
/// - 作れなかったら（理由を問わず）カードから場面を消し、画面が数秒のバナーで知らせる（notices）。
///   覚えた場面が無いまま苦手の画面を開き直したら、もう一度頼む（分析の「開き直すとまた頼む」と同じ。reopen）
@Observable
final class WeakSceneMaker {
  /// 苦手の画面の「次はここ」のカードに出す様子
  enum Phase: Equatable {
    /// 出さない（まだ開いていない・記録が足りない・数えられる種類が無い・すべて消した）
    case idle
    /// 作っている（AI の分析を待っている間も含む）
    case making
    /// できた
    case ready(WeakScene)
    /// 作れなかった（カードには出さない）
    case failed(WeakSceneFailure)

    /// 「次はここ」のカードに出すか（作っている・できた）
    var showsInCard: Bool {
      switch self {
      case .making, .ready: true
      case .idle, .failed: false
      }
    }
  }

  private(set) var phase = Phase.idle
  /// 作れなかった回数。画面は、知らせた数（noticed）より多ければバナーで知らせる
  private(set) var notices = 0
  /// 画面が知らせた数
  private(set) var noticed = 0

  private let client: any WeakSceneClient
  private let store: WeakSceneStore
  /// 返るまで待つ長さ（テストで縮める）
  private let timeout: Duration
  /// 覚えた場面（覚えるのに失敗したときも、メモリには残す）
  private var saved: SavedWeakScene?
  /// 作っている途中の場面と、その区切り
  private var task: Task<Void, Never>?
  private var pending: Int?
  /// いまの区切り（最後に waiting・make・makeWithoutAnalysis で渡された区切り）。違う区切りの頼みの結果は捨てる
  private var current: Int?
  /// 作れなかった区切りと理由。苦手の画面を開き直す（reopen）までは頼み直さない
  private var failure: (stage: Int, reason: WeakSceneFailure)?
  /// 最後に始めた頼み（テストで終わるまで待つため）
  private var latest: Task<Void, Never>?

  init(client: any WeakSceneClient, store: WeakSceneStore, timeout: Duration = WeakSceneClients.timeout) {
    self.client = client
    self.store = store
    self.timeout = timeout
    saved = store.load()
  }

  /// 苦手の画面を開き直した。作れなかった場面を、もう一度頼めるようにする（このあとの make などで頼む）
  func reopen() {
    failure = nil
    // 閉じている間に作れなかったことは、頼み直すので知らせない
    noticed = notices
  }

  /// 記録が足りない（4 件以下で、分析を呼ばない）。覚えた場面も忘れる
  func reset() {
    cancel()
    forgetSaved()
    failure = nil
    current = nil
    phase = .idle
  }

  /// 区切り。内容の内訳のある記録の数（total）を 5 で割った商（分析を作り直す区切りと同じ）
  static func stage(total: Int) -> Int {
    total / WeakPointAnalysis.rebuildStep
  }

  /// 新しい分析を待っている（初めて・作り直し・失敗の後の頼み直し）。その区切りの場面がもうあればそれを出し、
  /// 無ければ作っている。作っている途中の場面は止めない（1 本だけ）
  func waiting(stage: Int) {
    current = stage
    if show(stage) { return }
    // 前の区切りの頼みは止める（その結果は、画面にも weak-scene.json にも出さない）
    if task != nil, pending != stage { cancel() }
    phase = .making
  }

  /// 分析がある（届いた・覚えていた）。その区切りの場面があれば出し、無ければ癖と次に試すことを付けて頼む
  func make(analysis: WeakPointAnalysis, recent: [PlayRecord], stage: Int) {
    request(stage: stage) { WeakSceneRequestBuilder.build(analysis: analysis, recent: recent) }
  }

  /// 分析を作れなかった（429・503 も）。その区切りの場面があれば出し、無ければ級と種類だけで頼む
  func makeWithoutAnalysis(recent: [PlayRecord], stage: Int) {
    request(stage: stage) { WeakSceneRequestBuilder.build(analysis: nil, recent: recent) }
  }

  /// 画面がバナーで知らせた
  func markNoticed() {
    noticed = notices
  }

  /// 覚えた場面・この起動の間の失敗・作っている途中から、出すものが決まれば出して true
  private func show(_ stage: Int) -> Bool {
    if let saved, saved.stage == stage {
      phase = .ready(saved.scene)
      return true
    }
    if let failure, failure.stage == stage {
      phase = .failed(failure.reason)
      return true
    }
    if task != nil, pending == stage {
      phase = .making
      return true
    }
    return false
  }

  private func request(stage: Int, build: () -> Components.Schemas.WeakSceneRequest?) {
    current = stage
    if show(stage) { return }
    guard let request = build() else {
      // 数えられる種類が無い（頼めない）。出さない
      cancel()
      phase = .idle
      return
    }
    cancel()
    phase = .making
    pending = stage
    let client = client
    let timeout = timeout
    task = Task { [weak self] in
      let outcome: Result<WeakScene, WeakSceneFailure>
      do {
        outcome = .success(try await WeakSceneClients.withTimeout(timeout) { try await client.make(request) })
      } catch is CancellationError {
        return
      } catch let failure as WeakSceneFailure {
        outcome = .failure(failure)
      } catch {
        outcome = .failure(.failed)
      }
      guard let self, !Task.isCancelled else { return }
      self.finish(outcome, stage: stage)
    }
    latest = task
  }

  private func finish(_ outcome: Result<WeakScene, WeakSceneFailure>, stage: Int) {
    // 区切りが替わったあとに返った前の区切りの頼みは、覚えず、出さず、失敗でも知らせない
    guard stage == current, pending == stage else { return }
    task = nil
    pending = nil
    switch outcome {
    case .success(let scene):
      let made = SavedWeakScene(createdAt: Date(), stage: stage, scene: scene)
      do {
        try store.save(made)
      } catch {
        recordLog.notice("苦手の場面を覚えられませんでした: \(error, privacy: .public)")
      }
      saved = made
      failure = nil
      phase = .ready(scene)
    case .failure(let reason):
      failure = (stage, reason)
      phase = .failed(reason)
      notices += 1
    }
  }

  private func cancel() {
    task?.cancel()
    task = nil
    pending = nil
  }

  private func forgetSaved() {
    try? store.delete()
    saved = nil
  }

  /// 最後に始めた頼みが終わるまで待つ（テスト用）
  func waitForPending() async {
    await latest?.value
  }

  /// 「すべて消す」の前。覚えた場面を忘れ、作っている途中のものも捨てる
  func forget() {
    reset()
    notices = 0
    noticed = 0
  }
}
