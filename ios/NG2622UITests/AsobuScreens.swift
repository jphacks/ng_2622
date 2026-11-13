import XCTest

/// 最初の画面 → ホーム →「あそぶ」→ 待合 →「他のルーム」→ 別の部屋、を Mock で通しで開き、各画面を PNG に書き出す
/// （見た目の確かめ用）。続けて撮ったコマで、移った先や作った部屋で始めたラウンドの 3D が回っているかも見る。
/// 書き出し先は環境変数 ASOBU_SHOT_DIR（xcodebuild には TEST_RUNNER_ASOBU_SHOT_DIR で渡す）。無ければ何もしない
final class AsobuScreens: XCTestCase {
  private var outDir: URL?

  override func setUp() {
    continueAfterFailure = false
    if let dir = ProcessInfo.processInfo.environment["ASOBU_SHOT_DIR"], !dir.isEmpty {
      outDir = URL(fileURLWithPath: dir)
    }
  }

  /// 名前を保存していない（初めて開いた）ときから、別の部屋に移って 1 ラウンド遊ぶまで
  @MainActor
  func testFirstNameToOtherRoom() throws {
    guard outDir != nil else { throw XCTSkip("ASOBU_SHOT_DIR が無いので撮らない") }
    let app = XCUIApplication()
    app.launchArguments += ["-player.name", ""]
    app.launch()

    let begin = app.buttons["はじめる"]
    XCTAssert(begin.waitForExistence(timeout: 20))
    XCTAssertFalse(begin.isEnabled)
    XCTAssertFalse(app.buttons["設定"].exists)
    sleep(3)
    shot("1-first")
    let field = app.textFields["名前"]
    field.tap()
    field.typeText("Mika")
    sleep(1)
    shot("2-first-typed")
    begin.tap()

    let play = app.buttons["あそぶ"]
    XCTAssert(play.waitForExistence(timeout: 10))
    sleep(2)
    shot("3-home")

    // 設定で名前と色を変える
    app.buttons["設定"].tap()
    let you = app.buttons.matching(NSPredicate(format: "label CONTAINS '名前と色を変える'")).firstMatch
    XCTAssert(you.waitForExistence(timeout: 10))
    sleep(1)
    shot("4-settings")
    you.tap()
    XCTAssert(app.textFields["名前"].waitForExistence(timeout: 5))
    app.buttons["色 3"].tap()
    sleep(1)
    shot("5-settings-profile")
    app.buttons["戻る"].firstMatch.tap()
    sleep(1)
    shot("6-settings-changed")
    // すべて消すの確かめ（文の改行を見る）。消さずにやめる
    let delete = app.buttons["きろくと録音をすべて消す"]
    if delete.isEnabled {
      delete.tap()
      XCTAssert(app.buttons["消す"].waitForExistence(timeout: 5))
      sleep(1)
      shot("6b-settings-confirm")
      app.buttons["やめる"].tap()
      sleep(1)
    }
    app.buttons["戻る"].firstMatch.tap()
    XCTAssert(play.waitForExistence(timeout: 10))

    play.tap()
    let start = app.buttons["スタート"]
    XCTAssert(start.waitForExistence(timeout: 20))
    sleep(8)  // 仮の参加者が入ってくるのを待つ
    shot("7-lobby")

    // 無い部屋のコード（Mock の 0000）は、シートの中で止まる
    app.buttons["他のルーム"].tap()
    XCTAssert(app.staticTexts["他のルームに入る"].waitForExistence(timeout: 5))
    sleep(1)
    shot("8-sheet")
    for key in ["0", "0", "0", "0"] { app.buttons[key].tap() }
    XCTAssert(app.staticTexts["部屋が見つかりません"].waitForExistence(timeout: 5))
    sleep(1)
    shot("9-sheet-not-found")
    for key in ["4", "8"] { app.buttons[key].tap() }
    sleep(1)
    shot("10-sheet-typing")
    for key in ["2", "1"] { app.buttons[key].tap() }

    // ほかの人がいるので、確かめが出る。やめると待合のまま
    let enter = app.buttons["入る"]
    XCTAssert(enter.waitForExistence(timeout: 10))
    sleep(1)
    shot("11-confirm")
    app.buttons["やめる"].tap()
    sleep(1)
    XCTAssert(start.exists)
    app.buttons["他のルーム"].tap()
    XCTAssert(app.staticTexts["他のルームに入る"].waitForExistence(timeout: 5))
    for key in ["4", "8", "2", "1"] { app.buttons[key].tap() }
    XCTAssert(enter.waitForExistence(timeout: 10))
    enter.tap()

    // 移った先は参加者の待合（他のルームは出さない）。Mock のホストがスタートする
    let waiting = app.staticTexts["ホストのスタートを待っています"]
    XCTAssert(waiting.waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["他のルーム"].exists)
    sleep(1)
    shot("12-moved-lobby")
    // 場面を作るふりが終わってラウンドが始まったら、回転中と録音中を続けて撮る
    XCTAssert(waiting.waitForNonExistence(timeout: 30))
    let started = Date()
    for _ in 0..<60 {
      shot(String(format: "moved-f-%05d", Int(Date().timeIntervalSince(started) * 1000)))
    }
    finishRound(app)
    XCTAssert(play.waitForExistence(timeout: 10))

    // 確かめは通ったのに、入ると満員だった（Mock の 9999）。ホームに戻り、理由を一言出す
    sleep(2)
    play.tap()
    XCTAssert(start.waitForExistence(timeout: 20))
    sleep(2)
    app.buttons["他のルーム"].tap()
    XCTAssert(app.staticTexts["他のルームに入る"].waitForExistence(timeout: 5))
    for key in ["9", "9", "9", "9"] { app.buttons[key].tap() }
    if enter.waitForExistence(timeout: 5) { enter.tap() }
    XCTAssert(app.staticTexts["入れませんでした（満員）"].waitForExistence(timeout: 10))
    XCTAssert(play.exists)
    sleep(2)
    shot("13-home-join-failed")
  }

