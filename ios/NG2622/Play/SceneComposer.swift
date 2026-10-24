import Foundation
import RealityKit
import simd

/// 配置の JSON から場面を組み立てる。docs/design/scene-protocol.md の「アプリの組み立て」。
/// 部品は PartLibrary から取り、items を上から順に position・yaw・scale で置く。知らない部品は飛ばす
enum SceneComposer {
  /// 組み立てた場面。moving は motion の付いた部品（毎フレーム SceneMotion.pose で動かす）
  struct Composed {
    let root: Entity
    let moving: [Moving]
  }

  struct Moving {
    let entity: Entity
    let item: SceneLayout.Item
  }

  /// 部品を置いた入れ物の名前（複製したあとに motion の部品を探し直すのに使う）
  static func entityName(index: Int) -> String {
    "item:\(index)"
  }

  /// 場面を組み立てる。置けた部品が 1 つも無ければ nil（「場面を出せません」）
  static func compose(_ layout: SceneLayout, parts: PartLibrary) async -> Composed? {
    // 同じ部品は 1 度だけ読む。先に全部の読み込みを始めてから待つ
    let refs = layout.items.map(\.partRef)
    for ref in Set(refs) { parts.preload(ref) }

    let root = Entity()
    var moving: [Moving] = []
    for (index, item) in layout.items.enumerated() {
      guard let model = await parts.instance(of: item.partRef) else {
        sceneLog.notice("部品を置けませんでした: \(item.part, privacy: .public)（\(item.key, privacy: .public)）")
        continue
      }
      let holder = Entity()
      holder.name = entityName(index: index)
      let pose = SceneMotion.pose(of: item, at: 0)
      holder.position = pose.position
      holder.orientation = SceneMotion.orientation(yaw: pose.yaw, sway: pose.sway)
      holder.scale = SIMD3(repeating: item.scale)
      holder.addChild(model)
      root.addChild(holder)
      if item.motion != nil {
        moving.append(Moving(entity: holder, item: item))
      }
    }
    guard !root.children.isEmpty else { return nil }
    return Composed(root: root, moving: moving)
  }

  /// 場面の範囲（root の座標）。move の部品は行き先（to）に着いたときの範囲も含め、動いて画面の外に出ないようにする
  static func bounds(of composed: Composed) -> BoundingBox {
    var bounds = composed.root.visualBounds(relativeTo: composed.root)
    for m in composed.moving {
      guard let motion = m.item.motion, motion.type == .move, let to = motion.to else { continue }
      let start = m.entity.visualBounds(relativeTo: composed.root)
      let shift = to - m.item.position
      bounds = bounds.union(BoundingBox(min: start.min + shift, max: start.max + shift))
    }
    return bounds
  }
}

/// 部品の向きと動きの計算（画面に依らない。test で確かめる）
nonisolated enum SceneMotion {
  struct Pose: Equatable {
    /// 部品の原点の位置（m）
    var position: SIMD3<Float>
    /// Y 軸まわりの回転（度、上から見て反時計回り）
    var yaw: Double
    /// 部品の正面（+Z）の軸まわりの傾き（度）。sway で使う
    var sway: Double
  }

  /// startAt から elapsed 秒たったときの、部品の位置と向き
  static func pose(of item: SceneLayout.Item, at elapsed: TimeInterval) -> Pose {
    var pose = Pose(position: item.position, yaw: item.yaw, sway: 0)
    guard let motion = item.motion else { return pose }
    let p = progress(of: motion, at: elapsed)
    switch motion.type {
    case .fall:
      // 重さで速くなるように、進み具合の 2 乗で下げる。地面（y = 0）で止まる
      let y = Double(item.position.y) * (1 - p * p)
      pose.position.y = Float(max(0, y))
    case .move:
      let to = motion.to ?? item.position
      pose.position = item.position + (to - item.position) * Float(p)
    case .rotate:
      pose.yaw = item.yaw + 360 * p
    case .sway:
      pose.sway = motion.angle * sin(2 * .pi * p)
    }
    return pose
  }

  /// 動きの進み具合（0〜1）。delay の間は 0。loop なら 1 周ごとに 0 に戻り、loop でなければ 1 で止まる
  static func progress(of motion: SceneLayout.Motion, at elapsed: TimeInterval) -> Double {
    let t = elapsed - motion.delay
    guard t > 0, motion.duration > 0 else { return 0 }
    if motion.loop {
      return t.truncatingRemainder(dividingBy: motion.duration) / motion.duration
    }
    return min(1, t / motion.duration)
  }

  /// yaw（度、上から見て反時計回り）と sway（度）の回転。RealityKit は右手系で Y が上なので、
  /// +Y 軸まわりの正の回転が、上から見て反時計回りになる（0 で正面 +Z、90 で +X、-90 で -X を向く）
  static func orientation(yaw: Double, sway: Double = 0) -> simd_quatf {
    let turn = simd_quatf(angle: Float(yaw * .pi / 180), axis: [0, 1, 0])
    guard sway != 0 else { return turn }
    // 揺れは、部品の正面の軸（向きを変えたあとの +Z）まわりに、底面を支点にして傾ける
    return turn * simd_quatf(angle: Float(sway * .pi / 180), axis: [0, 0, 1])
  }

  /// 部品の正面（+Z）が、場面の中でどちらを向くか
  static func facing(yaw: Double) -> SIMD3<Float> {
    orientation(yaw: yaw).act([0, 0, 1])
  }
}
