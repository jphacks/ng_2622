import SwiftUI

/// 1 ラウンドの画面の切り替え（プレイ → 待機）。終わったら onExit を呼ぶ
struct RoundView: View {
  let session: RoundSession
  let onExit: () -> Void
  /// 終わった後も少しのあいだ待機の画面を出しておくため、入った時刻を覚える
  @State private var waitingSince: Date?

  var body: some View {
    ZStack {
      if case .playing(let round) = session.phase {
        PlayView(round: round) { session.finishSpeaking() }
          .transition(.opacity)
      } else if let waitingSince {
        WaitingView(session: session, enteredAt: waitingSince)
          .transition(.opacity)
      }
    }
    .animation(.easeInOut(duration: 0.35), value: waitingSince)
    .onChange(of: session.phase) { _, phase in
      if case .waiting(let enteredAt) = phase { waitingSince = enteredAt }
    }
    .task(id: session.phase == .finished) {
      guard session.phase == .finished else { return }
      // 結果発表に進む地点。いまは少し待って付箋の画面に戻る
      try? await Task.sleep(for: .seconds(0.9))
      onExit()
    }
  }
}
