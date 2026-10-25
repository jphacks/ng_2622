import SwiftUI

/// みんなの描写。上にこのラウンドの場面を出し、全員の文字起こしを点数順に並べ、講評の一言を添える
struct EveryoneView: View {
  let results: RoundResults
  let onBack: () -> Void
  /// 場面を回し始めた時刻
  @State private var appearedAt = Date()

  var body: some View {
    VStack(spacing: 0) {
      ResultSubHeader(title: "みんなの描写", onBack: onBack)
        .resultColumn()
        .padding(.top, 8)
      ScrollView {
        VStack(spacing: 14) {
          EveryoneScene(sceneID: results.sceneID, appearedAt: appearedAt)
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

/// このラウンドの場面。描写と見比べられるよう、ゆっくり回し続ける。触れない
private struct EveryoneScene: View {
  let sceneID: String
  let appearedAt: Date

  var body: some View {
    TimelineView(.animation) { context in
      // 1 秒に 12 度（30 秒で 1 周）。待機の画面と同じ
      let yaw = context.date.timeIntervalSince(appearedAt) * 12 - 20
      DioramaView(sceneID: sceneID, yaw: yaw, tilt: SceneOrbit.defaultTilt, distance: 4.6)
    }
    .frame(maxWidth: .infinity)
    .frame(height: 190)
    .background(Theme.background)
    .clipShape(RoundedRectangle(cornerRadius: 22))
    .allowsHitTesting(false)
    .accessibilityHidden(true)
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
