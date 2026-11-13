import XCTest

/// きろく → 苦手の画面を Mock で開き、PNG に書き出す（見た目の確かめ用）。
/// 書き出し先は環境変数 RECORDS_SHOT_DIR（xcodebuild には TEST_RUNNER_RECORDS_SHOT_DIR で渡す）。無ければ何もしない。
/// 例の記録（MOCK_SAMPLE_RECORDS）が出る Mock のビルドで動かす
final class WeakPointsScreens: XCTestCase {
  private var outDir: URL?

  override func setUp() {
    continueAfterFailure = false
    if let dir = ProcessInfo.processInfo.environment["RECORDS_SHOT_DIR"], !dir.isEmpty {
      outDir = URL(fileURLWithPath: dir)
    }
  }

  /// samples: 例の記録の数（nil ならビルドの設定のまま）
  @MainActor
  private func launch(samples: Int? = nil) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += ["-player.name", "Mika", "-player.color", "0"]
    if let samples { app.launchArguments += ["-MockSampleRecords", "\(samples)"] }
    app.launch()
    XCTAssert(app.buttons["部屋を作る"].waitForExistence(timeout: 20))
    return app
  }

  @MainActor
  private func openRecords(_ app: XCUIApplication) {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'きろく'")).firstMatch.tap()
    XCTAssert(app.staticTexts["records-title"].waitForExistence(timeout: 10))
    sleep(3)
  }

  /// 記録が 5 件以上: きろくの下に入口が出る → 苦手の画面（上・下）→ 戻ると、きろくの 3D がまた描かれる
  @MainActor
  func testWeakPoints() throws {
    guard outDir != nil else { throw XCTSkip("RECORDS_SHOT_DIR が無いので撮らない") }
    let app = launch()
    openRecords(app)
    let entry = app.buttons["苦手をぶっとばせ！"]
    XCTAssert(entry.waitForExistence(timeout: 5))
    shot("w1-records-entry")

    entry.tap()
    let title = app.staticTexts["weak-title"]
    let opened = title.waitForExistence(timeout: 10)
    sleep(2)
    shot("w2-weak-top")
    if !opened { print(app.debugDescription) }
    XCTAssert(opened)
    XCTAssert(app.staticTexts["直近 10 回から"].exists)
    XCTAssert(app.descendants(matching: .any)["weak-next"].exists)

    // 下まで送る
    let window = app.windows.firstMatch
    for _ in 0..<3 {
      window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        .press(
          forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)),
          withVelocity: 800, thenHoldForDuration: 0.3)
    }
    XCTAssert(app.descendants(matching: .any)["weak-mistakes"].exists)
    sleep(2)
    shot("w3-weak-bottom")

    // 戻ると、きろくの選んでいた場面のまま、3D がまた描かれる
    app.buttons["戻る"].firstMatch.tap()
    let scene = app.descendants(matching: .any).matching(identifier: "record-scene").firstMatch
    XCTAssert(scene.waitForExistence(timeout: 10))
    XCTAssert(entry.waitForExistence(timeout: 5))
    let drawn = RecordsScreens.drawnTime(of: scene, since: Date(), timeout: 8)
    print("TIMING records-scene-after-weak \(drawn.map { String(format: "%.2f", $0) } ?? "not drawn")")
    shot("w4-records-after-weak")
  }

  /// きろくから苦手の画面を開く（覚えた分析を忘れてから始める。behavior は Mock の分析の振る舞い）
  @MainActor
  private func openWeakPoints(behavior: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += [
      "-player.name", "Mika", "-player.color", "0", "-MockWeakPoints", behavior, "-MockForgetWeakPoints", "YES",
    ]
    app.launch()
    XCTAssert(app.buttons["部屋を作る"].waitForExistence(timeout: 20))
    openRecords(app)
    let entry = app.buttons["苦手をぶっとばせ！"]
    XCTAssert(entry.waitForExistence(timeout: 5))
    entry.tap()
    XCTAssert(app.staticTexts["weak-title"].waitForExistence(timeout: 10))
    return app
  }

  @MainActor
  private func scrollDown(_ app: XCUIApplication, times: Int) {
    let window = app.windows.firstMatch
    for _ in 0..<times {
      window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        .press(
          forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)),
          withVelocity: 800, thenHoldForDuration: 0.3)
    }
    sleep(1)
  }

  /// AI の分析: 作っている間（灰色の仮の行と「AI が分析しています…」）→ 癖・良くなった点・次はここ
  @MainActor
  func testAnalysis() throws {
    guard outDir != nil else { throw XCTSkip("RECORDS_SHOT_DIR が無いので撮らない") }
    let app = openWeakPoints(behavior: "ok")
    XCTAssert(app.descendants(matching: .any)["weak-analyzing"].waitForExistence(timeout: 2))
    shot("a1-weak-analyzing")
    let habit = app.descendants(matching: .any).matching(identifier: "weak-habit").firstMatch
    XCTAssert(habit.waitForExistence(timeout: 15))
    XCTAssertFalse(app.descendants(matching: .any)["weak-analyzing"].exists)
    sleep(1)
    shot("a2-weak-result-top")
    scrollDown(app, times: 1)
    shot("a3-weak-result-middle")
    XCTAssert(app.descendants(matching: .any)["weak-improvement"].exists)
    scrollDown(app, times: 3)
    shot("a4-weak-result-bottom")
  }

  /// AI の分析が作れなかった: 数えた結果の「次はここ」と、短い 1 行
  @MainActor
  func testAnalysisFailed() throws {
    guard outDir != nil else { throw XCTSkip("RECORDS_SHOT_DIR が無いので撮らない") }
    let app = openWeakPoints(behavior: "fail")
    let status = app.staticTexts["weak-status"]
    XCTAssert(status.waitForExistence(timeout: 15))
    XCTAssert(status.label.hasPrefix("AI の分析を作れませんでした"))
    XCTAssertFalse(app.descendants(matching: .any)["weak-analyzing"].exists)
    sleep(1)
    shot("a5-weak-failed")
  }

  /// くり返す癖が 0 件: 「くり返す癖は見つかりませんでした」の 1 行。良くなった点と次はここは出す
  @MainActor
  func testAnalysisNoHabits() throws {
    guard outDir != nil else { throw XCTSkip("RECORDS_SHOT_DIR が無いので撮らない") }
    let app = openWeakPoints(behavior: "empty")
    XCTAssert(app.descendants(matching: .any)["weak-no-habits"].waitForExistence(timeout: 15))
    XCTAssert(app.descendants(matching: .any)["weak-improvement"].exists)
    sleep(1)
    shot("a6-weak-no-habits")
  }

  /// 記録が 4 件: 入口ごと出ない
  @MainActor
  func testNoEntryWithFourRecords() throws {
    guard outDir != nil else { throw XCTSkip("RECORDS_SHOT_DIR が無いので撮らない") }
    let app = launch(samples: 4)
    openRecords(app)
    XCTAssertFalse(app.buttons["苦手をぶっとばせ！"].exists)
    shot("w5-records-four")
  }

  @MainActor
  private func shot(_ name: String) {
    guard let outDir else { return }
    let png = XCUIScreen.main.screenshot().pngRepresentation
    try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    try? png.write(to: outDir.appendingPathComponent("\(name).png"))
  }
}
