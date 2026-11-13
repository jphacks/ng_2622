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

/// ホーム → 部屋（待合・プレイ・結果）の切り替え。ホームからは、きろく（その先の苦手）と設定にも入る。
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
    /// 苦手（きろくの上に重ねる）
    case weak
    case settings
  }

  @State private var screen = Screen.home
  @State private var profile = PlayerProfile.load()
  @State private var session: RoomSession?
  @State private var creating = false

  var body: some View {
    ZStack {
      switch screen {
      case .home, .records, .weak, .settings:
        // きろくと設定は、ホームを出したまま上に重ねる。ホームの 3D を消して出し直さないため
        // （3D の入った view を画面の切り替えと同時に出し入れすると、後から出た 3D が描き直されないことがある）
        HomeView(
          profile: profile, onName: { profile = .first(name: $0) }, onPlay: create, onRecords: { go(.records) },
          onSettings: { go(.settings) }, isCovered: screen != .home
        )
        .disabled(creating || screen != .home)
        .accessibilityHidden(screen != .home)
        .transition(.opacity)
        .overlay {
          if screen == .records || screen == .weak {
            // 苦手は、きろくを出したまま上に重ねる（戻ったときに、選んでいた場面とスクロールの位置が残る）。
            // 重なっている間は、きろくの 3D を外す
            RecordsView(
              library: library, isCovered: screen == .weak, onBack: { go(.home) }, onWeakPoints: { go(.weak) }
            )
            .disabled(screen != .records)
            .accessibilityHidden(screen != .records)
            .cover()
            .overlay {
              if screen == .weak {
                WeakPointsView(library: library, onBack: { go(.records) })
                  .cover()
              }
            }
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

  /// 待合の「他のルーム」。code の部屋に入れてから、今の部屋を抜ける（RoomSession.move）。入れたら移った先の待合に替える。
  /// 入れなければ投げ、今の部屋のまま（シートが理由を出す）。もう移り始めていたら何もせず投げる（2 つの部屋に入らない）
  private func move(to code: String) async throws {
    guard let current = session else { return }
    guard !current.isMoving else { throw RoomSession.MoveError.alreadyMoving }
    let next = newSession()
    try await current.move(to: code, with: next)
    session = next
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
