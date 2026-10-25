import SwiftUI

/// 光の帯が左から右へ文字の上を流れ続ける文字。待っている間の「動いている」ことを見せる。
/// 視差効果を減らす設定のときは、帯を流さずに文字だけを出す
struct ShimmerText: View {
  let text: String
  var font: Font = Theme.font(17, .heavy)
  /// 地の文字の色
  var color: Color = Theme.muted
  /// 流れる帯の色
  var shine: Color = Theme.accent
  /// 帯が端から端まで流れる時間（秒）
  var period: Double = 1.6

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    if reduceMotion {
      label
    } else {
      TimelineView(.animation) { ctx in
        // 帯の中心。文字の左の外（-0.4）から右の外（1.4）まで動かし、端でも帯が切れて見えないようにする
        let x = ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period * 1.8 - 0.4
        label
          .overlay {
            LinearGradient(
              stops: [
                .init(color: .clear, location: x - 0.25),
                .init(color: shine, location: x),
                .init(color: .clear, location: x + 0.25),
              ],
              startPoint: .leading, endPoint: .trailing
            )
            .mask(Text(text).font(font))
          }
      }
    }
  }

  private var label: some View {
    Text(text)
      .font(font)
      .foregroundStyle(color)
  }
}

#Preview {
  ShimmerText(text: "AI が場面を生成中…")
}
