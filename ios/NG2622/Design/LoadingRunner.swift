import SwiftUI

/// 待ち時間に出す、走る人のアニメーション。
/// コマは scripts/scene/loading_runner.py が、人が走ったモーションキャプチャを部品の人物に写して書き出した連番の png
/// （Design/Loading/runner_NN.png）
struct LoadingRunner: View {
  var size: CGFloat = 220
  /// 1 秒あたりのコマ数。元のモーションキャプチャは 24 コマ（2 歩）で 0.75 秒なので、32 で同じ速さ
  var fps: Double = 32

  private static let frames: [UIImage] = (0..<24).compactMap { UIImage(named: String(format: "runner_%02d", $0)) }

  var body: some View {
    TimelineView(.animation) { ctx in
      let i = Int(ctx.date.timeIntervalSinceReferenceDate * fps) % max(Self.frames.count, 1)
      ZStack {
        // 足もとの影。コマの下から 8 % あたりが床
        Ellipse()
          .fill(RadialGradient(colors: [Theme.ink.opacity(0.16), .clear], center: .center, startRadius: 0, endRadius: size * 0.22))
          .frame(width: size * 0.5, height: size * 0.08)
          .offset(y: size * 0.415)
        if Self.frames.indices.contains(i) {
          Image(uiImage: Self.frames[i])
            .resizable()
            .interpolation(.high)
        }
      }
      .frame(width: size, height: size)
    }
    .accessibilityLabel("読み込み中")
  }
}
