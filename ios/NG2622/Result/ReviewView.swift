import SwiftUI

/// 振り返り。自分の合計と順位、3 項目の内訳、講評（できたこと・次はこれ・言い換え・話し方のコツ）
struct ReviewView: View {
  let results: RoundResults
  /// このラウンドで録った自分の声。あれば「あなたの描写」から聞き直せる
  var recording: RecordedAudio?
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

      // 自分が話した英文。下の講評の引用と見比べる
      if !me.transcript.isEmpty {
        TranscriptCard(transcript: me.transcript, recording: recording)
      }

      ReviewCard(title: "できたこと") {
        VStack(alignment: .leading, spacing: 8) {
          if !review.strengthQuote.isEmpty {
            Text("“\(review.strengthQuote)”")
              .font(Theme.font(17, .heavy))
              .foregroundStyle(Theme.accent)
          }
          bodyText(review.strength)
        }
      }

      ReviewCard(title: "次はこれ", badge: review.nextStepGain.map { "+\($0) 点" }) {
        bodyText(review.nextStep)
      }

      if let rewrite = review.rewrite {
        ReviewCard(title: "こう言い換える") {
          VStack(alignment: .leading, spacing: 8) {
            Text(rewrite.before)
              .font(Theme.font(15, .bold))
              .strikethrough()
              .foregroundStyle(Theme.muted)
            Text(rewrite.after)
              .font(Theme.font(19, .heavy))
              .foregroundStyle(Theme.accent)
            Text(rewrite.reason)
              .font(Theme.font(14, .bold))
              .foregroundStyle(Theme.muted)
          }
        }
      }

      ReviewCard(title: "話し方のコツ") {
        bodyText(review.speechTip)
      }
    }
  }

  private func bodyText(_ text: String) -> some View {
    Text(text)
      .font(Theme.font(16, .bold))
      .lineSpacing(3)
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

/// あなたの描写。録音があれば、見出しの右のボタンで聞き直せる（再生中はカードの地を薄い紫にする）
private struct TranscriptCard: View {
  let transcript: String
  let recording: RecordedAudio?
  @State private var player = VoicePlayer()

  /// 端末にファイルが残っているときだけボタンを出す
  private var playable: RecordedAudio? {
    guard let recording, FileManager.default.fileExists(atPath: recording.url.path) else { return nil }
    return recording
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("あなたの描写")
          .font(Theme.font(13, .heavy))
          .foregroundStyle(Theme.muted)
        Spacer()
        if let playable {
          speakerButton(playable)
        }
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
    // 再生中は板の地を薄い紫にする（形と影は resultCard と同じ）
    .background(player.isPlaying ? Theme.accentSoft : Theme.card, in: RoundedRectangle(cornerRadius: 22))
    .shadow(color: Theme.ink.opacity(0.07), radius: 10, y: 6)
    .animation(.easeInOut(duration: 0.2), value: player.isPlaying)
    .onDisappear { player.stop() }
  }

  private func speakerButton(_ audio: RecordedAudio) -> some View {
    Button {
      player.toggle(audio)
    } label: {
      Image(systemName: player.isPlaying ? "stop.fill" : "speaker.wave.2.fill")
        .font(.system(size: player.isPlaying ? 13 : 15, weight: .bold))
        .foregroundStyle(Theme.accent)
        .frame(width: 32, height: 32)
        .background(player.isPlaying ? Theme.card : Theme.accentSoft, in: Circle())
        .contentTransition(.symbolEffect(.replace))
    }
    .accessibilityLabel(player.isPlaying ? "停止" : "自分の録音を再生")
  }
}

private struct ReviewCard<Content: View>: View {
  let title: String
  /// 見出しの右に出す小さな札（例: +10 点）
  var badge: String? = nil
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text(title)
          .font(Theme.font(13, .heavy))
          .foregroundStyle(Theme.muted)
        Spacer()
        if let badge {
          Text(badge)
            .font(Theme.font(13, .heavy))
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(Theme.accentSoft, in: Capsule())
        }
      }
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
