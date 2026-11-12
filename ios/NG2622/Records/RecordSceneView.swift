import SwiftUI

/// 遊んだ記録の場面の 3D。記録の中の配置から組み、ゆっくり回し続ける（触れない）。
/// 回し続けるのは、見回せるようにするためと、止めたままだと後から組み上がった場面が描かれないことがあるため
struct RecordSceneView: View {
  let layout: SceneLayout
  /// 組んだ 3D を覚える名前（SceneLibrary）
  let key: String
  /// カメラから見る点までの距離（m）
  var distance: Float = 5.4
  /// 回し始めの時刻。並べて出す場面は同じ時刻を渡し、同じ向きで回す
  var since: Date = .distantPast

  /// 1 秒に回す角度（度）。みんなの描写の場面と同じ
  private static let speed = 12.0

  var body: some View {
    TimelineView(.animation) { context in
      let seconds = context.date.timeIntervalSince(since).truncatingRemainder(dividingBy: 360 / Self.speed)
      DioramaView(layout: layout, key: key, yaw: seconds * Self.speed - 20, tilt: SceneOrbit.defaultTilt, distance: distance)
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
