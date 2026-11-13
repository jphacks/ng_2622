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
