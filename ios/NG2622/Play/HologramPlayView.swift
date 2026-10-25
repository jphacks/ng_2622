import SwiftUI

/// ホログラムで遊ぶときのプレイの画面。真っ黒な画面に「3・2・1」だけを出し、0 になったらホログラムの映像を出して録音を始める。
/// 映像は 20 秒（RoundTiming.recording）動き続け、終わったら自動で録音を止めて次へ進む。
/// ペットボトルなどをかぶせて反射させて見せるので、文字やボタンは出さない。時刻はラウンドの開始時刻から数える（全員の端末でそろえるため）
struct HologramPlayView: View {
  let round: RoundInfo
  /// 録音中の間だけ録る
  let recorder: VoiceRecorder
  /// 映像を左右反転する（ホログラムを選んで始めた端末）
  let mirrored: Bool
  /// 20 秒たった
  let onFinish: () -> Void

  @State private var isRecording = false

  private var introEnd: Date { round.startsAt + RoundTiming.intro }
  private var recordingEnd: Date { introEnd + RoundTiming.recording }

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      if isRecording {
        if let url = HologramCatalog.videoURL(of: round.sceneID) {
          LoopingVideoView(url: url, mirrored: mirrored)
            .aspectRatio(1, contentMode: .fit)
            .padding(16)
            .transition(.opacity)
            .accessibilityLabel("ホログラム")
        }
      } else {
        countdown
      }
    }
    .statusBarHidden()
    .persistentSystemOverlays(.hidden)
    .animation(.easeIn(duration: 0.3), value: isRecording)
    // 20 秒のあいだ画面が暗くならないようにする
    .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
    .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    .task(id: round) { await runTimeline() }
  }

  /// 「3・2・1」。ラウンドの開始時刻から 1 秒ごとに減らす
  private var countdown: some View {
    TimelineView(.periodic(from: round.startsAt, by: 0.05)) { context in
      let elapsed = context.date.timeIntervalSince(round.startsAt)
      let n = 3 - Int(floor(elapsed))
      ZStack {
        if elapsed >= 0 && (1...3).contains(n) {
          Text("\(n)")
            .font(Theme.font(140, .black))
            .monospacedDigit()
            .foregroundStyle(.white)
            .id(n)
            .transition(.asymmetric(insertion: .scale(scale: 0.5).combined(with: .opacity), removal: .identity))
        }
      }
      .animation(.spring(duration: 0.35, bounce: 0.45), value: n)
      .accessibilityLabel(n >= 1 ? "\(n)" : "")
    }
  }

  /// 3・2・1 → 映像と録音（20 秒）→ 次へ。PlayView と同じ時間の決まり（RoundTiming）
  private func runTimeline() async {
    if Date() < introEnd {
      try? await Task.sleep(for: .seconds(introEnd.timeIntervalSinceNow))
      if Task.isCancelled { return }
    }
    isRecording = true
    recorder.start(duration: recordingEnd.timeIntervalSinceNow)
    try? await Task.sleep(for: .seconds(max(0, recordingEnd.timeIntervalSinceNow)))
    if Task.isCancelled { return }
    onFinish()
  }
}
