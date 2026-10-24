import SwiftUI

/// みんなの描写。全員の文字起こしを点数順に並べ、講評の一言を添える
struct EveryoneView: View {
  let results: RoundResults
  let onBack: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      ResultSubHeader(title: "みんなの描写", onBack: onBack)
        .resultColumn()
        .padding(.top, 8)
      ScrollView {
        VStack(spacing: 14) {
          ForEach(results.players) { p in
            TranscriptCard(player: p)
          }
        }
        .resultColumn()
        .padding(.top, 12)
        .padding(.bottom, 24)
      }
    }
  }
}

private struct TranscriptCard: View {
  let player: PlayerResult

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 10) {
        Avatar(name: player.name, color: player.color, size: 36)
        Text(player.name)
          .font(Theme.font(17, .heavy))
          .lineLimit(1)
        if player.isSelf { SelfBadge() }
        Spacer(minLength: 8)
        if let score = player.score {
          PointsText(total: score.total, size: 22)
        }
      }
      if player.score == nil {
        Text("採点できませんでした")
          .font(Theme.font(15, .bold))
          .foregroundStyle(Theme.gray)
      } else {
        Text(player.transcript)
          .font(Theme.font(17, .semibold))
          .lineSpacing(3)
          .fixedSize(horizontal: false, vertical: true)
        if !player.comment.isEmpty {
          Text(player.comment)
            .font(Theme.font(14, .bold))
            .foregroundStyle(Theme.muted)
            .padding(.leading, 10)
            .overlay(alignment: .leading) {
              Capsule().fill(Theme.accentSoft).frame(width: 3)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
    .accessibilityElement(children: .combine)
  }
}

#Preview {
  EveryoneView(results: .previewEight, onBack: {})
    .background(Theme.background)
}
