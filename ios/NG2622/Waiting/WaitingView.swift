import SwiftUI

/// 待機の画面。参加者の一覧と、ホストだけの「締め切って発表する」
struct WaitingView: View {
  let session: RoomSession
  let enteredAt: Date

  @State private var confirming = false

  var body: some View {
    VStack(spacing: 0) {
      ParticipantList(participants: session.participants)
        .padding(.top, 40)
      Spacer()
      if session.isHost {
        CloseButton(enteredAt: enteredAt) {
          if session.remainingCount > 0 {
            confirming = true
          } else {
            session.close()
          }
        }
        .padding(.bottom, 30)
      }
    }
    .frame(width: 346)
    .frame(maxWidth: .infinity)
    .sheet(isPresented: $confirming) {
      CloseConfirmSheet(remaining: session.remainingCount) {
        confirming = false
        session.close()
      } onCancel: {
        confirming = false
      }
    }
    .onChange(of: session.isRoundOver) { _, over in
      if over { confirming = false }
    }
  }
}

/// 参加者の一覧
private struct ParticipantList: View {
  let participants: [Participant]

  var body: some View {
    VStack(spacing: 0) {
      ForEach(Array(participants.enumerated()), id: \.element.id) { i, p in
        ParticipantRow(participant: p)
        if i < participants.count - 1 {
          Rectangle().fill(Theme.line).frame(height: 1)
        }
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 4)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 22))
    .shadow(color: Theme.ink.opacity(0.07), radius: 10, y: 6)
  }
}

private struct ParticipantRow: View {
  let participant: Participant

  var body: some View {
    HStack(spacing: 14) {
      Circle()
        .fill(Color(hex: participant.color))
        .frame(width: 44, height: 44)
        .overlay {
          Text(String(participant.name.prefix(1)))
            .font(Theme.font(19, .black))
            .foregroundStyle(.white)
        }
      HStack(spacing: 8) {
        Text(participant.name)
          .font(Theme.font(19, .heavy))
          .lineLimit(1)
        if participant.isSelf {
          Text("あなた")
            .font(Theme.font(11, .heavy))
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Theme.accentSoft, in: Capsule())
        }
      }
      Spacer(minLength: 8)
      StatusLabel(status: participant.status)
    }
    .frame(height: 64)
    .accessibilityElement(children: .combine)
  }
}

/// 状態のアイコンと文字。色は紫にそろえ、形で見分ける（切断中だけ灰色）
private struct StatusLabel: View {
  let status: Participant.Status

  var body: some View {
    HStack(spacing: 8) {
      icon.frame(width: 26, height: 26)
      Text(text)
    }
    .font(Theme.font(16, .heavy))
    .foregroundStyle(status == .offline ? Theme.gray : Theme.accent)
    .fixedSize()
  }

  private var text: String {
    switch status {
    case .connected: "接続中"
    case .talking: "話している"
    case .grading: "採点中…"
    case .done: "完了"
    case .offline: "切断中"
    }
  }

  @ViewBuilder private var icon: some View {
    switch status {
    case .connected:
      Circle().fill(Theme.accentSoft)
    case .talking:
      BlinkingMic()
    case .grading:
      Spinner()
    case .done:
      Circle().fill(Theme.accent)
        .overlay {
          Image(systemName: "checkmark")
            .font(.system(size: 13, weight: .black))
            .foregroundStyle(.white)
        }
    case .offline:
      Circle().fill(Theme.offlineIcon)
        .overlay {
          Image(systemName: "xmark")
            .font(.system(size: 12, weight: .black))
            .foregroundStyle(Theme.gray)
        }
    }
  }
}

private struct BlinkingMic: View {
  @State private var dim = false

  var body: some View {
    Circle().fill(Theme.accentSoft)
      .overlay {
        Image(systemName: "mic.fill")
          .font(.system(size: 13, weight: .bold))
          .foregroundStyle(Theme.accent)
      }
      .opacity(dim ? 0.35 : 1)
      .onAppear {
        withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) { dim = true }
      }
  }
}

private struct Spinner: View {
  @State private var turning = false

  var body: some View {
    ZStack {
      Circle().stroke(Theme.accentSoft, lineWidth: 4)
      Circle().trim(from: 0, to: 0.25)
        .stroke(Theme.accent, style: StrokeStyle(lineWidth: 4, lineCap: .round))
        .rotationEffect(.degrees(turning ? 360 : 0))
    }
    .frame(width: 20, height: 20)
    .onAppear {
      withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) { turning = true }
    }
  }
}

/// 「締め切って発表する」。待機に入ってから 2 秒は押せず、その間は左から塗りつぶしていく
private struct CloseButton: View {
  let enteredAt: Date
  let action: () -> Void

  var body: some View {
    TimelineView(.animation) { context in
      let progress = min(1, context.date.timeIntervalSince(enteredAt) / RoundTiming.closeLock)
      let locked = progress < 1
      Button(action: action) {
        Text("締め切って発表する")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(alignment: .leading) {
            // 押せない間の進み具合
            GeometryReader { geo in
              Theme.accentSoft
                .frame(width: locked ? geo.size.width * progress : 0)
            }
          }
      }
      .buttonStyle(BigButtonStyle(kind: .outlined))
      .disabled(locked)
    }
  }
}

/// 締め切りの確認
private struct CloseConfirmSheet: View {
  let remaining: Int
  let onConfirm: () -> Void
  let onCancel: () -> Void

  var body: some View {
    VStack(spacing: 10) {
      Text("締め切って発表しますか？")
        .font(Theme.font(22, .black))
      Text("まだ \(remaining) 人が完了していません。")
        .font(Theme.font(16, .bold))
        .foregroundStyle(Theme.muted)
        .padding(.bottom, 8)
      Button("締め切って発表する", action: onConfirm)
        .buttonStyle(BigButtonStyle(kind: .primary))
      Button("待つ", action: onCancel)
        .buttonStyle(BigButtonStyle(kind: .plain))
        .padding(.top, 6)
    }
    .foregroundStyle(Theme.ink)
    .padding(.horizontal, 22)
    .padding(.top, 26)
    .presentationDetents([.height(300)])
    .presentationCornerRadius(28)
    .presentationBackground(.white)
  }
}
