import XCTest

/// 苦手の場面を Mock で通す: 苦手の画面 → 作っている間 → できた → 「この苦手の場面で練習する」→ 待合（難易度の代わりに
/// 苦手の場面の名前）→ スタート → ラウンド。作れなかったとき（-MockWeakScene fail。数秒のバナー）も撮る。
/// 書き出し先は環境変数 WEAK_SCENE_SHOT_DIR（xcodebuild には TEST_RUNNER_WEAK_SCENE_SHOT_DIR で渡す）。無ければ何もしない
final class WeakSceneScreens: XCTestCase {
  private var outDir: URL?
  /// 撮った画像の名前の頭に付ける（端末ごとに分ける）
  private var prefix = ""

  override func setUp() {
    continueAfterFailure = false
    let env = ProcessInfo.processInfo.environment
    if let dir = env["WEAK_SCENE_SHOT_DIR"], !dir.isEmpty {
      outDir = URL(fileURLWithPath: dir)
    }
    prefix = env["WEAK_SCENE_SHOT_PREFIX"].map { "\($0)-" } ?? ""
  }

  /// 覚えた分析と場面を忘れてから、きろく → 苦手の画面を開く
  @MainActor
  private func openWeakPoints(scene behavior: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += [
      "-player.name", "Mika", "-player.color", "0", "-MockIgnoresSavedRecords", "YES", "-MockForgetWeakPoints", "YES",
      "-MockWeakScene", behavior,
    ]
    app.launch()
    XCTAssert(app.buttons["あそぶ"].waitForExistence(timeout: 20))
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'きろく'")).firstMatch.tap()
    let entry = app.buttons["苦手をぶっとばせ！"]
    XCTAssert(entry.waitForExistence(timeout: 10))
    entry.tap()
    XCTAssert(app.staticTexts["weak-title"].waitForExistence(timeout: 10))
    return app
  }

  @MainActor
  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }

  /// 作っている間 → できた → 待合 → スタートでラウンドが始まる
  @MainActor
  func testPracticeWeakScene() throws {
    guard outDir != nil else { throw XCTSkip("WEAK_SCENE_SHOT_DIR が無いので撮らない") }
    let app = openWeakPoints(scene: "ok")
    // 分析（3 秒）と場面（4 秒）の間は、作っている
    XCTAssert(element(app, "weak-scene-making").waitForExistence(timeout: 5))
    sleep(1)
    shot("s1-making")

    let ready = element(app, "weak-scene-ready")
    XCTAssert(ready.waitForExistence(timeout: 20))
    XCTAssertFalse(element(app, "weak-scene-making").exists)
    XCTAssert(ready.label.contains("苦手の場面ができました"))
    // 小さな 3D が組み上がるまで待つ
    sleep(6)
    shot("s2-ready")

    let practice = app.buttons["この苦手の場面で練習する"]
    XCTAssert(practice.exists)
    practice.tap()

    // 待合: 難易度の代わりに苦手の場面
    let panel = element(app, "lobby-practice")
    XCTAssert(panel.waitForExistence(timeout: 15))
    XCTAssertFalse(app.buttons["かんたん"].exists)
    sleep(2)
    shot("s3-lobby")

    app.buttons["スタート"].tap()
    XCTAssert(app.staticTexts["この場面を英語で説明しよう"].waitForExistence(timeout: 15))
    sleep(2)
    shot("s4-round")
  }

  /// 作れなかった: 「次はここ」のカードから場面の行を消し、画面の上に数秒だけバナーを出す（ボタンは無い）
  @MainActor
  func testWeakSceneFailed() throws {
    guard outDir != nil else { throw XCTSkip("WEAK_SCENE_SHOT_DIR が無いので撮らない") }
    let app = openWeakPoints(scene: "fail")
    XCTAssert(element(app, "weak-scene-making").waitForExistence(timeout: 5))
    let notice = element(app, "weak-scene-notice")
    XCTAssert(notice.waitForExistence(timeout: 20))
    // 3 秒で消えるので、出てくる動きが終わったらすぐ撮る（確かめは撮ったあと）
    usleep(600_000)
    shot("s5-failed-notice")
    XCTAssert(notice.label.contains("苦手の場面を作れませんでした"))
    XCTAssertFalse(element(app, "weak-scene-making").exists)
    XCTAssertFalse(element(app, "weak-scene-ready").exists)
    XCTAssertFalse(app.buttons["この苦手の場面で練習する"].exists)
    // 数秒で消え、行の無いカードが残る
    XCTAssert(notice.waitForNonExistence(timeout: 8))
    XCTAssert(element(app, "weak-next").exists)
    sleep(1)
    shot("s6-failed-after")
  }

  /// 作れた場面が部屋の置き場に無い（-MockWeakScene missing）: スタートを断られ、難易度を選ぶふつうの待合に戻って一言を出す
  @MainActor
  func testPracticeRejected() throws {
    guard outDir != nil else { throw XCTSkip("WEAK_SCENE_SHOT_DIR が無いので撮らない") }
    let app = openWeakPoints(scene: "missing")
    let practice = app.buttons["この苦手の場面で練習する"]
    XCTAssert(practice.waitForExistence(timeout: 20))
    practice.tap()
    XCTAssert(element(app, "lobby-practice").waitForExistence(timeout: 15))
    app.buttons["スタート"].tap()
    let notice = element(app, "lobby-practice-notice")
    XCTAssert(notice.waitForExistence(timeout: 10))
    XCTAssert(app.buttons["かんたん"].waitForExistence(timeout: 5))
    XCTAssertFalse(element(app, "lobby-practice").exists)
    sleep(1)
    shot("s7-lobby-rejected")
  }

  @MainActor
  private func shot(_ name: String) {
    guard let outDir else { return }
    let png = XCUIScreen.main.screenshot().pngRepresentation
    try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    try? png.write(to: outDir.appendingPathComponent("\(prefix)\(name).png"))
  }
}
