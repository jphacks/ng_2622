import SwiftUI

/// 結果の画面（結果発表 → みんなの描写／振り返り）。結果発表から始まり、中で行き来する
struct ResultFlowView: View {
  let results: RoundResults
  let isHost: Bool
  /// このラウンドで録った自分の声（振り返りで聞き直す）
  let recording: RecordedAudio?
  /// ホストの「同じ顔ぶれでもう一度」
  let onAgain: () -> Void
  /// 「退出する」
  let onLeave: () -> Void

  init(
    results: RoundResults, isHost: Bool, recording: RecordedAudio? = nil, onAgain: @escaping () -> Void,
    onLeave: @escaping () -> Void
  ) {
    self.results = results
    self.isHost = isHost
    self.recording = recording
    self.onAgain = onAgain
    self.onLeave = onLeave
  }

  private enum Page { case ranking, everyone, review }

  @State private var page: Page = .ranking
  /// 結果発表で開いた行の数（下から数える）。戻ってきても開いたままにするため、ここで持つ
  @State private var openCount = 0
  @State private var winnerShown = false

  var body: some View {
    ZStack {
      switch page {
      case .ranking:
        RankingView(
          results: results,
          isHost: isHost,
          openCount: $openCount,
          winnerShown: $winnerShown,
          onEveryone: { go(.everyone) },
          onReview: { go(.review) },
          onAgain: onAgain,
          onLeave: onLeave
        )
        .transition(.move(edge: .leading).combined(with: .opacity))
      case .everyone:
        EveryoneView(results: results) { go(.ranking) }
          .transition(.move(edge: .trailing))
      case .review:
        ReviewView(results: results, recording: recording) { go(.ranking) }
          .transition(.move(edge: .trailing))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Theme.background)
    .foregroundStyle(Theme.ink)
  }

  private func go(_ next: Page) {
    withAnimation(.easeInOut(duration: 0.3)) { page = next }
  }
}

// MARK: - 結果の画面で使う部品

extension RoundResults {
  /// 順位（同点は同じ順位）。採点できなかった人は nil
  func place(of player: PlayerResult) -> Int? {
    guard let total = player.score?.total else { return nil }
    return 1 + players.filter { ($0.score?.total ?? -1) > total }.count
  }

  var me: PlayerResult? { players.first(where: \.isSelf) }
}

/// 「あなた」の印
struct SelfBadge: View {
  var body: some View {
    Text("あなた")
      .font(Theme.font(11, .heavy))
      .foregroundStyle(Theme.accent)
      .padding(.horizontal, 8)
      .padding(.vertical, 2)
      .background(Theme.accentSoft, in: Capsule())
  }
}

/// 「84 点」の表示
struct PointsText: View {
  let total: Int
  var size: CGFloat = 26

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 2) {
      Text("\(total)")
        .font(Theme.font(size, .heavy))
        .monospacedDigit()
      Text("点")
        .font(Theme.font(size * 0.55, .heavy))
        .foregroundStyle(Theme.muted)
    }
    .fixedSize()
  }
}

/// 戻るボタンと題名（みんなの描写・振り返り）
struct ResultSubHeader: View {
  let title: String
  let onBack: () -> Void

  var body: some View {
    ZStack {
      Text(title)
        .font(Theme.font(20, .black))
      HStack {
        CircleIconButton(systemName: "chevron.left", label: "戻る", action: onBack)
        Spacer()
      }
    }
    .frame(height: 52)
  }
}

/// 白い角丸の板
extension View {
  func resultCard() -> some View {
    background(Theme.card, in: RoundedRectangle(cornerRadius: 22))
      .shadow(color: Theme.ink.opacity(0.07), radius: 10, y: 6)
  }

  /// 画面の横幅（プレイの画面と同じ 346）
  func resultColumn() -> some View {
    frame(maxWidth: 346)
      .padding(.horizontal, 16)
      .frame(maxWidth: .infinity)
  }
}