  /// 「あそぶ」→ スタート、と「あそぶ」→ 他のルームで移る、を 3 回ずつくり返し、回転中と録音中の場面を続けて撮る
  @MainActor
  func testPlayRotates() throws {
    guard outDir != nil else { throw XCTSkip("ASOBU_SHOT_DIR が無いので撮らない") }
    let app = XCUIApplication()
    app.launchArguments += ["-player.name", "Mika", "-player.color", "0"]
    app.launch()
    let play = app.buttons["あそぶ"]
    for round in 1...3 {
      XCTAssert(play.waitForExistence(timeout: 20))
      sleep(2)
      play.tap()
      let start = app.buttons["スタート"]
      XCTAssert(start.waitForExistence(timeout: 20))
      sleep(4)
      start.tap()
      // 場面を作るふり（3 秒）が終わってラウンドが始まったら、回転中と録音中を続けて撮る
      XCTAssert(start.waitForNonExistence(timeout: 30))
      let started = Date()
      for _ in 0..<50 {
        shot(String(format: "own%d-f-%05d", round, Int(Date().timeIntervalSince(started) * 1000)))
      }
      finishRound(app)

      XCTAssert(play.waitForExistence(timeout: 20))
      sleep(2)
      play.tap()
      XCTAssert(start.waitForExistence(timeout: 20))
      sleep(4)
      app.buttons["他のルーム"].tap()
      XCTAssert(app.staticTexts["他のルームに入る"].waitForExistence(timeout: 5))
      for key in ["5", "3", "0", String(round)] { app.buttons[key].tap() }
      let enter = app.buttons["入る"]
      if enter.waitForExistence(timeout: 5) { enter.tap() }
      let waiting = app.staticTexts["ホストのスタートを待っています"]
      XCTAssert(waiting.waitForExistence(timeout: 10))
      XCTAssert(waiting.waitForNonExistence(timeout: 30))
      let moved = Date()
      for _ in 0..<60 {
        shot(String(format: "moved%d-f-%05d", round, Int(Date().timeIntervalSince(moved) * 1000)))
      }
      finishRound(app)
    }
  }

  /// 録音中なら話し終え、結果まで進めて部屋を出る
  @MainActor
  private func finishRound(_ app: XCUIApplication) {
    let finish = app.buttons["話し終えた"]
    XCTAssert(finish.waitForExistence(timeout: 60))
    finish.tap()
    let skip = app.buttons["発表をとばす"]
    let leave = app.buttons["退出する"]
    XCTAssert(skip.waitForExistence(timeout: 90) || leave.exists)
    if skip.exists { skip.tap() }
    XCTAssert(leave.waitForExistence(timeout: 30))
    leave.tap()
  }

  @MainActor
  private func shot(_ name: String) {
    guard let outDir else { return }
    let png = XCUIScreen.main.screenshot().pngRepresentation
    try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    try? png.write(to: outDir.appendingPathComponent("\(name).png"))
  }
}
