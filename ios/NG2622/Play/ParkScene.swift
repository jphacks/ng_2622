import RealityKit
import SwiftUI
import UIKit

/// 3D シーンの表示。
/// 1. `sceneURL`（AI が動的生成した USDZ）があればそれを読み込む
/// 2. バンドル内の `<sceneID>.usdz`（park / classroom / station）があれば読み込む
/// 3. どちらも無ければ内蔵のボクセル公園（ParkBuilder）にフォールバックする
struct ParkSceneView: View {
  var sceneID: String = "park"
  var sceneURL: URL? = nil
  /// 縦の軸まわりの向き（度）。0 が初期の向き
  var yaw: Double
  /// 見下ろす角度（度）
  var tilt: Double

  var body: some View {
    RealityView { content in
      content.camera = .virtual
      let world = await Self.makeSceneEntity(sceneID: sceneID, sceneURL: sceneURL)
      world.name = "world"
      content.add(world)

      let camera = Entity()
      camera.name = "camera"
      // モックの perspective（900px）と高さ（520px）に合わせた画角
      camera.components.set(PerspectiveCameraComponent(near: 0.1, far: 100, fieldOfViewInDegrees: 32))
      content.add(camera)
      Self.apply(yaw: yaw, tilt: tilt, world: world, camera: camera)
    } update: { content in
      guard let world = content.entities.first(where: { $0.name == "world" }),
        let camera = content.entities.first(where: { $0.name == "camera" })
      else { return }
      Self.apply(yaw: yaw, tilt: tilt, world: world, camera: camera)
    }
    .realityViewCameraControls(.none)
  }

  /// USDZ（URL またはバンドル名）を読み込み、無ければボクセルの公園を返す
  private static func makeSceneEntity(sceneID: String, sceneURL: URL?) async -> Entity {
    let loaded: Entity? =
      if let sceneURL, let remote = try? await loadUSDZ(from: sceneURL) {
        remote
      } else if let bundled = try? await Entity(named: sceneID) {
        bundled
      } else {
        nil
      }

    guard let model = loaded else {
      return ParkBuilder.makeWorld()
    }

    let world = Entity()
    // USDZ は 8m 四方、カメラの距離は 2.3m 四方に合わせてあるため縮小する
    model.scale = [0.29, 0.29, 0.29]
    world.addChild(model)

    // USDZ の PBR マテリアルが暗くならないよう、主光源と補助光を足す
    let sun = DirectionalLight()
    sun.light.intensity = 4500
    sun.look(at: .zero, from: [1.2, 2.5, 1.8], relativeTo: nil)
    world.addChild(sun)

    let fill = DirectionalLight()
    fill.light.intensity = 2200
    fill.look(at: .zero, from: [-1.4, 1.8, -1.2], relativeTo: nil)
    world.addChild(fill)

    return world
  }

