import XCTest

/// App Store のスクリーンショットを撮る。Mock で一人で部屋を作り、1 ラウンドを通しで遊んで、各画面を PNG に書き出す。
/// 書き出し先は環境変数 SCREENSHOT_DIR（xcodebuild には TEST_RUNNER_SCREENSHOT_DIR で渡す）。無ければ何もしない。
/// 手順は docs/app-store/README.md の「スクリーンショット」
final class StoreScreenshots: XCTestCase {
  private var outDir: URL?

  override func setUp() {
    continueAfterFailure = false
    if let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"], !dir.isEmpty {
      outDir = URL(fileURLWithPath: dir)
    }
  }

  @MainActor
  func testCaptureStoreScreenshots() throws {
    guard outDir != nil else { throw XCTSkip("SCREENSHOT_DIR が無いので撮らない") }
    let app = XCUIApplication()
    // 名前と色は UserDefaults の引数で入れておく（キーボードを出さない）
    app.launchArguments += ["-player.name", "Mika", "-player.color", "0"]
    app.launch()

    let create = app.buttons["あそぶ"]
    XCTAssert(create.waitForExistence(timeout: 20))
    sleep(4)  // 公園のシーンが出るのを待つ
    shot("1-home")

    create.tap()
    let start = app.buttons["スタート"]
    XCTAssert(start.waitForExistence(timeout: 20))
    sleep(8)  // 仮の参加者が入ってくるのを待つ
    shot("2-lobby")

    start.tap()
    // カウントダウンのあと録音が始まる。話している最中の場面を撮る
    let finish = app.buttons["話し終えた"]
    XCTAssert(finish.waitForExistence(timeout: 60))
    sleep(5)
    shot("3-play")

    finish.tap()
    sleep(3)
    shot("4-waiting")

    let skip = app.buttons["発表をとばす"]
    let everyone = app.buttons["みんなの描写を見る"]
    XCTAssert(skip.waitForExistence(timeout: 90) || everyone.exists)
    if skip.exists { skip.tap() }
    XCTAssert(everyone.waitForExistence(timeout: 30))
    sleep(2)
    shot("5-ranking")

    everyone.tap()
    sleep(3)
    shot("6-everyone")

    app.buttons["戻る"].firstMatch.tap()
    let review = app.buttons["自分の結果を振り返る"]
    XCTAssert(review.waitForExistence(timeout: 10))
    review.tap()
    sleep(3)
    shot("7-review")
  }

  @MainActor
  private func shot(_ name: String) {
    guard let outDir else { return }
    let png = XCUIScreen.main.screenshot().pngRepresentation
    try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    try? png.write(to: outDir.appendingPathComponent("\(name).png"))
  }
}
