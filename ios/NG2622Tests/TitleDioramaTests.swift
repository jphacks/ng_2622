import Foundation
import RealityKit
import Testing

@testable import NG2622

/// ホームの 3D の選び方（TITLE_DIORAMA）と回し方、同梱の USDZ の読み込み（docs/design/ui/screens/home.md）
struct TitleDioramaTests {
  /// 設定の値は前後の空白と大文字小文字を問わない。空・知らない値は nil（作り置きの場面）
  @Test func readsSetting() {
    #expect(TitleDiorama(setting: "hackathon") == .hackathon)
    #expect(TitleDiorama(setting: " Hackathon ") == .hackathon)
    #expect(TitleDiorama(setting: "") == nil)
    #expect(TitleDiorama(setting: nil) == nil)
    #expect(TitleDiorama(setting: "park") == nil)
  }

  /// Info.plist に TitleDiorama の欄がある（Shared.xcconfig の TITLE_DIORAMA が Info.plist を通って入る）
  @Test func infoPlistHasSetting() {
    #expect(Bundle.main.infoDictionary?["TitleDiorama"] is String)
  }

  /// caption は広告主の名前だけ。広告と分かる「PR」の札はアプリに固定で、VoiceOver では「PR、名前」と 1 つで読む
  @Test func labelShowsFixedPRWithAdvertiser() {
    #expect(TitleDiorama.hackathon.caption == "JPHACKS")
    #expect(AdvertLabel.spoken("JPHACKS") == "PR、JPHACKS")
    #expect(HomeTitle.park.caption == nil)
  }

  /// USDZ は設定にかかわらずアプリに入る（project.yml の Copy title dioramas）。入っていない bundle では出さない
  @Test func shownOnlyWhenBundled() {
    for diorama in TitleDiorama.allCases {
      #expect(diorama.isBundled(in: .main), "\(diorama.usdzName).usdz がアプリに無い")
      #expect(TitleDiorama.shown(setting: diorama) == diorama)
    }
    #expect(TitleDiorama.shown(setting: nil) == nil)
    let tests = Bundle(for: BundleToken.self)
    #expect(tests != .main)
    #expect(TitleDiorama.shown(setting: .hackathon, bundle: tests) == nil)
  }

  // MARK: - 回し方

  /// 1 周は 0 以上 360 未満で、period 秒で 1 周する
  @Test func rotateWraps() {
    let spin = TitleSpin.rotate(period: 24)
    #expect(spin.yaw(at: 0) == 0)
    #expect(abs(spin.yaw(at: 6) - 90) < 1e-9)
    #expect(abs(spin.yaw(at: 30) - 90) < 1e-9)
    #expect(abs(spin.yaw(at: -6) - 270) < 1e-9)
  }

  /// 振るときは中心から始まり、1/4 往復で片方の端、半分で中心、3/4 でもう片方の端に来る。端の外には出ない
  @Test func swingStaysWithinRange() {
    let spin = TitleSpin.swing(center: -15, amplitude: 40, period: 20)
    #expect(abs(spin.yaw(at: 0) - -15) < 1e-9)
    #expect(abs(spin.yaw(at: 5) - 25) < 1e-9)
    #expect(abs(spin.yaw(at: 10) - -15) < 1e-9)
    #expect(abs(spin.yaw(at: 15) - -55) < 1e-9)
    #expect(abs(spin.yaw(at: 20) - -15) < 1e-9)
    for step in 0..<400 {
      let yaw = spin.yaw(at: Double(step) * 0.1)
      #expect(yaw >= -55 - 1e-9 && yaw <= 25 + 1e-9)
    }
  }

  /// 端ではなめらかに折り返す（端の前後で動きが小さく、真ん中で大きい）
  @Test func swingEasesAtEnds() {
    let spin = TitleSpin.swing(center: 0, amplitude: 40, period: 20)
    let nearEnd = abs(spin.yaw(at: 5.1) - spin.yaw(at: 5))
    let middle = abs(spin.yaw(at: 0.1) - spin.yaw(at: 0))
    #expect(nearEnd < middle / 50)
  }

  /// 広告の 3D（会場）は、横断幕が見える向き（-60〜30 度）だけを振る。公園は 1 周する
  @Test func advertSwingKeepsBannerInView() {
    #expect(HomeTitle.park.spin == .rotate(period: 24))
    guard case .swing(let center, let amplitude, let period) = HomeTitle.advert(URL(filePath: "/x.usdz"), caption: "").spin
    else {
      Issue.record("広告の 3D は左右に振る")
      return
    }
    #expect(center - amplitude >= -60)
    #expect(center + amplitude <= 30)
    #expect((16...24).contains(period))
  }

  // MARK: - 読み込み

  /// 同梱の USDZ を読み、組んだ場面と同じ広さ（横幅 2.3 m）にそろえ、光を足す。地面の中心が原点に来る
  @Test func loadsBundledDiorama() async throws {
    let scene = try #require(await SceneLibrary.shared.instance(usdz: TitleDiorama.hackathon.usdzName))
    #expect(scene.moving.isEmpty)
    let bounds = scene.root.visualBounds(relativeTo: nil)
    #expect(abs(max(bounds.extents.x, bounds.extents.z) - 2.3) < 0.01)
    #expect(abs(bounds.center.x) < 0.05 && abs(bounds.center.z) < 0.05)
    #expect(scene.root.findEntity(named: "banner") != nil)
    #expect(scene.root.findEntity(named: "monument") != nil)
    #expect(scene.root.children.contains { $0.components[DirectionalLightComponent.self] != nil })
    #expect(SceneLibrary.shared.isLoaded(usdzAt: try #require(TitleDiorama.hackathon.url())))
  }

  /// USDZ を読めなければ作り置きの場面に戻す（ホームを空にしない）。読めれば戻さない
  @Test func fallsBackToSceneWhenUSDZMissing() async throws {
    let park = try #require(ScenePool.bundled.example(of: .eiken3) ?? ScenePool.bundled.randomCandidate())
    let nowhere = URL.temporaryDirectory.appending(path: "no_such_diorama.usdz")
    let missing = await SceneLibrary.shared.instance(usdzAt: nowhere, fallback: park)
    #expect(missing.fellBack)
    #expect(missing.scene != nil)

    let none = await SceneLibrary.shared.instance(usdzAt: nowhere, fallback: nil)
    #expect(!none.fellBack)
    #expect(none.scene == nil)

    // 壊れたファイル（USDZ でない中身）も読めないので戻す
    let broken = URL.temporaryDirectory.appending(path: "broken-\(UUID().uuidString).usdz")
    try Data("not a usdz".utf8).write(to: broken)
    defer { try? FileManager.default.removeItem(at: broken) }
    #expect(await SceneLibrary.shared.instance(usdzAt: broken, fallback: park).fellBack)

    let found = await SceneLibrary.shared.instance(usdzAt: try #require(TitleDiorama.hackathon.url()), fallback: park)
    #expect(!found.fellBack)
    #expect(found.scene?.root.findEntity(named: "banner") != nil)
  }
}

/// テストの bundle を指すための印
private final class BundleToken {}
