import RealityKit
import SwiftUI

/// 3D シーンを、向きと見下ろす角度を指定して描く。場面は配置の JSON から部品を並べて出す（SceneLibrary）。
/// どのシーンも同じ広さに収まるよう、読み込んだ形の大きさに合わせて縮める
struct DioramaView: View {
  /// 出す場面。ID で取る（作り置き・部屋が作った場面）か、手元の配置から組む（遊んだ記録の場面）
  enum Source {
    case id(String, room: String?)
    /// key は組んだ場面を覚える名前で、同じ key の場面は組み直さない
    case layout(SceneLayout, key: String)
    /// 同梱の USDZ を 1 つ読んで出す（ホームの広告の見本）。読めなければ fallback の作り置きの場面を出す
    case usdz(String, fallback: String?)

    /// 場面が替わったかを見分ける名前
    var identity: String {
      switch self {
      case .id(let id, _): "id:\(id)"
      case .layout(_, let key): "layout:\(key)"
      case .usdz(let name, let fallback): "usdz:\(name):\(fallback ?? "")"
      }
    }
  }

  let source: Source
  /// 縦の軸まわりの向き（度）。0 が初期の向き
  var yaw: Double
  /// 見下ろす角度（度）
  var tilt: Double
  /// 部品の動き（motion）の 0 秒。ラウンドでは round の startAt。nil なら出した時刻から数える
  var startsAt: Date?
  /// カメラから見る点までの距離（m）。小さく出すときは近づけて、場面を枠いっぱいに出す
  var distance: Float = 7.8
  /// USDZ を読めずに fallback の場面を出したときに呼ぶ（ホームが見本の字や振り方を戻すのに使う）
  var onFallback: (() -> Void)?

  /// 形が出たか。読み込み済みなら最初から出す。まだなら、読み込めたらふわっと出す
  @State private var isShown: Bool
  /// 場面を出せなかった（部品が 1 つも置けない・配置の JSON が取れない）
  @State private var failed = false
  @State private var motion = SceneMotionDriver()

  init(sceneID: String, yaw: Double, tilt: Double, startsAt: Date? = nil, distance: Float = 7.8, room: String? = nil) {
    source = .id(sceneID, room: room)
    self.yaw = yaw
    self.tilt = tilt
    self.startsAt = startsAt
    self.distance = distance
    _isShown = State(initialValue: SceneLibrary.shared.isLoaded(sceneID))
  }

  /// 手元の配置から組んで出す（遊んだ記録の場面）。ID では取りに行かない
  /// 組み上がるまでは透明にする。下に印を置いて使う（RecordSceneView）
  init(layout: SceneLayout, key: String, yaw: Double, tilt: Double, distance: Float = 7.8) {
    source = .layout(layout, key: key)
    self.yaw = yaw
    self.tilt = tilt
    self.distance = distance
    _isShown = State(initialValue: false)
  }

  /// 同梱の USDZ（title/<name>.usdz）を出す（ホームの広告の見本）。読めなければ fallbackSceneID の作り置きの場面を出し、
  /// onFallback を呼ぶ（ホームを空にしない）
  init(
    usdz name: String, fallbackSceneID: String?, yaw: Double, tilt: Double, distance: Float = 7.8,
    onFallback: (() -> Void)? = nil
  ) {
    source = .usdz(name, fallback: fallbackSceneID)
    self.yaw = yaw
    self.tilt = tilt
    self.distance = distance
    self.onFallback = onFallback
    _isShown = State(initialValue: SceneLibrary.shared.isLoaded(usdz: name))
  }

  private func load() async -> SceneComposer.Composed? {
    switch source {
    case .id(let id, let room): return await SceneLibrary.shared.instance(of: id, room: room)
    case .layout(let layout, let key): return await SceneLibrary.shared.instance(composing: layout, key: key)
    case .usdz(let name, let fallback):
      let (scene, fellBack) = await SceneLibrary.shared.instance(usdz: name, fallback: fallback)
      if fellBack { onFallback?() }
      return scene
    }
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

      if let scene = await load() {
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
    .id(source.identity)
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

extension View {
  /// 上に別の画面が重なっている間は、3D の入ったこの view を外す。外すのは重なる動きが終わってから、
  /// 戻すのは重なりが無くなったらすぐ。
  /// 不透明な画面で覆われたまま残った RealityView があると、ほかの RealityView（新しく作ったものも）が
  /// 描き直されなくなる（シミュレータで確かめた。docs/design/ui/screens/records.md）。
  /// 一瞬だけ出し入れするのとは違い、出したままの画面の切り替えには重ならない
  func unmountedWhileCovered(_ covered: Bool) -> some View {
    modifier(UnmountWhileCovered(covered: covered))
  }
}

private struct UnmountWhileCovered: ViewModifier {
  let covered: Bool
  /// 重なる動き（0.25〜0.3 秒）が終わるまで待つ時間
  static let delay: Duration = .milliseconds(450)
  @State private var mounted = true

  func body(content: Content) -> some View {
    ZStack {
      if mounted { content }
    }
    .task(id: covered) {
      if covered {
        try? await Task.sleep(for: Self.delay)
        if !Task.isCancelled { mounted = false }
      } else {
        mounted = true
      }
    }
  }
}

/// 小さな印。遊んだ記録の 3D の後ろに置く（3D が描かれるまで・描かれないときも、何も無い所を作らない。
/// 描かれると盤に隠れる）。きろくの横の並びの、3D を出さない場面にも使う（場面の名前は 3D の下に出す）
struct ScenePlaceholder: View {
  var body: some View {
    // 塗りは置かず、小さな印を薄い灰色で、ジオラマの盤が描かれると隠れる真ん中に置く
    Image(systemName: "cube")
      .font(.system(size: 18, weight: .bold))
      .foregroundStyle(Theme.disabledBorder)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      // 盤の真ん中は、枠の真ん中より少し下に描かれる
      .offset(y: 12)
      .accessibilityHidden(true)
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