  private static func loadUSDZ(from url: URL) async throws -> Entity {
    if url.isFileURL {
      return try await Entity(contentsOf: url)
    }
    let (tmpURL, _) = try await URLSession.shared.download(from: url)
    let usdzURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString + ".usdz")
    try FileManager.default.moveItem(at: tmpURL, to: usdzURL)
    return try await Entity(contentsOf: usdzURL)
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

/// シーンを組み立てる。単位はモックの 1px = 1cm
enum ParkBuilder {
  static func makeWorld() -> Entity {
    let world = Entity()

    // 地面（上が芝、横から見ると土）
    box(world, y: -7, w: 230, h: 7, d: 230, c: 0x8ED456, top: 0x8ED456, side: 0x79C447)
    box(world, y: -22, w: 230, h: 15, d: 230, c: 0xA86F3D, side: 0x9C6536)

    // 木
    let tree = (x: 62.0, z: -60.0)
    box(world, x: tree.x, z: tree.z, w: 14, h: 42, d: 14, c: 0x8B5A2B)
    box(world, x: tree.x, y: 34, z: tree.z, w: 58, h: 52, d: 58, c: 0x5FB83E)
    box(world, x: tree.x, y: 86, z: tree.z, w: 36, h: 18, d: 36, c: 0x6CC24A)

    // ベンチ
    let bench = (x: -58.0, z: -58.0)
    for (lx, lz) in [(-26.0, -6.0), (26, -6), (-26, 6), (26, 6)] {
      box(world, x: bench.x + lx, z: bench.z + lz, w: 5, h: 15, d: 5, c: 0x3A3F4B)
    }
    box(world, x: bench.x, y: 15, z: bench.z, w: 68, h: 6, d: 22, c: 0xC98A4B)
    box(world, x: bench.x, y: 21, z: bench.z - 10, w: 68, h: 20, d: 5, c: 0xC98A4B)

    // 男の子
    let kid = (x: 42.0, z: 38.0)
    box(world, x: kid.x - 5, z: kid.z, w: 8, h: 18, d: 8, c: 0xF6C9A0)
    box(world, x: kid.x + 5, z: kid.z, w: 8, h: 18, d: 8, c: 0xF6C9A0)
    box(world, x: kid.x, y: 12, z: kid.z, w: 22, h: 10, d: 12, c: 0x24346B)
    box(world, x: kid.x, y: 22, z: kid.z, w: 22, h: 22, d: 12, c: 0xFFD43B)
    box(world, x: kid.x - 14, y: 26, z: kid.z, w: 6, h: 18, d: 6, c: 0xFFD43B)
    box(world, x: kid.x + 14, y: 26, z: kid.z, w: 6, h: 18, d: 6, c: 0xFFD43B)
    box(world, x: kid.x, y: 44, z: kid.z, w: 22, h: 20, d: 20, c: 0xF6C9A0)
    box(world, x: kid.x, y: 62, z: kid.z, w: 24, h: 8, d: 22, c: 0x2B2B33)

    // 犬
    let dog = (x: -50.0, z: 44.0)
    for (lx, lz) in [(-11.0, -5.0), (11, -5), (-11, 5), (11, 5)] {
      box(world, x: dog.x + lx, z: dog.z + lz, w: 6, h: 10, d: 6, c: 0xD69A5B)
    }
    box(world, x: dog.x, y: 10, z: dog.z, w: 34, h: 15, d: 16, c: 0xD69A5B)
    box(world, x: dog.x + 19, y: 16, z: dog.z, w: 4, h: 14, d: 14, c: 0xE23B3B)
    box(world, x: dog.x + 26, y: 18, z: dog.z, w: 16, h: 16, d: 16, c: 0xD69A5B)
    box(world, x: dog.x + 36, y: 19, z: dog.z, w: 6, h: 7, d: 9, c: 0xF1D1A8)
    box(world, x: dog.x + 26, y: 22, z: dog.z - 9, w: 8, h: 12, d: 3, c: 0x8A5A2E)
    box(world, x: dog.x + 26, y: 22, z: dog.z + 9, w: 8, h: 12, d: 3, c: 0x8A5A2E)
    box(world, x: dog.x - 20, y: 20, z: dog.z, w: 5, h: 12, d: 5, c: 0xD69A5B)

    // 草
    let grass: [(Double, Double)] = [
      (-90, -10), (-20, -85), (95, 20), (10, 90), (-95, 80), (85, -95), (-30, 10), (100, 95),
    ]
    for (gx, gz) in grass {
      box(world, x: gx, z: gz, w: 3, h: 9, d: 3, c: 0x4FA52F)
      box(world, x: gx + 4, z: gz + 2, w: 3, h: 6, d: 3, c: 0x4FA52F)
    }

    // 赤いボール
    var ballMaterial = PhysicallyBasedMaterial()
    ballMaterial.baseColor = .init(tint: UIColor(hex: 0xE52323))
    ballMaterial.roughness = 0.45
    let ball = ModelEntity(mesh: .generateSphere(radius: 0.11), materials: [ballMaterial])
    ball.position = [-0.02, 0.11, 0.46]
    world.addChild(ball)

    // ボールのための光（ほかの箱は光の影響を受けない）
    let light = DirectionalLight()
    light.light.intensity = 3000
    light.look(at: .zero, from: [0.6, 1.5, 1.2], relativeTo: nil)
    world.addChild(light)

    return world
  }

