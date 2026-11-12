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
          AppFlow(library: RecordLibrary()) { LiveGameClient(baseURL: url) }
        } else {
          MissingBackendURLView()
        }
      case .mock:
        // 例の記録は端末に書かず、きろくの画面を遊ばずに確かめるために出す
        AppFlow(library: RecordLibrary(samples: PlayRecord.samples(count: config.mockSampleRecords))) {
          MockGameClient(options: config.mock, pool: .bundled)
        }
      }
    }
    .foregroundStyle(Theme.ink)
    // 3D の場面は組み立てに時間がかかるので、起動したらすぐ作り置きの場面を組み立てておく
    // （Live も同梱の配置を使う。SceneLayouts.client）
    .task {
      SceneLibrary.shared.preload(SceneDifficulty.allCases.flatMap { ScenePool.bundled.scenes[$0] ?? [] })
    }
  }
}

/// ホーム → 部屋に入る → 部屋（待合・プレイ・結果）の切り替え。ホームからは、きろくと設定にも入る
private struct AppFlow: View {
  /// 端末に残した遊んだ記録
  @State private var library: RecordLibrary
  /// 部屋ごとに新しい GameClient を作る
  let makeClient: () -> any GameClient

  init(library: @autoclosure @escaping () -> RecordLibrary, makeClient: @escaping () -> any GameClient) {
    _library = State(wrappedValue: library())
    self.makeClient = makeClient
  }

  private enum Screen: Equatable {
    case home
    case join
    case room
    case records
    case settings
  }

  @State private var screen = Screen.home
  @State private var profile = PlayerProfile.load()
  @State private var session: RoomSession?
  @State private var creating = false

  var body: some View {
    ZStack {
      switch screen {
      case .home, .records, .settings:
        // きろくと設定は、ホームを出したまま上に重ねる。ホームの 3D を消して出し直さないため
        // （3D の入った view を画面の切り替えと同時に出し入れすると、後から出た 3D が描き直されないことがある）
        HomeView(
          profile: $profile, recordCount: library.count, onCreate: create, onJoin: { go(.join) },
          onRecords: { go(.records) }, onSettings: { go(.settings) }
        )
        .disabled(creating || screen != .home)
        .accessibilityHidden(screen != .home)
        .transition(.opacity)
        // 部屋から戻ったときに、遊んだ回を数え直す
        .task { await library.reload() }
        .overlay {
          if screen == .records {
            RecordsView(library: library, onBack: { go(.home) })
              .cover()
          } else if screen == .settings {
            SettingsView(library: library, onBack: { go(.home) })
              .cover()
          }
        }
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

extension View {
  /// 下の画面を隠して上に重ねる（下の画面は出したままにする）
  fileprivate func cover() -> some View {
    frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Theme.background.ignoresSafeArea())
      .transition(.opacity)
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
