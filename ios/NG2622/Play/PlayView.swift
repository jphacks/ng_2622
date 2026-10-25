import SwiftUI

/// プレイの画面。回転中（3 秒）から録音中（最長 20 秒）へ、画面を切り替えずにつなぐ。
/// 3D は同じ位置・大きさのまま、上のカウントダウンが「● 録音中」と残り時間のバーに入れ替わる
struct PlayView: View {
  let round: RoundInfo
  /// 録音中の間だけ録る
  let recorder: VoiceRecorder
  /// 「話し終えた」か 20 秒たった
  let onFinish: () -> Void

  @State private var orbit = SceneOrbit()
  @State private var isRecording = false
  @State private var hintUsed = false
  /// ドラッグの前回の位置
  @State private var lastDrag: CGSize?

  private var introStart: Date { round.startsAt + RoundTiming.prompt }
  private var introEnd: Date { introStart + RoundTiming.intro }
  private var recordingEnd: Date { introEnd + RoundTiming.recording }

  var body: some View {
    VStack(spacing: 0) {
      header
        .frame(width: 346, height: 96)
        .padding(.top, 24)
      scene
        .padding(.top, 0)
      footer
        .frame(width: 346, height: 70)
        .padding(.top, 14)
        .padding(.bottom, 12)
    }
    .frame(maxWidth: .infinity)
    .task(id: round) { await runTimeline() }
  }

  // MARK: - 上（指示文 → カウントダウン → 録音中と残り時間）

  private var header: some View {
    ZStack(alignment: .top) {
      countdown
        .padding(.top, 10)
        .opacity(isRecording ? 0 : 1)
        .offset(y: isRecording ? -14 : 0)
      recordingStatus
        .padding(.top, 22)
        .opacity(isRecording ? 1 : 0)
        .offset(y: isRecording ? 0 : -14)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .animation(.easeOut(duration: 0.5), value: isRecording)
  }

  private var countdown: some View {
    TimelineView(.periodic(from: round.startsAt, by: 0.05)) { context in
      let elapsed = context.date.timeIntervalSince(introStart)
      let n = 3 - Int(floor(elapsed))
      ZStack {
        if elapsed < 0 && !isRecording {
          Text("この場面を英語で説明しよう")
            .font(Theme.font(24, .heavy))
            .foregroundStyle(Theme.ink)
            .transition(.opacity)
        } else if (1...3).contains(n) && !isRecording {
          Text("\(n)")
            .font(Theme.font(72, .black))
            .monospacedDigit()
            .foregroundStyle(Theme.accent)
            .id(n)
            .transition(.asymmetric(insertion: .scale(scale: 0.5).combined(with: .opacity), removal: .identity))
        }
      }
      .frame(height: 76)
      .animation(.spring(duration: 0.35, bounce: 0.45), value: n)
      .accessibilityLabel(elapsed < 0 ? "この場面を英語で説明しよう" : (1...3).contains(n) ? "\(n)" : "")
    }
  }

  private var recordingStatus: some View {
    TimelineView(.animation(paused: !isRecording)) { context in
      let left = max(0, recordingEnd.timeIntervalSince(context.date))
      VStack(spacing: 10) {
        HStack(alignment: .firstTextBaseline) {
          HStack(spacing: 8) {
            BlinkingDot()
            Text("録音中").font(Theme.font(20, .heavy))
          }
          Spacer()
          HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text("残り")
            Text("\(Int(ceil(left)))")
              .font(Theme.font(30, .heavy))
              .monospacedDigit()
              .foregroundStyle(Theme.ink)
            Text("秒")
          }
          .font(Theme.font(18, .heavy))
          .foregroundStyle(Theme.muted)
        }
        GeometryReader { geo in
          Capsule()
            .fill(Theme.accentSoft)
            .overlay(alignment: .leading) {
              Capsule()
                .fill(Theme.accent)
                .frame(width: geo.size.width * min(1, left / RoundTiming.recording))
            }
        }
        .frame(height: 14)
      }
    }
  }

