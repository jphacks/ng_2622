import SwiftUI

/// 遊んだ記録の場面の 3D。記録の中の配置から組み、ゆっくり回し続ける（触れない）。
/// 下に場面の名前の板を敷く。組み上がって描かれるまで数秒かかることがあり（シミュレータで、長いと十数秒）、
/// その間も「何も無い」所にしないため
struct RecordSceneView: View {
  let layout: SceneLayout
  /// 組んだ 3D を覚える名前（SceneLibrary）
  let key: String
  /// 場面の名前（3D が描かれるまでの板と、読み上げに使う）
  let name: String
  /// カメラから見る点までの距離（m）
  var distance: Float = 5.4
  /// 1 秒に回す角度（度）。みんなの描写の場面と同じ
  private static let speed = 12.0

  var body: some View {
    ZStack {
      ScenePlaceholder(name: name)
      TimelineView(.animation) { context in
        // 並べて出す場面が同じ向きで回るよう、時刻から向きを決める
        let seconds = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 360 / Self.speed)
        DioramaView(
          layout: layout, key: key, yaw: seconds * Self.speed - 20, tilt: SceneOrbit.defaultTilt, distance: distance)
      }
    }
    .allowsHitTesting(false)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(name)の場面")
    // UI テストが、場面の所を撮って 3D が描かれたかを見るための名前
    .accessibilityIdentifier("record-scene")
  }
}
