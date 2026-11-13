import SwiftUI

/// 部屋に入ってからの画面の切り替え（待合 → プレイ・待機 → 結果 → 待合）
struct RoomView: View {
  let session: RoomSession
  /// 部屋を出てホームに戻る
  let onLeave: () -> Void
  /// 待合の「他のルーム」で、code の部屋に移る
  let onMove: (String) async throws -> Void

  /// プレイ・待機の画面を出しているか。結果がそろっても、少しのあいだ待機の画面を残す。
  /// 初めの値は部屋の今の場面から決める（別の部屋に移った直後にその部屋のラウンドが始まっていたら、待合を挟まずプレイを出す）
  @State private var inRound: Bool
  @State private var micDenied = MicPermission.isDenied
  @Environment(\.scenePhase) private var scenePhase

  init(session: RoomSession, onLeave: @escaping () -> Void, onMove: @escaping (String) async throws -> Void = { _ in }) {
    self.session = session
    self.onLeave = onLeave
    self.onMove = onMove
    _inRound = State(initialValue: Self.showsRound(session.phase))
  }

  /// プレイ・待機の画面を出す場面か（始まったときに出す）
  static func showsRound(_ phase: RoomSession.Phase) -> Bool {
    if case .playing = phase { true } else { false }
  }

  var body: some View {
    ZStack {
      if inRound {
        RoundView(session: session) { inRound = false }
          .transition(.opacity)
      } else if case .results(let results) = session.phase {
        ResultFlowView(
          results: results, isHost: session.isHost, recording: session.recorder.recording, onAgain: session.again,
          onLeave: onLeave)
          .transition(.opacity)
      } else {
        LobbyView(session: session, onLeave: onLeave, onMove: onMove)
          .safeAreaInset(edge: .bottom, spacing: 0) {
            if micDenied { MicDeniedNotice() }
          }
          .transition(.opacity)
      }
    }
    .animation(.easeInOut(duration: 0.35), value: inRound)
    .animation(.easeInOut(duration: 0.35), value: session.phase == .lobby)
    .onChange(of: session.phase) { _, phase in
      if Self.showsRound(phase) { inRound = true }
    }
    // 設定から戻ってきたら、許可が変わったかを見直す
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { micDenied = MicPermission.isDenied }
    }
  }
}