  /// 底面の中心を (x, y, z) に置く直方体。y は地面からの高さ。値は cm、色はモックの shade() と同じ明るさで面を塗る
  private static func box(
    _ parent: Entity,
    x: Double = 0, y: Double = 0, z: Double = 0,
    w: Double, h: Double, d: Double,
    c: UInt32, top: UInt32? = nil, side: UInt32? = nil
  ) {
    let colors: [UIColor] = [
      side.map { UIColor(hex: $0) } ?? shade(c, 0.92),  // 手前（+z）
      side.map { UIColor(hex: $0) } ?? shade(c, 0.72),  // 奥（-z）
      side.map { UIColor(hex: $0) } ?? shade(c, 0.80),  // 右（+x）
      side.map { UIColor(hex: $0) } ?? shade(c, 0.86),  // 左（-x）
      top.map { UIColor(hex: $0) } ?? shade(c, 1.12),  // 上
    ]
    guard let mesh = try? MeshResource.generate(from: [boxDescriptor]) else { return }
    let entity = ModelEntity(mesh: mesh, materials: colors.map { UnlitMaterial(color: $0) })
    entity.scale = [Float(w), Float(h), Float(d)] * 0.01
    entity.position = [Float(x), Float(y + h / 2), Float(z)] * 0.01
    parent.addChild(entity)
  }

  /// 1 辺 1 の箱（底面なし）。面ごとに別の material を使う
  private static let boxDescriptor: MeshDescriptor = {
    // 各面の [法線, 右, 上]
    let faces: [(SIMD3<Float>, SIMD3<Float>, SIMD3<Float>)] = [
      ([0, 0, 1], [1, 0, 0], [0, 1, 0]),
      ([0, 0, -1], [-1, 0, 0], [0, 1, 0]),
      ([1, 0, 0], [0, 0, -1], [0, 1, 0]),
      ([-1, 0, 0], [0, 0, 1], [0, 1, 0]),
      ([0, 1, 0], [1, 0, 0], [0, 0, -1]),
    ]
    var positions: [SIMD3<Float>] = []
    var normals: [SIMD3<Float>] = []
    var indices: [UInt32] = []
    var faceMaterials: [UInt32] = []
    for (i, (n, r, u)) in faces.enumerated() {
      let base = UInt32(positions.count)
      let c: SIMD3<Float> = n * 0.5
      let ru: SIMD3<Float> = r * 0.5 + u * 0.5
      let rnu: SIMD3<Float> = r * 0.5 - u * 0.5
      let v0: SIMD3<Float> = c - ru
      let v1: SIMD3<Float> = c + rnu
      let v2: SIMD3<Float> = c + ru
      let v3: SIMD3<Float> = c - rnu
      positions += [v0, v1, v2, v3]
      normals += Array(repeating: n, count: 4)
      indices += [base, base + 1, base + 2, base, base + 2, base + 3]
      faceMaterials += [UInt32(i), UInt32(i)]
    }
    var descriptor = MeshDescriptor(name: "box")
    descriptor.positions = MeshBuffers.Positions(positions)
    descriptor.normals = MeshBuffers.Normals(normals)
    descriptor.primitives = .triangles(indices)
    descriptor.materials = .perFace(faceMaterials)
    return descriptor
  }()

  /// モックの shade()。f が 1 より小さいと暗く、大きいと白に寄せる
  private static func shade(_ hex: UInt32, _ f: Double) -> UIColor {
    func ch(_ v: UInt32) -> CGFloat {
      let c = Double(v)
      let out = f >= 1 ? c + (255 - c) * (f - 1) : c * f
      return CGFloat(max(0, min(255, out.rounded())) / 255)
    }
    return UIColor(red: ch((hex >> 16) & 0xFF), green: ch((hex >> 8) & 0xFF), blue: ch(hex & 0xFF), alpha: 1)
  }
}

extension UIColor {
  convenience init(hex: UInt32) {
    self.init(
      red: CGFloat((hex >> 16) & 0xFF) / 255,
      green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255,
      alpha: 1
    )
  }
}
