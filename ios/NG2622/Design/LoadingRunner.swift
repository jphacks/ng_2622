import SwiftUI

/// 待ち時間に出す、走る人のアニメーション。
/// コマは scripts/scene/loading_runner.py が、人が走ったモーションキャプチャを部品の人物に写して書き出した連番の png
/// （Design/Loading/runner_NN.png）
struct LoadingRunner: View {
  var size: CGFloat = 220
  /// 1 秒あたりのコマ数。元のモーションキャプチャは 24 コマ（2 歩）で 0.75 秒なので、32 で同じ速さ
  var fps: Double = 32
  /// VoiceOver に「読み込み中」と読ませるか。そばに待っている理由の一言があるときは false にする。
  /// 「読み込み中」の label を付けたままだと、外から accessibilityHidden を付けても読み上げに残る（UI テストで確かめた）ので、
  /// 読ませないときは label を付けずに隠す
  var announces = true

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private static let frames: [UIImage] = (0..<24).compactMap { UIImage(named: String(format: "runner_%02d", $0)) }

  var body: some View {
    if announces {
      running.accessibilityLabel("読み込み中")
    } else {
      running.accessibilityHidden(true)
    }
  }

  /// 「視差効果を減らす」が on なら走らせず、最初のコマで止める（待合では長く出続けるため）。
  /// 走らせるときも、描き直しはコマが替わるとき（1 秒に fps 回）だけにする
  @ViewBuilder private var running: some View {
    if reduceMotion {
      pose(0)
    } else {
      TimelineView(.animation(minimumInterval: 1 / fps)) { ctx in
        pose(Int(ctx.date.timeIntervalSinceReferenceDate * fps) % max(Self.frames.count, 1))
      }
    }
  }

  /// i 番目のコマと、足もとの影
  private func pose(_ i: Int) -> some View {
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
}
