import SwiftUI

/// 開発用の付箋の画面（Mock のときだけ出す）。待合の画面ができたら差し替える
struct DevLauncherView: View {
  let onStart: (MockGameClient.Options) -> Void
  @State private var options = MockGameClient.Options()

  var body: some View {
    VStack(spacing: 0) {
      Spacer()
      VStack(alignment: .leading, spacing: 18) {
        Text("仮の入り口（Mock）")
          .font(Theme.font(20, .black))
        Text("待合の画面ができるまでの付箋です。ホストがスタートした想定で、回転中から始まります。")
          .font(Theme.font(14, .bold))
          .foregroundStyle(Theme.muted)
          .fixedSize(horizontal: false, vertical: true)

        VStack(alignment: .leading, spacing: 8) {
          Text("視点").font(Theme.font(13, .bold)).foregroundStyle(Theme.muted)
          Picker("視点", selection: $options.isHost) {
            Text("ホスト").tag(true)
            Text("参加者").tag(false)
          }
          .pickerStyle(.segmented)
        }

        Toggle(isOn: $options.includesOffline) {
          Text("切断中の人を入れる").font(Theme.font(16, .heavy))
        }
        .tint(Theme.accent)

        Button("▶ スタート") { onStart(options) }
          .buttonStyle(BigButtonStyle(kind: .primary))
          .padding(.top, 8)
      }
      .padding(24)
      .background(Color(hex: 0xFFF6C2), in: RoundedRectangle(cornerRadius: 6))
      .shadow(color: Theme.ink.opacity(0.15), radius: 10, y: 6)
      .rotationEffect(.degrees(-1.2))
      .padding(.horizontal, 22)
      Spacer()
      Spacer()
    }
  }
}
