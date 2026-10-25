import SwiftUI

/// 結果発表。最下位から 1 行ずつパタパタと開き、1 位が開いたら優勝を出す。
/// 誰の画面でも同じ盤面にするため、自分の行に印は付けない
struct RankingView: View {
  let results: RoundResults
  let isHost: Bool
  @Binding var openCount: Int
  @Binding var winnerShown: Bool
  let onEveryone: () -> Void
  let onReview: () -> Void
  let onAgain: () -> Void
  let onLeave: () -> Void

  /// 1 行ごとの間隔
  private static let step: Duration = .seconds(0.9)

  private var players: [PlayerResult] { results.players }
  private var winner: PlayerResult? { players.first.flatMap { $0.score == nil ? nil : $0 } }

  var body: some View {
    GeometryReader { geo in
      ScrollView {
        VStack(spacing: 0) {
          Text("結果発表")
            .font(Theme.font(26, .black))
            .padding(.top, 24)
            .padding(.bottom, 20)
          board
          if winnerShown, let winner {
            WinnerBanner(player: winner)
              .padding(.top, 20)
              .transition(.scale(scale: 0.6).combined(with: .opacity))
          }
          Spacer(minLength: 28)
          // AI で作った場面（gen-）は使い回さないので評価しない（バックエンドも /scenes/{id}/reviews を受け付けない）
          if winnerShown, let me = results.me, !GeneratedScene.isGenerated(results.sceneID) {
            SceneRatingCard(sceneID: results.sceneID, sceneName: results.sceneName, playerName: me.name)
              .padding(.bottom, 20)
              .transition(.opacity)
          }
          actions
            .padding(.bottom, 24)
        }
        .resultColumn()
        .frame(minHeight: geo.size.height)
      }
      .scrollBounceBehavior(.basedOnSize)
    }
    .task { await reveal() }
    .sensoryFeedback(.impact(weight: .light), trigger: openCount)
    .sensoryFeedback(.success, trigger: winnerShown)
  }

  // MARK: - 順位表

  private var board: some View {
    VStack(spacing: 10) {
      ForEach(Array(players.enumerated()), id: \.element.id) { i, p in
        RankRow(
          place: results.place(of: p),
          player: p,
          isOpen: i >= players.count - openCount,
          isWinner: winnerShown && p.id == winner?.id
        )
      }
    }
  }

  // MARK: - ボタン

  @ViewBuilder private var actions: some View {
    if winnerShown {
      VStack(spacing: 16) {
        Button("みんなの描写を見る", action: onEveryone)
          .buttonStyle(BigButtonStyle(kind: .primary))
        Button("自分の結果を振り返る", action: onReview)
          .buttonStyle(BigButtonStyle(kind: .outlined))
        if isHost {
          Button("同じ顔ぶれでもう一度", action: onAgain)
            .buttonStyle(BigButtonStyle(kind: .outlined))
        }
        Button("退出する", action: onLeave)
          .buttonStyle(BigButtonStyle(kind: .plain))
      }
      .padding(.top, 6)
      .transition(.opacity.combined(with: .offset(y: 20)))
    } else {
      Button("発表をとばす", action: skip)
        .buttonStyle(BigButtonStyle(kind: .plain))
        .transition(.opacity)
    }
  }

  // MARK: - 発表の進み

  /// 下から 1 行ずつ開く。開き終わっていれば何もしない（戻ってきたとき）
  private func reveal() async {
    if openCount == 0 {
      try? await Task.sleep(for: .seconds(0.4))
    }
    while openCount < players.count {
      if Task.isCancelled { return }
      withAnimation(.easeInOut(duration: 0.55)) { openCount += 1 }
      try? await Task.sleep(for: Self.step)
    }
    if Task.isCancelled || winnerShown { return }
    withAnimation(.spring(duration: 0.5, bounce: 0.35)) { winnerShown = true }
  }

  private func skip() {
    withAnimation(.easeInOut(duration: 0.45)) { openCount = players.count }
    withAnimation(.spring(duration: 0.5, bounce: 0.35).delay(0.35)) { winnerShown = true }
  }
}

/// 順位表の 1 行。順位の数字は最初から見せ、名前と点数の板がめくれて開く
private struct RankRow: View {
  let place: Int?
  let player: PlayerResult
  let isOpen: Bool
  let isWinner: Bool

  var body: some View {
    HStack(spacing: 12) {
      Text(place.map(String.init) ?? "–")
        .font(Theme.font(22, .black))
        .monospacedDigit()
        .foregroundStyle(isWinner ? Theme.accent : Theme.muted)
        .frame(width: 30)
      Color.clear
        .frame(height: 58)
        .modifier(FlapEffect(progress: isOpen ? 1 : 0, closed: closedFace, open: openFace))
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(accessibilityText)
  }

  private var closedFace: some View {
    Text("？？？")
      .font(Theme.font(19, .heavy))
      .foregroundStyle(Theme.gray)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Theme.line, in: RoundedRectangle(cornerRadius: 18))
  }

  private var openFace: some View {
    HStack(spacing: 12) {
      Avatar(name: player.name, color: player.color, size: 40)
      Text(player.name)
        .font(Theme.font(19, .heavy))
        .lineLimit(1)
      Spacer(minLength: 8)
      if let score = player.score {
        PointsText(total: score.total)
          .foregroundStyle(isWinner ? Theme.accent : Theme.ink)
      } else {
        Text("採点できませんでした")
          .font(Theme.font(13, .heavy))
          .foregroundStyle(Theme.gray)
          .fixedSize()
      }
    }
    .padding(.horizontal, 14)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
    .overlay {
      if isWinner {
        RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.accent, lineWidth: 3)
      }
    }
    .shadow(color: Theme.ink.opacity(0.07), radius: 8, y: 4)
  }

  private var accessibilityText: String {
    guard isOpen else { return "\(place.map { "\($0) 位" } ?? "")、まだ開いていません" }
    let score = player.score.map { "\($0.total) 点" } ?? "採点できませんでした"
    return "\(place.map { "\($0) 位" } ?? "順位なし")、\(player.name)、\(score)"
  }
}

/// 板がめくれる動き（X 軸のまわりに回す）。半分までは閉じた面、そこからは開いた面を見せる
private struct FlapEffect<Closed: View, Open: View>: ViewModifier, Animatable {
  /// 0 で閉じている、1 で開いている
  var progress: Double
  let closed: Closed
  let open: Open

  var animatableData: Double {
    get { progress }
    set { progress = newValue }
  }

  func body(content: Content) -> some View {
    let angle = progress * 180
    content.overlay {
      if progress < 0.5 {
        closed.rotation3DEffect(.degrees(angle), axis: (x: 1, y: 0, z: 0), perspective: 0.4)
      } else {
        open.rotation3DEffect(.degrees(angle - 180), axis: (x: 1, y: 0, z: 0), perspective: 0.4)
      }
    }
  }
}

/// 優勝の表示
private struct WinnerBanner: View {
  let player: PlayerResult

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Image(systemName: "crown.fill")
        .font(.system(size: 24, weight: .bold))
        .foregroundStyle(Theme.accent)
      Text("優勝")
        .font(Theme.font(18, .heavy))
        .foregroundStyle(Theme.muted)
      Text(player.name)
        .font(Theme.font(30, .black))
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
    .accessibilityElement(children: .combine)
  }
}

#Preview("ホスト・5 人") {
  ResultFlowView(results: .previewFive, isHost: true, onAgain: {}, onLeave: {})
}

#Preview("参加者・8 人と採点できなかった人") {
  ResultFlowView(results: .previewEight, isHost: false, onAgain: {}, onLeave: {})
}
