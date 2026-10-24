import SwiftUI

/// 部屋に入ってからの画面の切り替え（待合 → プレイ・待機 → 結果 → 待合）
struct RoomView: View {
  let session: RoomSession
  /// 部屋を出てホームに戻る
  let onLeave: () -> Void

  /// プレイ・待機の画面を出しているか。結果がそろっても、少しのあいだ待機の画面を残す
  @State private var inRound = false

  var body: some View {
    ZStack {
      if inRound {
        RoundView(session: session) { inRound = false }
          .transition(.opacity)
      } else if case .results(let results) = session.phase {
        ResultFlowView(results: results, isHost: session.isHost, onAgain: session.again, onLeave: onLeave)
          .transition(.opacity)
      } else {
        LobbyView(session: session, onLeave: onLeave)
          .transition(.opacity)
      }
    }
    .animation(.easeInOut(duration: 0.35), value: inRound)
    .animation(.easeInOut(duration: 0.35), value: session.phase == .lobby)
    .onChange(of: session.phase) { _, phase in
      if case .playing = phase { inRound = true }
    }
  }
}
