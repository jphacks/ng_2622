import Foundation
import RealityKit

/// 3D シーンを読み込んでおく所。同じシーンは 1 度だけ読み（組み立て）、使うたびに複製して渡す。
/// 同梱のシーンは焼き込んだ <id>.usdz、AI で作った場面（gen-）は配置の JSON を取って部品を並べる
final class SceneLibrary {
  static let shared = SceneLibrary()

  /// 地面の 1 辺の長さ（m）。箱で組んでいた公園と同じ広さにそろえる
  private static let footprint: Float = 2.3
  /// 組み立てた場面を縮めるときの、横幅の下限（m）。小物だけの場面が大きくなりすぎないようにする
  private static let minComposedSpan: Float = 3

  private var loads: [String: Task<SceneComposer.Composed?, Never>] = [:]
  private var loaded: Set<String> = []

  func isLoaded(_ id: String) -> Bool {
    loaded.contains(id)
  }

  /// 先に読み込んでおく（画面に出す前に呼ぶ）
  func preload(_ ids: [String]) {
    for id in ids { _ = load(id) }
  }

  /// 読み込んだシーンの複製。読めなかったときは nil
  func instance(of id: String) async -> SceneComposer.Composed? {
    guard let template = await load(id).value else { return nil }
    let root = template.root.clone(recursive: true)
    // 動かす部品は、複製の中から名前で探し直す
    let moving = template.moving.compactMap { m in
      root.findEntity(named: m.entity.name).map { SceneComposer.Moving(entity: $0, item: m.item) }
    }
    return SceneComposer.Composed(root: root, moving: moving)
  }

  private func load(_ id: String) -> Task<SceneComposer.Composed?, Never> {
    if let task = loads[id] { return task }
    let task = Task { () -> SceneComposer.Composed? in
      let scene = GeneratedScene.isGenerated(id) ? await Self.compose(id) : await Self.baked(id)
      if scene != nil { loaded.insert(id) }
      return scene
    }
    loads[id] = task
    Task {
      // 読めなかったもの（配置の JSON が取れなかったなど）は覚えず、次にまた読む
      if await task.value == nil { loads[id] = nil }
    }
    return task
  }

  /// 焼き込んだ USDZ。見た目の範囲に合わせて縮める
  private static func baked(_ id: String) async -> SceneComposer.Composed? {
    guard let model = try? await Entity(named: id, in: .main) else { return nil }
    let bounds = model.visualBounds(relativeTo: nil)
    return SceneComposer.Composed(root: fit(model, bounds: bounds, minSpan: 0.001), moving: [])
  }

  /// 配置の JSON から部品を並べる。範囲は初めの位置と、move の行き先で測る
  private static func compose(_ id: String) async -> SceneComposer.Composed? {
    let layout: SceneLayout
    do {
      layout = try await SceneLayouts.store.layout(of: id)
    } catch {
      sceneLog.error("配置の JSON を取れませんでした（\(id, privacy: .public)）: \(error, privacy: .public)")
      return nil
    }
    guard let composed = await SceneComposer.compose(layout, parts: .shared) else {
      sceneLog.error("部品を 1 つも置けませんでした（\(id, privacy: .public)）")
      return nil
    }
    let bounds = SceneComposer.bounds(of: composed)
    return SceneComposer.Composed(
      root: fit(composed.root, bounds: bounds, minSpan: minComposedSpan), moving: composed.moving)
  }

  /// 範囲（model の座標）から、地面の中心を原点に置き、横幅を footprint にそろえる。地面（y = 0）の高さは変えない
  private static func fit(_ model: Entity, bounds: BoundingBox, minSpan: Float) -> Entity {
    let size = bounds.extents
    let scale = footprint / max(size.x, size.z, minSpan)
    model.position = [-bounds.center.x, 0, -bounds.center.z]
    let root = Entity()
    root.scale = [scale, scale, scale]
    root.addChild(model)
    root.addChild(makeLight())
    return root
  }

  /// 斜め前の上からの光。USDZ の素材は光が無いと暗く見える
  private static func makeLight() -> Entity {
    let light = DirectionalLight()
    light.light.intensity = 2500
    light.look(at: .zero, from: [3, 8, 6], relativeTo: nil)
    return light
  }
}
