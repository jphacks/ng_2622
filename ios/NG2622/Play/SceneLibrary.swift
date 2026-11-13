import Foundation
import RealityKit

/// 3D シーンを読み込んでおく所。同じシーンは 1 度だけ読み（組み立て）、使うたびに複製して渡す。
/// 遊ぶ場面は配置の JSON（作り置きは同梱、部屋がその場で作った場面はバックエンド）を取って部品を並べる。
/// ホームの広告の見本（TitleDiorama）だけは、同梱の USDZ を 1 つ読む
final class SceneLibrary {
  static let shared = SceneLibrary()

  /// 地面の 1 辺の長さ（m）
  private static let footprint: Float = 2.3
  /// 組み立てた場面を縮めるときの、横幅の下限（m）。小物だけの場面が大きくなりすぎないようにする
  private static let minComposedSpan: Float = 3

  private var loads: [String: Task<SceneComposer.Composed?, Never>] = [:]
  private var loaded: Set<String> = []
  /// 手元の配置から組んだ場面（key ごと）。遊んだ記録の場面を、きろくの画面で何度も出すので覚えておく
  private var composed: [String: Task<SceneComposer.Composed?, Never>] = [:]
  /// USDZ のファイルを読んだ場面（ファイルの場所ごと）
  private var usdzLoads: [String: Task<SceneComposer.Composed?, Never>] = [:]
  private var loadedUSDZ: Set<String> = []

  func isLoaded(_ id: String) -> Bool {
    loaded.contains(id)
  }

  /// 先に読み込んでおく（画面に出す前に呼ぶ）。room は部屋のコードで、部屋がその場で作った場面の配置を取るときに要る
  func preload(_ ids: [String], room: String? = nil) {
    for id in ids { _ = load(id, room: room) }
  }

  /// 読み込んだシーンの複製。読めなかったときは nil
  func instance(of id: String, room: String? = nil) async -> SceneComposer.Composed? {
    guard let template = await load(id, room: room).value else { return nil }
    return Self.copy(of: template)
  }

