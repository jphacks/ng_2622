import SwiftUI

/// 画面の入り口。Mock なら付箋の画面、Live なら未実装の表示を出す
struct RootView: View {
  let config: AppConfig
  @State private var session: RoundSession?

  var body: some View {
    ZStack {
      Theme.background.ignoresSafeArea()
      switch config.mode {
      case .live:
        LiveNotImplementedView(url: config.backendURL)
      case .mock:
        if let session {
          RoundView(session: session) {
            // 結果の画面は後の PR。いまは付箋の画面に戻る
            self.session = nil
          }
          .transition(.opacity)
        } else {
          DevLauncherView { options in
            let session = RoundSession(client: MockGameClient(options: options))
            self.session = session
            session.start()
          }
          .transition(.opacity)
        }
      }
    }
    .animation(.easeInOut(duration: 0.35), value: session == nil)
    .foregroundStyle(Theme.ink)
  }
}

/// Live の scheme で開いたときの表示
struct LiveNotImplementedView: View {
  let url: URL?

  var body: some View {
    VStack(spacing: 16) {
      Image(systemName: "network.slash")
        .font(.system(size: 48, weight: .bold))
        .foregroundStyle(Theme.gray)
      Text("本物の API との通信はまだ実装していません")
        .font(Theme.font(20))
        .multilineTextAlignment(.center)
      Text("仮のデータで動かすには、scheme「NG2622 Mock」でビルドしてください。")
        .font(Theme.font(14, .bold))
        .foregroundStyle(Theme.muted)
        .multilineTextAlignment(.center)
      if let url {
        Text(url.absoluteString)
          .font(.system(size: 12, design: .monospaced))
          .foregroundStyle(Theme.muted)
      }
    }
    .padding(32)
  }
}
