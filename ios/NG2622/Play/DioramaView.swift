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
  /// 部品の動き（motion）の 0 秒。ラウンドでは round の startAt。nil なら出した時刻から数える
  var startsAt: Date?
  /// カメラから見る点までの距離（m）。小さく出すときは近づけて、場面を枠いっぱいに出す
  var distance: Float = 7.8
  /// 部屋のコード。部屋がその場で AI で作った場面の配置を取るときに付ける
  var room: String?

  /// 形が出たか。読み込み済みなら最初から出す。まだなら、読み込めたらふわっと出す
  @State private var isShown: Bool
  /// 場面を出せなかった（部品が 1 つも置けない・配置の JSON が取れない）
  @State private var failed = false
  @State private var motion = SceneMotionDriver()

  init(sceneID: String, yaw: Double, tilt: Double, startsAt: Date? = nil, distance: Float = 7.8, room: String? = nil) {
    self.sceneID = sceneID
    self.yaw = yaw
    self.tilt = tilt
    self.startsAt = startsAt
    self.distance = distance
    self.room = room
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
      Self.apply(yaw: yaw, tilt: tilt, distance: distance, world: world, camera: camera)

      if let scene = await SceneLibrary.shared.instance(of: sceneID, room: room) {
        world.addChild(scene.root)
        motion.start(scene.moving, from: startsAt ?? Date())
      } else {
        failed = true
      }
      isShown = true
    } update: { content in
      guard let world = content.entities.first(where: { $0.name == "world" }),
        let camera = content.entities.first(where: { $0.name == "camera" })
      else { return }
      Self.apply(yaw: yaw, tilt: tilt, distance: distance, world: world, camera: camera)
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
    .onDisappear { motion.stop() }
  }

  /// 中身を縦の軸まわりに回し、カメラを見下ろす角度の位置に置く
  private static func apply(yaw: Double, tilt: Double, distance: Float, world: Entity, camera: Entity) {
    world.orientation = simd_quatf(angle: Float(yaw * .pi / 180), axis: [0, 1, 0])
    let t = Float(tilt * .pi / 180)
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

/// 部品の動き（motion）を、毎フレーム startAt からの時刻で動かす。全員の端末で同じ時に同じ動きになる
final class SceneMotionDriver {
  private var ticker: FrameTicker?

  func start(_ moving: [SceneComposer.Moving], from start: Date) {
    stop()
    guard !moving.isEmpty else { return }
    Self.apply(moving, at: Date().timeIntervalSince(start))
    ticker = FrameTicker { [weak self] _ in
      guard self != nil else { return false }
      Self.apply(moving, at: Date().timeIntervalSince(start))
      return true
    }
  }

  func stop() {
    ticker?.invalidate()
    ticker = nil
  }

  private static func apply(_ moving: [SceneComposer.Moving], at elapsed: TimeInterval) {
    for m in moving {
      let pose = SceneMotion.pose(of: m.item, at: elapsed)
      m.entity.position = pose.position
      m.entity.orientation = SceneMotion.orientation(yaw: pose.yaw, sway: pose.sway)
    }
  }
}