  private func load(_ id: String, room: String?) -> Task<SceneComposer.Composed?, Never> {
    if let task = loads[id] { return task }
    let task = Task { () -> SceneComposer.Composed? in
      let scene = await Self.compose(id, room: room)
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

  /// 手元にある配置から組み立てる。遊んだ記録の場面のように、ID では取れなくなった場面
  /// （作り置きから外した・部屋が閉じた）を出すときに使う。置けた部品が無ければ nil。
  /// key を渡すと、組んだ場面を覚えておき、同じ key では組み直さずに複製して渡す。key が nil なら、覚えずに毎回組む
  func instance(composing layout: SceneLayout, key: String? = nil) async -> SceneComposer.Composed? {
    guard let key else { return await Self.compose(layout) }
    let task = composed[key] ?? Task { await Self.compose(layout) }
    composed[key] = task
    guard let template = await task.value else {
      // 組めなかったものは覚えず、次にまた組む
      composed[key] = nil
      return nil
    }
    return Self.copy(of: template)
  }

  /// 覚えた、手元の配置から組んだ場面を忘れる（きろくの画面を閉じたとき・記録を消したとき）
  func forgetComposedLayouts() {
    composed.removeAll()
  }

  // MARK: - 1 つの USDZ でできた場面

  /// アプリに同梱した、1 つの USDZ でできた場面を置くフォルダ。ビルドのときに assets/title から写す（project.yml の Copy title dioramas）
  static let usdzDirectory = "title"

  /// 同梱の USDZ（title/<name>.usdz）の場所。無ければ nil
  static func bundledUSDZ(_ name: String, in bundle: Bundle = .main) -> URL? {
    bundle.url(forResource: name, withExtension: "usdz", subdirectory: usdzDirectory)
  }

  func isLoaded(usdzAt url: URL) -> Bool {
    loadedUSDZ.contains(url.standardizedFileURL.path)
  }

  /// USDZ のファイルを先に読んでおく（入れ替えるときに、読み終えてから替える）。読めたか
  @discardableResult
  func preload(usdzAt url: URL) async -> Bool {
    await loadUSDZ(url).value != nil
  }

  /// USDZ のファイル（同梱か、端末に取っておいたもの）を読んだ場面の複製。組んだ場面と同じく、地面の中心を原点に置き、
  /// 横幅を footprint にそろえ、光を足す。無い・読めないときは nil
  func instance(usdzAt url: URL) async -> SceneComposer.Composed? {
    guard let template = await loadUSDZ(url).value else { return nil }
    return Self.copy(of: template)
  }

  /// 同梱の USDZ（title/<name>.usdz）を読んだ場面の複製。無い・読めないときは nil
  func instance(usdz name: String) async -> SceneComposer.Composed? {
    guard let url = Self.bundledUSDZ(name) else {
      sceneLog.error("USDZ の場面がアプリにありません（\(name, privacy: .public)）")
      return nil
    }
    return await instance(usdzAt: url)
  }

  /// USDZ の場面を出す。読めなければ fallback（作り置きの場面の ID）を組み、fellBack を true にする（ホームを空にしないため）
  func instance(usdzAt url: URL, fallback sceneID: String?) async -> (scene: SceneComposer.Composed?, fellBack: Bool) {
    if let scene = await instance(usdzAt: url) { return (scene, false) }
    guard let sceneID else { return (nil, false) }
    return (await instance(of: sceneID), true)
  }

  /// 覚えた USDZ の場面を忘れる（端末に取っておいた 3D を消したとき）
  func forget(usdzAt url: URL) {
    let key = url.standardizedFileURL.path
    usdzLoads[key] = nil
    loadedUSDZ.remove(key)
  }

  private func loadUSDZ(_ url: URL) -> Task<SceneComposer.Composed?, Never> {
    let key = url.standardizedFileURL.path
    let name = url.lastPathComponent
    if let task = usdzLoads[key] { return task }
    let task = Task { () -> SceneComposer.Composed? in
      do {
        let model = try await Entity(contentsOf: url)
        let bounds = model.visualBounds(relativeTo: model)
        guard max(bounds.extents.x, bounds.extents.z) > 0 else {
          sceneLog.error("USDZ の場面に形がありません（\(name, privacy: .public)）")
          return nil
        }
        loadedUSDZ.insert(key)
        return SceneComposer.Composed(root: Self.fit(model, bounds: bounds, minSpan: 0), moving: [])
      } catch {
        sceneLog.error("USDZ の場面を読めませんでした（\(name, privacy: .public)）: \(error, privacy: .public)")
        return nil
      }
    }
    usdzLoads[key] = task
    Task {
      // 読めなかったものは覚えず、次にまた読む
      if await task.value == nil, usdzLoads[key] == task { usdzLoads[key] = nil }
    }
    return task
  }

  /// 組んだ場面の複製。動かす部品は、複製の中から名前で探し直す
  private static func copy(of template: SceneComposer.Composed) -> SceneComposer.Composed {
    let root = template.root.clone(recursive: true)
    let moving = template.moving.compactMap { m in
      root.findEntity(named: m.entity.name).map { SceneComposer.Moving(entity: $0, item: m.item) }
    }
    return SceneComposer.Composed(root: root, moving: moving)
  }

  /// 配置の JSON を取って部品を並べる
  private static func compose(_ id: String, room: String?) async -> SceneComposer.Composed? {
    do {
      return await compose(try await SceneLayouts.store.layout(of: id, room: room))
    } catch {
      sceneLog.error("配置の JSON を取れませんでした（\(id, privacy: .public)）: \(error, privacy: .public)")
      return nil
    }
  }

  /// 配置から部品を並べる。範囲は初めの位置と、move の行き先で測る
  private static func compose(_ layout: SceneLayout) async -> SceneComposer.Composed? {
    guard let composed = await SceneComposer.compose(layout, parts: .shared) else {
      sceneLog.error("部品を 1 つも置けませんでした（\(layout.id ?? layout.name, privacy: .public)）")
      return nil
    }
    let bounds = SceneComposer.bounds(of: composed)
    return SceneComposer.Composed(
      root: fit(composed.root, bounds: bounds, minSpan: minComposedSpan), moving: composed.moving)
  }

  /// 範囲（model の座標）から、地面の中心を原点に置き、横幅を footprint にそろえる。地面（y = 0）の高さは変えない。
  /// 組んだ場面にも USDZ の場面にも使い、同じ光を足す
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
