import SwiftUI

/// 結果発表。人ごとのカード（順位・名前・合計、3 つの軸の細い棒、チェックの数）を、
/// 最下位から 1 枚ずつパタパタと開き、1 位が開いたら優勝を出す。自分のカードは枠と「あなた」の札で目立たせる
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

  /// 遊んだ場面の難易度（配置の JSON から）。取れるまで出さない
  @State private var difficulty: SceneDifficulty?

  private var players: [PlayerResult] { results.players }
  private var winner: PlayerResult? { players.first.flatMap { $0.score == nil ? nil : $0 } }

  var body: some View {
    GeometryReader { geo in
      ScrollView {
        VStack(spacing: 0) {
          Text("結果発表")
            .font(Theme.font(26, .black))
            .padding(.top, 24)
          Group {
            if let difficulty {
              DifficultyChip(difficulty: difficulty)
            }
          }
          .frame(height: 30)
          .padding(.top, 6)
          .padding(.bottom, 12)
          board
          Text(RoundResults.Weights.caption)
            .font(Theme.font(13, .heavy))
            .foregroundStyle(Theme.muted)
            .padding(.top, 14)
          if winnerShown, let winner {
            WinnerBanner(player: winner)
              .padding(.top, 20)
              .transition(.scale(scale: 0.6).combined(with: .opacity))
          }
          Spacer(minLength: 28)
          // 評価するのは作り置きの場面だけ。部屋がその場で AI で作った場面は使い回さないので評価しない
          // （バックエンドも /scenes/{id}/reviews を受け付けない）
          if winnerShown, let me = results.me, ScenePool.bundled.contains(results.sceneID) {
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
    .task(id: results.sceneID) {
      difficulty = try? await SceneLayouts.store.layout(of: results.sceneID, room: results.room).difficulty
    }
    .sensoryFeedback(.impact(weight: .light), trigger: openCount)
    .sensoryFeedback(.success, trigger: winnerShown)
  }

  // MARK: - 順位表

  private var board: some View {
    VStack(spacing: 12) {
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

/// 順位表の 1 枚。順位の数字は最初から見せ、カードがめくれて開く
private struct RankRow: View {
  let place: Int?
  let player: PlayerResult
  let isOpen: Bool
  let isWinner: Bool

  var body: some View {
    // 開いた面の大きさで場所を取り、その上でめくる
    openFace
      .hidden()
      .modifier(FlapEffect(progress: isOpen ? 1 : 0, closed: closedFace, open: openFace))
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(accessibilityText)
  }

  private var placeBadge: some View {
    let first = place == 1
    return Text(place.map(String.init) ?? "–")
      .font(Theme.font(20, .black))
      .monospacedDigit()
      .foregroundStyle(first ? .white : Theme.accent)
      .frame(width: 38, height: 38)
      .background(first ? Theme.accent : Theme.accentSoft, in: Circle())
  }

  private var closedFace: some View {
    HStack(spacing: 12) {
      placeBadge
      Text("？？？")
        .font(Theme.font(19, .heavy))
        .foregroundStyle(Theme.gray)
        .frame(maxWidth: .infinity)
    }
    .padding(.horizontal, 16)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Theme.line, in: RoundedRectangle(cornerRadius: 22))
  }

  private var openFace: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        placeBadge
        Text(player.name)
          .font(Theme.font(20, .heavy))
          .lineLimit(1)
        if player.isSelf { SelfBadge() }
        Spacer(minLength: 8)
        if let score = player.score {
          PointsText(total: score.total, size: 30)
            .foregroundStyle(isWinner ? Theme.accent : Theme.ink)
        }
      }
      if let score = player.score {
        VStack(spacing: 6) {
          AxisBar(label: "内容", value: score.content)
          AxisBar(label: "表現", value: score.expression)
          AxisBar(label: "話し方", value: score.speaking)
        }
        if let content = player.content {
          ContentCounts(content: content)
            .padding(.leading, 4)
        }
      } else {
        Text("採点できませんでした")
          .font(Theme.font(14, .heavy))
          .foregroundStyle(Theme.gray)
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 22))
    .overlay {
      if player.isSelf {
        RoundedRectangle(cornerRadius: 22).strokeBorder(Theme.accent, lineWidth: 2.5)
      }
    }
    .shadow(color: Theme.ink.opacity(0.07), radius: 8, y: 4)
  }

  private var accessibilityText: String {
    guard isOpen else { return "\(place.map { "\($0) 位" } ?? "")、まだ開いていません" }
    let you = player.isSelf ? "（あなた）" : ""
    guard let score = player.score else {
      return "\(place.map { "\($0) 位" } ?? "順位なし")、\(player.name)\(you)、採点できませんでした"
    }
    var text =
      "\(place.map { "\($0) 位" } ?? "順位なし")、\(player.name)\(you)、\(score.total) 点。"
      + "内容 \(score.content)、表現 \(score.expression)、話し方 \(score.speaking)"
    if let content = player.content {
      text += "。チェック \(content.fullCount)、一部 \(content.partialCount)、合わない \(content.mismatchCount)"
    }
    return text
  }
}

/// カードの中の細い棒（内容・表現・話し方）
private struct AxisBar: View {
  let label: String
  let value: Int

  var body: some View {
    HStack(spacing: 10) {
      Text(label)
        .font(Theme.font(13, .heavy))
        .foregroundStyle(Theme.muted)
        .frame(width: 44, alignment: .leading)
      GeometryReader { geo in
        Capsule()
          .fill(Theme.accentSoft)
          .overlay(alignment: .leading) {
            Capsule()
              .fill(Theme.accent)
              .frame(width: geo.size.width * Double(min(100, max(0, value))) / 100)
          }
      }
      .frame(height: 8)
      PointsText(total: value, size: 16)
        .frame(width: 48, alignment: .trailing)
    }
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
