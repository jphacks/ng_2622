import RealityKit
import SwiftUI

/// 3D シーンを、向きと見下ろす角度を指定して描く。同梱のシーンは焼き込んだ <sceneID>.usdz を、
/// AI で作った場面（gen-）は配置の JSON から部品を並べて出す（SceneLibrary）。
/// どのシーンも同じ広さに収まるよう、読み込んだ形の大きさに合わせて縮める
struct DioramaView: View {
  let sceneID: String
  /// 縦の軸まわりの向き（度）。0 が初期の向き
  var yaw: Double
  /// 見下ろす角度（度）
  var tilt: Double

  /// 形が出たか。読み込み済みなら最初から出す。まだなら、読み込めたらふわっと出す
  @State private var isShown: Bool
  /// 場面を出せなかった（部品が 1 つも置けない・配置の JSON が取れない）
  @State private var failed = false

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

      if let scene = await SceneLibrary.shared.instance(of: sceneID) {
        world.addChild(scene.root)
      } else {
        failed = true
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
    .overlay {
      if failed {
        SceneUnavailable()
      }
    }
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

/// 場面を出せなかったときの表示
private struct SceneUnavailable: View {
  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: "cube.transparent")
        .font(.system(size: 34, weight: .bold))
        .foregroundStyle(Theme.gray)
      Text("場面を出せません")
        .font(Theme.font(18, .heavy))
        .foregroundStyle(Theme.muted)
    }
    .accessibilityElement(children: .combine)
  }
}
