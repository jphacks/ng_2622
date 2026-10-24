import SwiftUI

/// 画面の入り口。Mock ならホームから始まり、Live なら未実装の表示を出す
struct RootView: View {
  let config: AppConfig

  var body: some View {
    ZStack {
      Theme.background.ignoresSafeArea()
      switch config.mode {
      case .live:
        LiveNotImplementedView(url: config.backendURL)
      case .mock:
        AppFlow { MockGameClient(options: config.mock) }
      }
    }
    .foregroundStyle(Theme.ink)
  }
}

/// ホーム → 部屋に入る → 部屋（待合・プレイ・結果）の切り替え
private struct AppFlow: View {
  /// 部屋ごとに新しい GameClient を作る
  let makeClient: () -> any GameClient

  private enum Screen: Equatable {
    case home
    case join
    case room
  }

  @State private var screen = Screen.home
  @State private var profile = PlayerProfile.load()
  @State private var session: RoomSession?
  @State private var creating = false

  var body: some View {
    ZStack {
      switch screen {
      case .home:
        HomeView(profile: $profile, onCreate: create, onJoin: { go(.join) })
          .disabled(creating)
          .transition(.opacity)
      case .join:
        JoinView(profile: profile, join: join, onBack: { go(.home) })
          .transition(.opacity)
      case .room:
        if let session {
          RoomView(session: session, onLeave: leave)
            .transition(.opacity)
        }
      }
    }
    .animation(.easeInOut(duration: 0.3), value: screen)
  }

  private func go(_ next: Screen) {
    screen = next
  }

  private func newSession() -> RoomSession {
    profile.name = profile.name.trimmingCharacters(in: .whitespaces)
    profile.save()
    return RoomSession(client: makeClient(), me: profile)
  }

  private func create() {
    let session = newSession()
    creating = true
    Task {
      defer { creating = false }
      guard (try? await session.create()) != nil else { return }
      self.session = session
      go(.room)
    }
  }

  private func join(_ code: String) async throws {
    let session = newSession()
    do {
      try await session.join(code: code)
    } catch {
      session.leave()
      throw error
    }
    self.session = session
    go(.room)
  }

  private func leave() {
    session?.leave()
    session = nil
    go(.home)
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
