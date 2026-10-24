import Foundation
import Testing
import simd

@testable import NG2622

/// 配置の JSON を読む・部品の向きと動きを計算する（docs/design/scene-protocol.md の「座標」「動き」）
struct SceneComposerTests {
  func close(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ tolerance: Float = 1e-4) -> Bool {
    simd_length(a - b) < tolerance
  }

  func item(_ motion: SceneLayout.Motion?, at position: SIMD3<Float> = [1, 2, 3], yaw: Double = 0) -> SceneLayout.Item {
    SceneLayout.Item(key: "k", part: "apple_red", position: position, yaw: yaw, motion: motion)
  }

  // MARK: - 向き

  /// yaw は上から見て反時計回り。0 で正面が +Z、90 で +X、-90 で -X、180 で -Z を向く
  @Test func yawFacing() {
    #expect(close(SceneMotion.facing(yaw: 0), [0, 0, 1]))
    #expect(close(SceneMotion.facing(yaw: 90), [1, 0, 0]))
    #expect(close(SceneMotion.facing(yaw: -90), [-1, 0, 0]))
    #expect(close(SceneMotion.facing(yaw: 180), [0, 0, -1]))
  }

  /// 揺れは向きを変えたあとの正面の軸まわりなので、正面の向きは変わらず、上が横に傾く
  @Test func swayKeepsFacing() {
    let q = SceneMotion.orientation(yaw: 90, sway: 10)
    #expect(close(q.act([0, 0, 1]), [1, 0, 0]))
    let up = q.act([0, 1, 0])
    #expect(up.y < 1 && up.y > 0.98)
    #expect(abs(up.x) < 1e-4)
  }

  // MARK: - 動きの時刻

  /// delay の間は 0。loop なら 1 周ごとに 0 に戻り、loop でなければ 1 で止まる
  @Test func progress() {
    let loop = SceneLayout.Motion(type: .move, duration: 2, delay: 1, loop: true, to: .zero)
    #expect(SceneMotion.progress(of: loop, at: -3) == 0)
    #expect(SceneMotion.progress(of: loop, at: 0.5) == 0)
    #expect(SceneMotion.progress(of: loop, at: 2) == 0.5)
    #expect(SceneMotion.progress(of: loop, at: 3.5) == 0.25)
    let once = SceneLayout.Motion(type: .move, duration: 2, delay: 1, loop: false, to: .zero)
    #expect(SceneMotion.progress(of: once, at: 2) == 0.5)
    #expect(SceneMotion.progress(of: once, at: 10) == 1)
    let broken = SceneLayout.Motion(type: .rotate, duration: 0)
    #expect(SceneMotion.progress(of: broken, at: 5) == 0)
  }

  /// fall は置いた高さから地面（y = 0）まで、だんだん速く落ちる。x と z は変わらない
  @Test func fall() {
    let apple = item(SceneLayout.Motion(type: .fall, duration: 1.2, delay: 0.5, loop: true), at: [0.4, 2.2, -1.2])
    #expect(close(SceneMotion.pose(of: apple, at: 0).position, [0.4, 2.2, -1.2]))
    let half = SceneMotion.pose(of: apple, at: 0.5 + 0.6).position
    #expect(close(half, [0.4, 2.2 * 0.75, -1.2]))
    #expect(SceneMotion.pose(of: apple, at: 0.5 + 1.19).position.y < 0.05)
    // loop なので、次の周は初めの高さから
    #expect(close(SceneMotion.pose(of: apple, at: 0.5 + 1.2).position, [0.4, 2.2, -1.2]))
  }

  /// move は置いた位置から to までまっすぐ。向き（yaw）は変えない
  @Test func move() {
    let man = item(
      SceneLayout.Motion(type: .move, duration: 6, to: [-2.5, 0, 0.5]), at: [2.5, 0, 0.5], yaw: -90)
    let pose = SceneMotion.pose(of: man, at: 3)
    #expect(close(pose.position, [0, 0, 0.5]))
    #expect(pose.yaw == -90)
  }

  /// rotate は反時計回りに 1 回転、sway は 1 往復で左右に angle だけ揺れる
  @Test func rotateAndSway() {
    let ball = item(SceneLayout.Motion(type: .rotate, duration: 4), yaw: 30)
    #expect(SceneMotion.pose(of: ball, at: 1).yaw == 120)
    let tree = item(SceneLayout.Motion(type: .sway, duration: 4, angle: 8))
    #expect(abs(SceneMotion.pose(of: tree, at: 1).sway - 8) < 1e-9)
    #expect(abs(SceneMotion.pose(of: tree, at: 3).sway + 8) < 1e-9)
    #expect(SceneMotion.pose(of: tree, at: 1).position == tree.position)
  }

  // MARK: - 配置の JSON