  // MARK: - 3D

  private var scene: some View {
    ZStack {
      DioramaView(sceneID: round.sceneID, yaw: orbit.yaw, tilt: orbit.tilt, startsAt: round.startsAt)
        .allowsHitTesting(false)
      // 指の操作はこの面で受ける（録音中だけ）
      Color.clear
        .contentShape(Rectangle())
        .gesture(dragGesture, isEnabled: isRecording)
        .onTapGesture(count: 2) {
          if isRecording { orbit.reset() }
        }
    }
    .overlay(alignment: .top) {
      Text("指で回して見られます")
        .font(Theme.font(12, .bold))
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 10)
        .padding(.vertical, 3)
        .background(.white.opacity(0.8), in: Capsule())
        .padding(.top, 6)
        .opacity(isRecording && !hintUsed ? 1 : 0)
        .animation(.easeInOut(duration: 0.4), value: isRecording && !hintUsed)
        .allowsHitTesting(false)
    }
    .overlay(alignment: .topTrailing) {
      resetButton
        .padding(.top, 6)
        .padding(.trailing, 22)
    }
    .overlay(alignment: .bottom) {
      VolumeMeter(level: recorder.meterLevel)
        .padding(.bottom, 14)
        .opacity(isRecording ? 1 : 0)
        .offset(y: isRecording ? 0 : 24)
        .animation(.easeOut(duration: 0.5).delay(0.15), value: isRecording)
        .allowsHitTesting(false)
    }
  }

  private var resetButton: some View {
    let shown = isRecording && orbit.isTurned && !orbit.isResetting
    return Button {
      orbit.reset()
    } label: {
      Image(systemName: "arrow.counterclockwise")
        .font(.system(size: 19, weight: .bold))
        .foregroundStyle(Theme.accent)
        .frame(width: 44, height: 44)
        .background(.white.opacity(0.92), in: Circle())
        .shadow(color: Theme.ink.opacity(0.12), radius: 5, y: 2)
    }
    .accessibilityLabel("初期の向きに戻す")
    .opacity(shown ? 1 : 0)
    .scaleEffect(shown ? 1 : 0.6)
    .allowsHitTesting(shown)
    .animation(.easeInOut(duration: 0.25), value: shown)
  }

  private var dragGesture: some Gesture {
    DragGesture(minimumDistance: 4)
      .onChanged { value in
        let prev = lastDrag ?? .zero
        orbit.drag(dx: value.translation.width - prev.width, dy: value.translation.height - prev.height)
        lastDrag = value.translation
        if orbit.isTurned { hintUsed = true }
      }
      .onEnded { _ in lastDrag = nil }
  }

  // MARK: - 下（「話し終えた」）

  private var footer: some View {
    Button("話し終えた", action: onFinish)
      .buttonStyle(BigButtonStyle(kind: .primary))
      .opacity(isRecording ? 1 : 0)
      .offset(y: isRecording ? 0 : 40)
      .allowsHitTesting(isRecording)
      .animation(.easeOut(duration: 0.5).delay(0.25), value: isRecording)
      .frame(maxHeight: .infinity, alignment: .top)
  }

  // MARK: - 時間の進み

  /// 回転中 → 録音中 → 20 秒で待機へ。時刻はラウンドの開始時刻から数える（全員の端末でそろえるため）
  private func runTimeline() async {
    if Date() < introEnd {
      orbit.spin(from: introStart, duration: RoundTiming.intro)
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

/// 点滅する赤い丸
private struct BlinkingDot: View {
  @State private var dim = false

  var body: some View {
    Circle()
      .fill(Theme.red)
      .frame(width: 14, height: 14)
      .opacity(dim ? 0.35 : 1)
      .onAppear {
        withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) { dim = true }
      }
  }
}
