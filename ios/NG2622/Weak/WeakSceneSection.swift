import SwiftUI

/// 「次はここ」のカードの中の、苦手の場面（案 A）。作っている間は小さな走る人と一言、できたら小さな 3D と名前と
/// 「この苦手の場面で練習する」。作れなかったときはカードに出さず、画面が数秒のバナー（WeakSceneNotice）で知らせる
/// （2026-11-14 リーダーが決めた。docs/design/part-generation.md）
struct WeakSceneSection: View {
  let phase: WeakSceneMaker.Phase
  let onPractice: (WeakScene) -> Void

  var body: some View {
    switch phase {
    case .idle, .failed:
      EmptyView()
    case .making:
      WeakSceneMaking()
    case .ready(let scene):
      WeakSceneReady(scene: scene, onPractice: { onPractice(scene) })
    }
  }
}

/// 苦手の場面を作れなかったことを知らせる、画面の上の白い角丸のバナー（オレンジの「!」と一言。ボタンは無く、
/// 画面を暗くせず、押せない。数秒で消える。2026-11-14 リーダーが決めた見た目）
struct WeakSceneNotice: View {
  /// 出しておく時間
  static let duration: Duration = .seconds(3)
  static let text = "苦手の場面を作れませんでした"

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: "exclamationmark.circle.fill")
        .font(.system(size: 26, weight: .bold))
        .symbolRenderingMode(.palette)
        .foregroundStyle(.white, Theme.mismatch)
        .accessibilityHidden(true)
      Text(Self.text)
        .font(Theme.font(18, .heavy))
        .foregroundStyle(Theme.ink)
        .fixedSize(horizontal: false, vertical: true)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 16)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 24))
    .shadow(color: Theme.ink.opacity(0.12), radius: 16, y: 6)
    .allowsHitTesting(false)
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("weak-scene-notice")
  }
}

/// 作っている間。小さな走る人と「苦手の場面を作っています…」「1 分ほどかかります」。
/// 進み具合はサーバーから届かないので、棒は出さない
private struct WeakSceneMaking: View {
  var body: some View {
    HStack(spacing: 12) {
      LoadingRunner(size: 96, announces: false)
      VStack(alignment: .leading, spacing: 6) {
        // 2 行に折り返すので、光の帯（ShimmerText）は使わない（折り返すと帯が文字とずれる）。動きは走る人で見せる
        Text("苦手の場面を作っています…")
          .font(Theme.font(18, .black))
          .fixedSize(horizontal: false, vertical: true)
        Text("1 分ほどかかります")
          .font(Theme.font(15, .heavy))
          .foregroundStyle(Theme.muted)
      }
      Spacer(minLength: 0)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("苦手の場面を作っています。1 分ほどかかります")
    .accessibilityIdentifier("weak-scene-making")
  }
}

/// できた。左に小さな 3D（ゆっくり回す）、右に「苦手の場面ができました」・名前・一言。下に「この苦手の場面で練習する」
private struct WeakSceneReady: View {
  let scene: WeakScene
  let onPractice: () -> Void

  /// 3D の枠の大きさ
  static let thumbnail: CGFloat = 128

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(alignment: .center, spacing: 14) {
        // 名前は右の文で読むので、3D の「〜の場面」は読ませない（2 度読まない）
        WeakSceneThumbnail(scene: scene)
          .frame(width: Self.thumbnail, height: Self.thumbnail)
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 4) {
          Text("苦手の場面ができました")
            .font(Theme.font(14, .heavy))
            .foregroundStyle(Theme.muted)
            .fixedSize(horizontal: false, vertical: true)
          Text(scene.name)
            .font(Theme.font(22, .black))
            .fixedSize(horizontal: false, vertical: true)
          Text(scene.pitch)
            .font(Theme.font(14, .heavy))
            .foregroundStyle(Theme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 0)
      }
      .accessibilityElement(children: .combine)
      .accessibilityIdentifier("weak-scene-ready")
      Button(action: onPractice) {
        Text("この苦手の場面で練習する")
          .font(Theme.font(20, .heavy))
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      .buttonStyle(BigButtonStyle(kind: .primary))
      .padding(.bottom, 6)
    }
  }
}

/// 苦手の場面の小さな 3D。返った配置から組む（その場で作った部品は、ここで取りに行く）。
/// 配置が読めなければ、印だけを出す
private struct WeakSceneThumbnail: View {
  let scene: WeakScene

  var body: some View {
    ZStack {
      if let layout = try? scene.document().layout {
        // 小さな枠なので、きろくの 3D（5.4）より少し近づける（回っても盤の角が枠から大きく切れない近さ）
        RecordSceneView(layout: layout, key: scene.sceneId, name: scene.name, distance: 4.6)
      } else {
        ScenePlaceholder()
      }
    }
    .background(Theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 18))
  }
}