  /// 省いた項目は既定値（yaw 0・scale 1・delay 0・loop true・angle 10）。scale は 0.25〜4 に収める
  @Test func decodeDefaults() throws {
    let json = """
      {"protocol":"scenenglish.scene/1","name":"テスト","items":[
        {"key":"a","part":"apple_red@2","position":[0,1,0],"scale":9,"motion":{"type":"sway","duration":3}},
        {"key":"b","part":"tree","position":[1,0,-1],"yaw":45},
        {"key":"c","part":"ball_red","position":[0,0,0],"motion":{"type":"jump","duration":1}},
        {"key":"d","part":"ball_red","position":[0,0,0],"motion":{"type":"move","duration":1}}
      ]}
      """
    let layout = try SceneLayout.decode(Data(json.utf8))
    #expect(layout.items.count == 4)
    let a = layout.items[0]
    #expect(a.partRef == PartRef(id: "apple_red", version: 2))
    #expect(a.scale == 4)
    #expect(a.yaw == 0)
    #expect(a.motion == SceneLayout.Motion(type: .sway, duration: 3, delay: 0, loop: true, angle: 10))
    #expect(layout.items[1].partRef == PartRef(id: "tree", version: nil))
    #expect(layout.items[1].yaw == 45)
    // 知らない動きと、to の無い move は、動かさずに置く
    #expect(layout.items[2].motion == nil)
    #expect(layout.items[3].motion == nil)
  }

  @Test func rejectsUnknownProtocol() {
    let json = #"{"protocol":"scenenglish.scene/2","name":"x","items":[]}"#
    #expect(throws: (any Error).self) { try SceneLayout.decode(Data(json.utf8)) }
  }

  /// 壊れた item（位置が 2 つしかない・key が無い・物でない）は飛ばし、ほかの item は読む
  @Test func skipsBrokenItems() throws {
    let json = """
      {"protocol":"scenenglish.scene/1","name":"テスト","items":[
        {"key":"a","part":"tree","position":[0,0,0]},
        {"key":"b","part":"tree","position":[1,0]},
        {"part":"bench","position":[0,0,1]},
        42,
        {"key":"c","part":"ball_red","position":[2,0,0]}
      ]}
      """
    let layout = try SceneLayout.decode(Data(json.utf8))
    #expect(layout.items.map(\.key) == ["a", "c"])
  }

  @Test func generatedID() {
    #expect(GeneratedScene.isGenerated("gen-7k2m9q4x3a"))
    #expect(!GeneratedScene.isGenerated("park"))
  }

  // MARK: - 同梱

  /// Mock の見本は読めて、使う部品はどれもアプリに同梱されている
  @Test func sampleLayoutsUseBundledParts() async throws {
    let client = MockSceneLayoutClient()
    let parts = PartLibrary(bundle: .main, remoteBaseURL: nil)
    #expect(parts.bundledIDs.count >= 34)
    for id in ["gen-sample-1", "gen-sample-2"] {
      let layout = try await client.layout(sceneID: id)
      #expect(layout.id == id)
      for item in layout.items {
        #expect(parts.resolve(item.partRef) != nil, "\(item.part) が同梱に無い")
      }
    }
    await #expect(throws: SceneLayoutError.notFound) { try await client.layout(sceneID: "gen-nothing") }
  }

  /// 知らない部品は飛ばして並べ、全部知らなければ nil（「場面を出せません」）
  @Test func composeSkipsUnknownParts() async {
    let parts = PartLibrary(bundle: .main, remoteBaseURL: nil)
    let some = SceneLayout(
      protocol: SceneLayout.protocolName, id: "gen-test", name: "t", difficulty: nil,
      items: [
        .init(key: "x", part: "no_such_part", position: .zero),
        .init(key: "b", part: "ball_red", position: [1, 0, 0], yaw: 90, motion: .init(type: .rotate, duration: 2)),
      ])
    let composed = await SceneComposer.compose(some, parts: parts)
    #expect(composed?.root.children.count == 1)
    #expect(composed?.moving.count == 1)
    #expect(composed?.moving.first?.entity.position == [1, 0, 0])

    let none = SceneLayout(
      protocol: SceneLayout.protocolName, id: "gen-test2", name: "t", difficulty: nil,
      items: [.init(key: "x", part: "no_such_part", position: .zero)])
    #expect(await SceneComposer.compose(none, parts: parts) == nil)
  }
}

/// 「AI で作る」の状態の移り変わり
struct SceneGeneratorTests {
  final class FakeClient: SceneLayoutClient {
    var result: Result<String, SceneLayoutError>
    init(_ result: Result<String, SceneLayoutError>) { self.result = result }

    func layout(sceneID: String) async throws -> SceneLayout {
      SceneLayout(protocol: SceneLayout.protocolName, id: sceneID, name: "作った場面", difficulty: "normal", items: [])
    }

    func generate(prompt: String, difficulty: SceneDifficulty) async throws -> String {
      try result.get()
    }
  }

  func waitUntilDone(_ generator: SceneGenerator) async {
    for _ in 0..<200 where generator.isGenerating {
      await Task.yield()
    }
  }

  @Test func success() async {
    let client = FakeClient(.success("gen-abcdefghij"))
    let generator = SceneGenerator(client: client, store: SceneLayoutStore(client: client))
    #expect(!generator.canGenerate)
    generator.prompt = "  リンゴが落ちる公園 "
    generator.difficulty = .normal
    generator.generate()
    #expect(generator.isGenerating)
    await waitUntilDone(generator)
    #expect(generator.state == .idle)
    #expect(generator.made == .init(id: "gen-abcdefghij", name: "作った場面", difficulty: .normal))
  }

  @Test func failureShowsReason() async {
    let client = FakeClient(.failure(.rejected(message: "作れませんでした（理由）")))
    let generator = SceneGenerator(client: client, store: SceneLayoutStore(client: client))
    generator.prompt = "x"
    generator.generate()
    await waitUntilDone(generator)
    #expect(generator.state == .failed(reason: "作れませんでした（理由）"))
    #expect(generator.made == nil)
  }
}
