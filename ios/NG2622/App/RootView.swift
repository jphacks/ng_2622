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
          AppFlow(library: .app) { LiveGameClient(baseURL: url) }
        } else {
          MissingBackendURLView()
        }
      case .mock:
        AppFlow(library: .app) {
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

/// ホーム → 部屋（待合・プレイ・結果）の切り替え。ホームからは、きろくと設定にも入る。
/// 初めて開いた（名前が無い）ときは、ホームの代わりに名前を決める最初の画面を出す（HomeView の中で替える）。
/// ほかの人の部屋へは、ホームの「あそぶ」で自分の部屋を作ってから、待合の「他のルーム」で移る
private struct AppFlow: View {
  /// 端末に残した遊んだ記録（アプリ全体で 1 つ。body が走るたびに作り直さない）
  let library: RecordLibrary
  /// 部屋ごとに新しい GameClient を作る
  let makeClient: () -> any GameClient

  private enum Screen: Equatable {
    case home
    case room
    case records
    case settings
  }

  @State private var screen = Screen.home
  @State private var profile = PlayerProfile.load()
  @State private var session: RoomSession?
  @State private var creating = false
  /// ホームに出す短い知らせ（別の部屋に入れなかったとき）
  @State private var notice: String?

  var body: some View {
    ZStack {
      switch screen {
      case .home, .records, .settings:
        // きろくと設定は、ホームを出したまま上に重ねる。ホームの 3D を消して出し直さないため
        // （3D の入った view を画面の切り替えと同時に出し入れすると、後から出た 3D が描き直されないことがある）
        HomeView(
          profile: profile, recordCount: library.count, notice: notice, onName: { profile = .first(name: $0) },
          onPlay: create, onRecords: { go(.records) }, onSettings: { go(.settings) }, isCovered: screen != .home
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
            SettingsView(library: library, profile: $profile, onBack: { go(.home) })
              .cover()
          }
        }
      case .room:
        if let session {
          RoomView(session: session, onLeave: leave, onMove: move)
            // 別の部屋に移ったら、待合を新しく作る（前の部屋の画面の状態を持ち越さない）
            .id(ObjectIdentifier(session))
            .transition(.opacity)
        }
      }
    }
    .animation(.easeInOut(duration: 0.3), value: screen)
    .onChange(of: profile) { _, profile in profile.save() }
  }

  private func go(_ next: Screen) {
    // 知らせは、ホームから次へ進んだら消す
    if next != .home { notice = nil }
    screen = next
  }

  private func newSession() -> RoomSession {
    RoomSession(client: makeClient(), me: profile)
  }

  /// 「あそぶ」。自分の部屋を作り、ホストとして待合に入る
  private func create() {
    let session = newSession()
    creating = true
    Task {
      defer { creating = false }
      // ラウンドの途中で確認が出ないよう、部屋に入る前に聞く
      await MicPermission.request()
      guard (try? await session.create()) != nil else { return }
      self.session = session
      go(.room)
    }
  }

  /// 待合の「他のルーム」。今の部屋を抜けてから code の部屋に入る。もう移り始めていたら何もしない（2 つの部屋に入らない）。
  /// 確かめたあとで入れなくなっていたら（満員になった・始まった・つながらない）、今の部屋には戻らず、
  /// ホームに理由を一言出す
  private func move(to code: String) async {
    guard let current = session, !current.isMoving else { return }
    let next = newSession()
    do {
      try await current.move(to: code, with: next)
      session = next
    } catch RoomSession.MoveError.alreadyMoving {
      return
    } catch {
      session = nil
      notice = JoinRoomSheet.notice(for: error)
      go(.home)
    }
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
