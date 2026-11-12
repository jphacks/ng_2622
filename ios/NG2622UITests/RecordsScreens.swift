import XCTest

/// きろく・設定の画面を Mock で通しで開き、各画面を PNG に書き出す（見た目の確かめ用）。
/// 書き出し先は環境変数 RECORDS_SHOT_DIR（xcodebuild には TEST_RUNNER_RECORDS_SHOT_DIR で渡す）。無ければ何もしない。
/// 例の記録（MOCK_SAMPLE_RECORDS）が出る Mock のビルドで動かす
final class RecordsScreens: XCTestCase {
  private var outDir: URL?

  override func setUp() {
    continueAfterFailure = false
    if let dir = ProcessInfo.processInfo.environment["RECORDS_SHOT_DIR"], !dir.isEmpty {
      outDir = URL(fileURLWithPath: dir)
    }
  }

  @MainActor
  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += ["-player.name", "Mika", "-player.color", "0"]
    app.launch()
    XCTAssert(app.buttons["部屋を作る"].waitForExistence(timeout: 20))
    return app
  }

  @MainActor
  private func recordsCard(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'きろく'")).firstMatch
  }

  /// ホーム → きろく → 横に送る → 下にスクロール → 開き直し → 設定 → 消す → きろく（0 件）
  @MainActor
  func testRecordsAndSettings() throws {
    guard outDir != nil else { throw XCTSkip("RECORDS_SHOT_DIR が無いので撮らない") }
    let app = launch()
    sleep(3)
    shot("1-home")

    recordsCard(app).tap()
    XCTAssert(app.staticTexts["りれき"].waitForExistence(timeout: 10))
    sleep(4)
    shot("2-records-top")

    // 横に送って、隣の場面にする
    let window = app.windows.firstMatch
    window.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.32))
      .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.32)))
    sleep(3)
    shot("3-records-next-scene")
    window.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.32))
      .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.32)))
    sleep(3)
    shot("3b-records-third-scene")
    for _ in 0..<2 {
      window.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.32))
        .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.32)))
      sleep(2)
    }
    // 何回か遊んだ場面（前の記録「これまで」がある）まで送る
    for _ in 0..<8 where !app.staticTexts["これまで"].exists {
      window.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.32))
        .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.32)))
      sleep(2)
    }
    XCTAssert(app.staticTexts["これまで"].exists)

    // 下にスクロールすると、場面の名前が上に残り、同じ場面の記録が続く
    window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
      .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)))
    sleep(2)
    shot("4-records-scrolled")

    // 前の記録を押して、振り返りを開き直す
    let row = app.buttons.matching(NSPredicate(format: "label CONTAINS '言えた' AND label CONTAINS '点'")).firstMatch
    XCTAssert(row.waitForExistence(timeout: 5))
    row.tap()
    sleep(4)
    shot("5-review-reopened")
    sleep(5)
    shot("5b-review-reopened-later")
    app.swipeUp()
    sleep(1)
    shot("6-review-reopened-scrolled")
    app.buttons["戻る"].firstMatch.tap()
    XCTAssert(app.staticTexts["りれき"].waitForExistence(timeout: 10))
    app.buttons["戻る"].firstMatch.tap()

    // 設定 → すべて消す
    let settings = app.buttons["設定"]
    XCTAssert(settings.waitForExistence(timeout: 10))
    settings.tap()
    let delete = app.buttons["きろくと録音をすべて消す"]
    XCTAssert(delete.waitForExistence(timeout: 10))
    sleep(1)
    shot("7-settings")
    delete.tap()
    XCTAssert(app.buttons["消す"].waitForExistence(timeout: 5))
    sleep(1)
    shot("8-settings-confirm")
    app.buttons["消す"].tap()
    sleep(2)
    shot("9-settings-deleted")
    app.buttons["戻る"].firstMatch.tap()
    XCTAssert(app.buttons["部屋を作る"].waitForExistence(timeout: 10))
    sleep(2)
    shot("10-home-empty")
    recordsCard(app).tap()
    XCTAssert(app.staticTexts["まだきろくがありません"].waitForExistence(timeout: 10))
    sleep(1)
    shot("11-records-empty")
  }

  /// きろくで 3D を出す → 戻る → 部屋を作って 1 ラウンド遊ぶ、を 3 回くり返し、回転中の場面を続けて撮る。
  /// 遊ぶ側の 3D が固まらずに回っているかを、撮ったコマの違いで見る
  @MainActor
  func testPlayAfterRecords() throws {
    guard outDir != nil else { throw XCTSkip("RECORDS_SHOT_DIR が無いので撮らない") }
    let app = launch()
    for round in 1...3 {
      recordsCard(app).tap()
      XCTAssert(app.staticTexts["りれき"].waitForExistence(timeout: 10))
      sleep(3)
      shot("play\(round)-0-records")
      app.buttons["戻る"].firstMatch.tap()
      sleep(2)
      shot("play\(round)-1-home")

      let create = app.buttons["部屋を作る"]
      XCTAssert(create.waitForExistence(timeout: 10))
      create.tap()
      let start = app.buttons["スタート"]
      XCTAssert(start.waitForExistence(timeout: 20))
      sleep(6)
      start.tap()
      // 場面を作るふり（3 秒）→ 回転（3 秒）→ 録音。その間を続けて撮る
      for frame in 0..<64 {
        shot(String(format: "play%d-f%02d", round, frame))
      }
      let finish = app.buttons["話し終えた"]
      XCTAssert(finish.waitForExistence(timeout: 60))
      finish.tap()
      let skip = app.buttons["発表をとばす"]
      let leave = app.buttons["退出する"]
      XCTAssert(skip.waitForExistence(timeout: 90) || leave.exists)
      if skip.exists { skip.tap() }
      XCTAssert(leave.waitForExistence(timeout: 30))
      leave.tap()
      XCTAssert(app.buttons["部屋を作る"].waitForExistence(timeout: 10))
    }
  }

  @MainActor
  private func shot(_ name: String) {
    guard let outDir else { return }
    let png = XCUIScreen.main.screenshot().pngRepresentation
    try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    try? png.write(to: outDir.appendingPathComponent("\(name).png"))
  }
}
