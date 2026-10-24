import SwiftUI

/// 画面の入り口。どちらもホームから始まる。Mock は仮のデータで、Live は BACKEND_URL のバックエンドにつないで動く
struct RootView: View {
  let config: AppConfig

  var body: some View {
    ZStack {
      Theme.background.ignoresSafeArea()
      switch config.mode {
      case .live:
        if let url = config.backendURL {
          AppFlow { LiveGameClient(baseURL: url) }
        } else {
          MissingBackendURLView()
        }
      case .mock:
        AppFlow { MockGameClient(options: config.mock) }
      }
    }
    .foregroundStyle(Theme.ink)
    // 3D シーンは読み込みに時間がかかるので、起動したらすぐ読み始める（最初に出す公園から）
    .task { SceneLibrary.shared.preload(SceneCatalog.all.map(\.id)) }
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
      await MicPermission.request()
      guard (try? await session.create()) != nil else { return }
      self.session = session
      go(.room)
    }
  }

  private func join(_ code: String) async throws {
    // ラウンドの途中で確認が出ないよう、部屋に入る前に聞く
    await MicPermission.request()
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

/// Live なのに BACKEND_URL が無い・読めないときの表示
struct MissingBackendURLView: View {
  var body: some View {
    VStack(spacing: 16) {
      Image(systemName: "network.slash")
        .font(.system(size: 48, weight: .bold))
        .foregroundStyle(Theme.gray)
      Text("バックエンドの URL がありません")
        .font(Theme.font(20))
        .multilineTextAlignment(.center)
      Text("Config/*.xcconfig の BACKEND_URL を確かめるか、scheme「NG2622 Mock」でビルドしてください。")
        .font(Theme.font(14, .bold))
        .foregroundStyle(Theme.muted)
        .multilineTextAlignment(.center)
    }
    .padding(32)
  }
}
