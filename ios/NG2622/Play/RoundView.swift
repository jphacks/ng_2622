import SwiftUI

/// 1 ラウンドの画面の切り替え（プレイ → 待機）。結果がそろったら onExit を呼ぶ
struct RoundView: View {
  let session: RoomSession
  let onExit: () -> Void
  /// 終わった後も少しのあいだ待機の画面を出しておくため、入った時刻を覚える
  @State private var waitingSince: Date?
  /// 待機の画面でも同じ場面を出すため、プレイ中のラウンドを覚える
  @State private var round: RoundInfo?

  var body: some View {
    ZStack {
      if case .playing(let round) = session.phase {
        if HologramCatalog.isHologram(round.sceneID) {
          HologramPlayView(round: round, recorder: session.recorder, mirrored: session.isHologramDisplay) {
            session.finishSpeaking()
          }
          .transition(.opacity)
        } else {
          PlayView(round: round, recorder: session.recorder) { session.finishSpeaking() }
            .transition(.opacity)
        }
      } else if let waitingSince {
        WaitingView(session: session, round: round, enteredAt: waitingSince)
          .transition(.opacity)
      }
    }
    .animation(.easeInOut(duration: 0.35), value: waitingSince)
    .onChange(of: session.phase, initial: true) { _, phase in
      switch phase {
      case .playing(let info): round = info
      case .waiting(let enteredAt): waitingSince = enteredAt
      default: break
      }
    }
    .task(id: session.isRoundOver) {
      guard session.isRoundOver else { return }
      // 少し待ってから結果発表に進む
      try? await Task.sleep(for: .seconds(0.9))
      onExit()
    }
  }
}
