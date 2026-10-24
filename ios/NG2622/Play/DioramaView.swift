import RealityKit
import SwiftUI

/// 3D シーン（<sceneID>.usdz）を、向きと見下ろす角度を指定して描く。
/// どのシーンも同じ広さに収まるよう、読み込んだ形の大きさに合わせて縮める
struct DioramaView: View {
  let sceneID: String
  /// 縦の軸まわりの向き（度）。0 が初期の向き
  var yaw: Double
  /// 見下ろす角度（度）
  var tilt: Double

  /// 形が出たか。読み込み済みなら最初から出す。まだなら、読み込めたらふわっと出す
  @State private var isShown: Bool

  init(sceneID: String, yaw: Double, tilt: Double) {
    self.sceneID = sceneID
    self.yaw = yaw
    self.tilt = tilt
    _isShown = State(initialValue: SceneLibrary.shared.isLoaded(sceneID))
  }

  var body: some View {
    RealityView { content in
      content.camera = .virtual
      let world = Entity()
      world.name = "world"
      content.add(world)

      let camera = Entity()
      camera.name = "camera"
      // モックの perspective（900px）と高さ（520px）に合わせた画角
      camera.components.set(PerspectiveCameraComponent(near: 0.1, far: 100, fieldOfViewInDegrees: 32))
      content.add(camera)
      Self.apply(yaw: yaw, tilt: tilt, world: world, camera: camera)

      if let model = await SceneLibrary.shared.instance(of: sceneID) {
        world.addChild(model)
      }
      isShown = true
    } update: { content in
      guard let world = content.entities.first(where: { $0.name == "world" }),
        let camera = content.entities.first(where: { $0.name == "camera" })
      else { return }
      Self.apply(yaw: yaw, tilt: tilt, world: world, camera: camera)
    }
    .realityViewCameraControls(.none)
    .id(sceneID)
    .opacity(isShown ? 1 : 0)
    .animation(.easeOut(duration: 0.4), value: isShown)
  }

  /// 中身を縦の軸まわりに回し、カメラを見下ろす角度の位置に置く
  private static func apply(yaw: Double, tilt: Double, world: Entity, camera: Entity) {
    world.orientation = simd_quatf(angle: Float(yaw * .pi / 180), axis: [0, 1, 0])
    let t = Float(tilt * .pi / 180)
    let distance: Float = 7.8
    let target: SIMD3<Float> = [0, 0.25, 0]
    camera.look(
      at: target,
      from: target + [0, distance * sin(t), distance * cos(t)],
      relativeTo: nil
    )
  }
}

/// USDZ を読み込んでおく所。同じシーンは 1 度だけ読み、使うたびに複製して渡す
final class SceneLibrary {
  static let shared = SceneLibrary()

  /// 地面の 1 辺の長さ（m）。箱で組んでいた公園と同じ広さにそろえる
  private static let footprint: Float = 2.3

  private var loads: [String: Task<Entity?, Never>] = [:]
  private var loaded: Set<String> = []

  func isLoaded(_ id: String) -> Bool {
    loaded.contains(id)
  }

  /// 先に読み込んでおく（画面に出す前に呼ぶ）
  func preload(_ ids: [String]) {
    for id in ids { _ = load(id) }
  }

  /// 読み込んだシーンの複製。読めなかったときは nil
  func instance(of id: String) async -> Entity? {
    await load(id).value?.clone(recursive: true)
  }

  private func load(_ id: String) -> Task<Entity?, Never> {
    if let task = loads[id] { return task }
    let task = Task { () -> Entity? in
      guard let model = try? await Entity(named: id, in: .main) else { return nil }
      let fitted = Self.fit(model)
      loaded.insert(id)
      return fitted
    }
    loads[id] = task
    return task
  }

  /// 見た目の範囲から、地面の中心を原点に置き、横幅を footprint にそろえる。地面（y = 0）の高さは変えない
  private static func fit(_ model: Entity) -> Entity {
    let bounds = model.visualBounds(relativeTo: nil)
    let size = bounds.extents
    let scale = footprint / max(size.x, size.z, 0.001)
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
