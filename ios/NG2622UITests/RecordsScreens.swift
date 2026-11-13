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

  /// ホーム → きろく → 横に送る → 下にスクロール（3D が上に止まって縮む → 最新の回の振り返り → 前の回との区切り
  /// → 一番下）→ 上へ戻る → 設定 → 消す → きろく（0 件）
  @MainActor
  func testRecordsAndSettings() throws {
    guard outDir != nil else { throw XCTSkip("RECORDS_SHOT_DIR が無いので撮らない") }
    let app = launch()
    sleep(3)
    shot("1-home")

    recordsCard(app).tap()
    let title = app.staticTexts["records-title"]
    XCTAssert(title.waitForExistence(timeout: 10))
    let opened = Date()
    // 真ん中の場面の 3D が描かれるまでの秒数を残す（描かれるまでは印だけが見えている）
    let scene = app.descendants(matching: .any).matching(identifier: "record-scene").firstMatch
    XCTAssert(scene.waitForExistence(timeout: 10))
    shot("2a-records-before-drawn")
    print("TIMING records-scene-drawn \(Self.drawnTime(of: scene, since: opened, timeout: 8))")
    sleep(1)
    shot("2-records-top")
    let top = title.frame.minY
    let restScene = scene.frame
    print("FRAME scene-at-rest \(restScene)")

    // 3D の所で横に送って、隣の場面にする
    let window = app.windows.firstMatch
    let sceneY = (restScene.minY + restScene.height * 0.4) / window.frame.height
    func swipe(_ from: Double, _ to: Double) {
      window.coordinate(withNormalizedOffset: CGVector(dx: from, dy: sceneY))
        .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: to, dy: sceneY)))
      sleep(3)
    }
    swipe(0.7, 0.25)
    shot("3-records-next-scene")
    swipe(0.3, 0.75)

    // 何回か遊んだ場面（回の区切りが 2 つ以上ある）まで送る。回数は読み上げの値にだけある
    func count() -> String { scene.value as? String ?? "" }
    for _ in 0..<8 where count().hasPrefix("1 ") {
      swipe(0.7, 0.25)
    }
    XCTAssertFalse(count().hasPrefix("1 "))
    let name = scene.label

    // 下にゆっくりスクロールする（指を止めてから離すので、慣性で流れない）。amount は画面の高さに対する割合
    func scrollDown(_ amount: Double, from: Double = 0.8) {
      window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: from))
        .press(
          forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: from - amount)),
          withVelocity: 600, thenHoldForDuration: 0.3)
      sleep(1)
    }
    // 3D が上端に着いて止まり、縮んでいく途中
    scrollDown(0.13)
    shot("4a-records-shrinking")
    // 縮み切って、小さな 3D と名前だけが上に残り、その下で中身がぼかしに溶ける
    scrollDown(0.15)
    shot("4-records-stuck")
    print("FRAME scene-stuck \(scene.frame)")
    XCTAssertLessThan(scene.frame.minY, restScene.minY)
    // さらに下（最新の回の振り返りの続き）
    scrollDown(0.45)
    shot("4b-records-scrolled-more")
    // 前の回との区切り（─── 11/13 3:02 ───）が、画面の中ほどに来るまで送る
    let second = app.descendants(matching: .any).matching(identifier: "round-divider").element(boundBy: 1)
    for _ in 0..<16 where !(second.exists && second.frame.minY < window.frame.height * 0.55) {
      scrollDown(0.3)
    }
    XCTAssert(second.exists)
    shot("5-records-next-round")
    // 一番下まで送る
    for _ in 0..<40 {
      let before = XCUIScreen.main.screenshot().pngRepresentation
      scrollDown(0.6, from: 0.85)
      if XCUIScreen.main.screenshot().pngRepresentation == before { break }
    }
    shot("6-records-bottom")

    // 上へ戻っても、横の並びの 3D と、選んでいる場面はそのまま
    for _ in 0..<40 where !(title.exists && title.frame.minY >= top - 1) {
      window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)))
    }
    sleep(2)
    shot("6b-records-back-to-top")
    XCTAssert(scene.exists)
    XCTAssertEqual(scene.frame.minY, restScene.minY, accuracy: 1)
    print("TIMING records-scene-after-scroll-back \(Self.drawnTime(of: scene, since: Date(), timeout: 4))")
    XCTAssertEqual(scene.label, name)
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
      XCTAssert(app.staticTexts["records-title"].waitForExistence(timeout: 10))
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

  /// 印だけのときの色の数より多ければ、3D が描かれたとみなす
  static let drawnColors = 30

  /// 場面（record-scene）の 3D の所に 3D が描かれたかを、画面を撮って見る。印だけなら色の数が少なく、
  /// 3D が描かれると増える。描かれたら since からの秒数、timeout までに描かれなければ nil
  @MainActor
  static func drawnTime(of element: XCUIElement, since start: Date, timeout: TimeInterval) -> TimeInterval? {
    let limit = Date().addingTimeInterval(timeout)
    repeat {
      if colorCount(of: element) > Self.drawnColors { return Date().timeIntervalSince(start) }
    } while Date() < limit
    return nil
  }

  /// 要素の上 8 割（3D の所。下の名前は入れない）を 60 × 40 に縮め、色を各 4 bit にまるめたときの色の数
  @MainActor
  static func colorCount(of element: XCUIElement) -> Int {
    let image = XCUIScreen.main.screenshot().image
    guard let cg = image.cgImage else { return 0 }
    var f = element.frame
    f.size.height *= 0.8
    let s = image.scale
    let rect = CGRect(x: f.minX * s, y: f.minY * s, width: f.width * s, height: f.height * s).integral
    guard let crop = cg.cropping(to: rect) else { return 0 }
    let (w, h) = (60, 40)
    var pixels = [UInt8](repeating: 0, count: w * h * 4)
    guard
      let ctx = CGContext(
        data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return 0 }
    ctx.draw(crop, in: CGRect(x: 0, y: 0, width: w, height: h))
    var colors = Set<Int>()
    for i in stride(from: 0, to: pixels.count, by: 4) {
      colors.insert(Int(pixels[i] >> 4) << 8 | Int(pixels[i + 1] >> 4) << 4 | Int(pixels[i + 2] >> 4))
    }
    return colors.count
  }

  @MainActor
  private func shot(_ name: String) {
    guard let outDir else { return }
    let png = XCUIScreen.main.screenshot().pngRepresentation
    try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    try? png.write(to: outDir.appendingPathComponent("\(name).png"))
  }
}
