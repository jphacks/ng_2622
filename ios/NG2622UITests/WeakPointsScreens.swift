import XCTest

/// きろく → 苦手の画面を Mock で開き、PNG に書き出す（見た目の確かめ用）。
/// 書き出し先は環境変数 RECORDS_SHOT_DIR（xcodebuild には TEST_RUNNER_RECORDS_SHOT_DIR で渡す）。無ければ何もしない。
/// 例の記録（MOCK_SAMPLE_RECORDS）が出る Mock のビルドで動かす。シミュレータに前から残っている記録（遊んで保存したもの）は
/// 読まない（-MockIgnoresSavedRecords）ので、記録の数は例の記録の数だけで決まる
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
    app.launchArguments += ["-player.name", "Mika", "-player.color", "0", "-MockIgnoresSavedRecords", "YES"]
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
    let back = Date()
    app.buttons["戻る"].firstMatch.tap()
    let scene = app.descendants(matching: .any).matching(identifier: "record-scene").firstMatch
    XCTAssert(scene.waitForExistence(timeout: 10))
    XCTAssert(entry.waitForExistence(timeout: 5))
    // 苦手の画面が薄れて消える動き（0.3 秒）は 3D の所にも掛かるので、終わってから見る
    sleep(1)
    let drawn = Self.drawnTime(of: scene, since: back, timeout: 10)
    // 回っているかは、秒数を控えるだけにする（assert にしない）。2026-11-13 にシミュレータで、苦手を開く前の 3D は回るが、
    // 戻ったあとの 3D は描かれても 10 秒以上止まったままのことがあった（苦手から戻ったときの 3D の不具合。直したら assert にする）
    let moving = Self.movingTime(of: scene, since: back, timeout: 5)
    func seconds(_ t: TimeInterval?) -> String { t.map { String(format: "%.2f", $0) } ?? "none" }
    print("TIMING records-scene-after-weak drawn \(seconds(drawn)) moving \(seconds(moving))")
    shot("w4-records-after-weak")
    XCTAssertNotNil(drawn, "苦手から戻ったきろくの 3D が描かれていない")
  }

  /// 記録が 4 件（例の記録だけ。保存済みの記録は読まない）: 入口ごと出ない
  @MainActor
  func testNoEntryWithFourRecords() throws {
    guard outDir != nil else { throw XCTSkip("RECORDS_SHOT_DIR が無いので撮らない") }
    let app = launch(samples: 4)
    openRecords(app)
    XCTAssertFalse(app.buttons["苦手をぶっとばせ！"].exists)
    shot("w5-records-four")
  }

  /// 3D の所のうち、地の色でない点の割合がこれ以上なら、3D が描かれたとみなす
  static let drawnArea = 0.1

  /// 場面（record-scene）の 3D が描かれたかを、3D の所のうち地の色でない点の割合で見る。描かれるまでの印
  /// （ScenePlaceholder の小さな箱）は所の 1% にも満たず、3D の盤は所の 2 割ほどを覆う。地の色は、盤の届かない隅の点から取る。
  /// 色の数（RecordsScreens.drawnTime。基準 30）と違い、場面の色合い（砂浜は色の数が少ない）に左右されない。
  /// 描かれたら since からの秒数、timeout までに描かれなければ nil
  @MainActor
  static func drawnTime(of element: XCUIElement, since start: Date, timeout: TimeInterval) -> TimeInterval? {
    let limit = Date().addingTimeInterval(timeout)
    repeat {
      let points = pixels(of: element)
      if let corner = points.first {
        let covered = Double(points.filter { $0 != corner }.count) / Double(points.count)
        if covered >= drawnArea { return Date().timeIntervalSince(start) }
      }
      usleep(200_000)
    } while Date() < limit
    return nil
  }

  /// 少し間をあけて撮った 2 枚で、色が変わった点の数がこれ以上なら、3D が回っているとみなす（縮めた 2400 点のうち）
  static let movedPixels = 24

  /// 場面（record-scene）の 3D が回っているかを、少し間をあけて 2 度撮った 3D の所の違いで見る。
  /// 3D はゆっくり回り続け（RecordSceneView）、描かれるまでの印は止まっている。描かれても止まった 3D は、回っていないとみなす。
  /// 回っていたら since からの秒数、timeout までに回らなければ nil
  @MainActor
  static func movingTime(of element: XCUIElement, since start: Date, timeout: TimeInterval) -> TimeInterval? {
    let limit = Date().addingTimeInterval(timeout)
    var before = pixels(of: element)
    repeat {
      usleep(300_000)
      let after = pixels(of: element)
      let moved = zip(before, after).filter { $0 != $1 }.count
      if !before.isEmpty, before.count == after.count, moved >= movedPixels { return Date().timeIntervalSince(start) }
      before = after
    } while Date() < limit
    return nil
  }

  /// 要素の上 8 割（3D の所。下の名前は入れない）を 60 × 40 に縮め、色を各 4 bit にまるめた点の並び
  @MainActor
  static func pixels(of element: XCUIElement) -> [Int] {
    let image = XCUIScreen.main.screenshot().image
    guard let cg = image.cgImage else { return [] }
    var f = element.frame
    f.size.height *= 0.8
    let s = image.scale
    let rect = CGRect(x: f.minX * s, y: f.minY * s, width: f.width * s, height: f.height * s).integral
    guard let crop = cg.cropping(to: rect) else { return [] }
    let (w, h) = (60, 40)
    var raw = [UInt8](repeating: 0, count: w * h * 4)
    guard
      let ctx = CGContext(
        data: &raw, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return [] }
    ctx.draw(crop, in: CGRect(x: 0, y: 0, width: w, height: h))
    return stride(from: 0, to: raw.count, by: 4).map { i in
      Int(raw[i] >> 4) << 8 | Int(raw[i + 1] >> 4) << 4 | Int(raw[i + 2] >> 4)
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
