import XCTest

/// 最初の画面 → ホーム →「あそぶ」→ 待合 →「他のルーム」→ 別の部屋（参加者の待合）、を Mock で通しで開き、各画面を PNG に書き出す
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

    // 設定の「あなた」の板の中で、名前と色を変える。戻ると保存し、開き直しても残っている
    app.buttons["設定"].tap()
    let nameField = app.textFields["名前"]
    XCTAssert(nameField.waitForExistence(timeout: 10))
    sleep(1)
    shot("4-settings")
    app.buttons["色 3"].tap()
    nameField.tap()
    nameField.typeText("ko")
    sleep(1)
    shot("5-settings-editing")
    app.buttons["戻る"].firstMatch.tap()
    XCTAssert(play.waitForExistence(timeout: 10))
    app.buttons["設定"].tap()
    XCTAssert(nameField.waitForExistence(timeout: 10))
    XCTAssertEqual(nameField.value as? String, "Mikako")
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
    let ownCode = String(
      app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '部屋のコード '")).firstMatch.label.suffix(4))

    app.buttons["他のルーム"].tap()
    XCTAssert(app.staticTexts["他のルームに入る"].waitForExistence(timeout: 5))
    sleep(1)
    shot("8-sheet")
    for key in ["4", "8"] { app.buttons[key].tap() }
    sleep(1)
    shot("10-sheet-typing")
    for key in ["2", "1"] { app.buttons[key].tap() }

    // ほかの人がいるので、シートの上で確かめる。やめるとシートのまま、打ち直せる
    let enter = app.buttons["入る"]
    XCTAssert(enter.waitForExistence(timeout: 10))
    sleep(1)
    shot("11-confirm")
    app.buttons["やめる"].tap()
    sleep(1)
    XCTAssert(app.staticTexts["他のルームに入る"].exists)

    // 無い部屋（Mock の 0000）と満員（9999）は、入れずに今の待合のまま、シートに理由を出す
    for key in ["0", "0", "0", "0"] { app.buttons[key].tap() }
    XCTAssert(enter.waitForExistence(timeout: 5))
    enter.tap()
    XCTAssert(app.staticTexts["部屋が見つかりません"].waitForExistence(timeout: 10))
    sleep(1)
    shot("9-sheet-not-found")
    for key in ["9", "9", "9", "9"] { app.buttons[key].tap() }
    XCTAssert(enter.waitForExistence(timeout: 5))
    enter.tap()
    XCTAssert(app.staticTexts["満員で入れません"].waitForExistence(timeout: 10))
    sleep(1)
    shot("9b-sheet-full")
    // 今いる部屋のコードは、確かめずに「いまいる部屋です」
    for key in ownCode.map(String.init) { app.buttons[key].tap() }
    XCTAssert(app.staticTexts["いまいる部屋です"].waitForExistence(timeout: 5))
    XCTAssertFalse(enter.exists)
    sleep(1)
    shot("9c-sheet-same-room")

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
  }

  /// 移った先のラウンドが、移った直後（閉じかけのシートの下）に始まる道。プレイの 3D が回ってから止まって描かれるかを、
  /// 続けて撮ったコマで見る。MOCK_HOST_START_DELAY=0・MOCK_GENERATING_DURATION=0 でビルドし、
  /// 環境変数 ASOBU_FAST_START（xcodebuild には TEST_RUNNER_ASOBU_FAST_START）を付けたときだけ動かす
  @MainActor
  func testMoveIntoStartingRound() throws {
    guard outDir != nil, ProcessInfo.processInfo.environment["ASOBU_FAST_START"] != nil else {
      throw XCTSkip("ASOBU_SHOT_DIR と ASOBU_FAST_START が無いので撮らない")
    }
    let app = XCUIApplication()
    app.launchArguments += ["-player.name", "Mika", "-player.color", "0"]
    app.launch()
    let play = app.buttons["あそぶ"]
    XCTAssert(play.waitForExistence(timeout: 20))
    sleep(2)
    play.tap()
    XCTAssert(app.buttons["スタート"].waitForExistence(timeout: 20))
    sleep(2)
    app.buttons["他のルーム"].tap()
    XCTAssert(app.staticTexts["他のルームに入る"].waitForExistence(timeout: 5))
    for key in ["4", "8", "2"] { app.buttons[key].tap() }
    app.buttons["1"].tap()
    let enter = app.buttons["入る"]
    if enter.waitForExistence(timeout: 2) { enter.tap() }
    let moved = Date()
    for _ in 0..<70 {
      shot(String(format: "fast-f-%05d", Int(Date().timeIntervalSince(moved) * 1000)))
    }
    finishRound(app)
    XCTAssert(play.waitForExistence(timeout: 10))
  }

  /// ホストの待合と、「他のルーム」で移った先の参加者の待合を撮る。参加者の待合では、走る人の下に
  /// 「ホストのスタートを待っています」が画面の中に出て、VoiceOver は一言だけを読む（走る人の「読み込み中」は読まない）。
  /// 場面を作っている間は、真ん中の大きな走る人だけになる（下の走る人は消える）。機種ごとに -destination を替えて動かす。
  /// 画面設計書の 3-lobby.png と同じ人（Mikako・緑）で撮る。参加者の待合は、ホームインジケータが消えるまで 8 秒待ってから撮るので、
  /// MOCK_HOST_START_DELAY を 12 以上にしてビルドする（既定の 6 秒では、撮る前に場面を作り始めて止まる）
  @MainActor
  func testParticipantLobby() throws {
    guard outDir != nil else { throw XCTSkip("ASOBU_SHOT_DIR が無いので撮らない") }
    let app = XCUIApplication()
    app.launchArguments += ["-player.name", "Mikako", "-player.color", String(0x2FAE9B)]
    app.launch()
    let play = app.buttons["あそぶ"]
    XCTAssert(play.waitForExistence(timeout: 20))
    sleep(2)
    play.tap()
    XCTAssert(app.buttons["スタート"].waitForExistence(timeout: 20))
    sleep(6)  // 仮の参加者が入ってくるのを待つ
    shot("lobby-host")

    app.buttons["他のルーム"].tap()
    XCTAssert(app.staticTexts["他のルームに入る"].waitForExistence(timeout: 5))
    for key in ["4", "8", "2", "1"] { app.buttons[key].tap() }
    let enter = app.buttons["入る"]
    XCTAssert(enter.waitForExistence(timeout: 10))
    enter.tap()

    let waiting = app.staticTexts["ホストのスタートを待っています"]
    XCTAssert(waiting.waitForExistence(timeout: 10))
    XCTAssert(app.staticTexts["他のルームに入る"].waitForNonExistence(timeout: 5))
    let loading = app.descendants(matching: .any)["読み込み中"]
    XCTAssertFalse(loading.exists, loading.exists ? loading.debugDescription : "")
    XCTAssert(app.windows.firstMatch.frame.contains(waiting.frame))
    // ほかの参加者が入ってきて、ホームインジケータが消えるのを待つ
    sleep(8)
    let generating = app.descendants(matching: .any)["AI が場面を生成中…"]
    XCTAssertFalse(generating.exists, "撮る前に場面を作り始めた。MOCK_HOST_START_DELAY を 12 以上にしてビルドする")
    shot("lobby-participant")

    XCTAssert(generating.waitForExistence(timeout: 30))
    XCTAssert(waiting.exists)
    XCTAssertFalse(loading.exists, loading.exists ? loading.debugDescription : "")
    sleep(1)
    shot("lobby-participant-generating")
    finishRound(app)
    XCTAssert(play.waitForExistence(timeout: 10))
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
