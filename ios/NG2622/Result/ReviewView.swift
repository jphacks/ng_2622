import SwiftUI

/// 振り返り。自分の合計と順位、3 項目の内訳、講評と模範表現
struct ReviewView: View {
  let results: RoundResults
  let onBack: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      ResultSubHeader(title: "振り返り", onBack: onBack)
        .resultColumn()
        .padding(.top, 8)
      if let me = results.me, let score = me.score, let review = results.myReview {
        ScrollView {
          content(me: me, score: score, review: review)
            .resultColumn()
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
      } else {
        Spacer()
        Text("採点できませんでした")
          .font(Theme.font(20, .heavy))
          .foregroundStyle(Theme.muted)
        Spacer()
      }
    }
  }

  private func content(me: PlayerResult, score: PlayerResult.Score, review: RoundResults.Review) -> some View {
    VStack(spacing: 16) {
      VStack(spacing: 2) {
        PointsText(total: score.total, size: 64)
          .foregroundStyle(Theme.accent)
        if let place = results.place(of: me) {
          Text("\(place) 位 / \(results.players.count) 人")
            .font(Theme.font(17, .heavy))
            .foregroundStyle(Theme.muted)
        }
      }
      .padding(.bottom, 4)

      VStack(spacing: 16) {
        ScoreBar(label: "内容", value: score.content)
        ScoreBar(label: "表現", value: score.expression)
        ScoreBar(label: "話し方", value: score.speaking)
      }
      .padding(20)
      .resultCard()

      // 自分が話した英文。下の模範表現と見比べる
      if !me.transcript.isEmpty {
        TranscriptCard(transcript: me.transcript)
      }

      ReviewCard(title: "講評") {
        Text(review.comment)
          .font(Theme.font(16, .bold))
          .lineSpacing(3)
      }

      ReviewCard(title: "模範表現") {
        VStack(alignment: .leading, spacing: 8) {
          Text(review.modelSentence)
            .font(Theme.font(19, .heavy))
            .foregroundStyle(Theme.accent)
          Text(review.modelSentenceJa)
            .font(Theme.font(14, .bold))
            .foregroundStyle(Theme.muted)
        }
      }
    }
  }
}

/// 項目の点数のバー。開いたときに左から伸びる
private struct ScoreBar: View {
  let label: String
  let value: Int
  @State private var grown = false

  var body: some View {
    VStack(spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        Text(label).font(Theme.font(17, .heavy))
        Spacer()
        PointsText(total: value, size: 20)
      }
      GeometryReader { geo in
        Capsule()
          .fill(Theme.accentSoft)
          .overlay(alignment: .leading) {
            Capsule()
              .fill(Theme.accent)
              .frame(width: grown ? geo.size.width * Double(min(100, max(0, value))) / 100 : 0)
          }
      }
      .frame(height: 12)
    }
    .accessibilityElement(children: .combine)
    .onAppear {
      withAnimation(.easeOut(duration: 0.7).delay(0.15)) { grown = true }
    }
  }
}

/// あなたの描写。見出しの右には、録音を聞き直すボタンを後で足す
private struct TranscriptCard: View {
  let transcript: String

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("あなたの描写")
          .font(Theme.font(13, .heavy))
          .foregroundStyle(Theme.muted)
        Spacer()
      }
      .frame(minHeight: 22)
      Text(transcript)
        .font(Theme.font(17, .bold))
        .lineSpacing(5)
        .foregroundStyle(Theme.ink)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
  }
}

private struct ReviewCard<Content: View>: View {
  let title: String
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title)
        .font(Theme.font(13, .heavy))
        .foregroundStyle(Theme.muted)
      content
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
  }
}

#Preview("採点できた") {
  ReviewView(results: .previewFive, onBack: {})
    .background(Theme.background)
}

#Preview("採点できなかった") {
  ReviewView(results: .previewSelfUngraded, onBack: {})
    .background(Theme.background)
}
