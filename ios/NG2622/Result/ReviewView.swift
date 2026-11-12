import SwiftUI

/// 振り返り。自分の合計と順位、3 項目の内訳、講評（できたこと・次はこれ・言い換え・話し方のコツ）
struct ReviewView: View {
  let results: RoundResults
  /// このラウンドで録った自分の声。あれば「あなたの描写」から聞き直せる
  var recording: RecordedAudio?
  let onBack: () -> Void

  /// 発音のお手本の読み上げ（言い換えの文と単語で 1 つを使い、同時に鳴らさない）
  @State private var voice = ModelVoice()

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
    .onDisappear { voice.stop() }
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
        TranscriptCard(transcript: me.transcript, words: review.words, recording: recording, voice: voice)
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

      ReviewCard(title: "次はこれ", badge: review.nextStepBadge) {
        bodyText(review.nextStep)
      }

      if let rewrite = review.rewrite {
        ReviewCard(title: "こう言い換える") {
          VStack(alignment: .leading, spacing: 8) {
            Text(rewrite.before)
              .font(Theme.font(15, .bold))
              .strikethrough()
              .foregroundStyle(Theme.muted)
            HStack(alignment: .top, spacing: 10) {
              Text(rewrite.after)
                .font(Theme.font(19, .heavy))
                .foregroundStyle(Theme.accent)
                .frame(maxWidth: .infinity, alignment: .leading)
              let speaking = voice.speakingText == rewrite.after
              SpeakButton(isPlaying: speaking, label: "言い換えの文のお手本を聞く") {
                if speaking { voice.stop() } else { voice.speak(rewrite.after) }
              }
            }
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

/// あなたの描写。録音があれば、見出しの右のボタンで聞き直せる（再生中はカードの地を薄い紫にする）。
/// 単語ごとの点が届いていれば単語を押せるようにし、押すとお手本の読み上げのあとに自分の録音のその単語を流す。
/// 60 点未満の単語だけ色を付け、点の数字は出さない
private struct TranscriptCard: View {
  let transcript: String
  let words: [SpokenWord]
  let recording: RecordedAudio?
  let voice: ModelVoice
  @State private var player = VoicePlayer()
  /// 単語の聞き比べで、自分の録音のその単語を流す（カード全体の再生とは分ける）
  @State private var wordPlayer = VoicePlayer()
  /// 聞き比べている単語（文字起こしの何語目か）
  @State private var comparing: Int?

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
      if words.isEmpty {
        Text(transcript)
          .font(Theme.font(17, .bold))
          .lineSpacing(5)
          .foregroundStyle(Theme.ink)
          .fixedSize(horizontal: false, vertical: true)
      } else {
        wordList
        Text("単語を押すと、お手本と自分の声を続けて聞けます。赤い単語は発音を見直したい単語です。")
          .font(Theme.font(13, .bold))
          .foregroundStyle(Theme.muted)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    // 再生中は板の地を薄い紫にする（形と影は resultCard と同じ）
    .background(player.isPlaying ? Theme.accentSoft : Theme.card, in: RoundedRectangle(cornerRadius: 22))
    .shadow(color: Theme.ink.opacity(0.07), radius: 10, y: 6)
    .animation(.easeInOut(duration: 0.2), value: player.isPlaying)
    .onDisappear {
      player.stop()
      wordPlayer.stop()
    }
  }

  private func speakerButton(_ audio: RecordedAudio) -> some View {
    SpeakButton(isPlaying: player.isPlaying, label: "自分の録音を再生") {
      stopComparing()
      player.toggle(audio)
    }
  }

  /// 文字起こしの語を並べる。単語ごとの点に当たった語だけ押せる
  private var wordList: some View {
    let tokens = SpokenWord.align(transcript: transcript, words: words)
    return FlowLayout(spacing: 2, lineSpacing: 4) {
      ForEach(Array(tokens.enumerated()), id: \.offset) { i, item in
        // お手本を読んでいる間と、自分の録音のその単語を流している間だけ地を付ける
        let active =
          comparing == i && (wordPlayer.isPlaying || (item.word != nil && voice.speakingText == item.word?.word))
        // 押せる語には点線の下線を引き、押せることが分かるようにする
        let label = Text(item.token)
          .underline(
            item.word != nil, pattern: .dot, color: item.word?.isWeak == true ? Theme.red : Theme.gray)
          .font(Theme.font(17, .bold))
          .foregroundStyle(item.word?.isWeak == true ? Theme.red : Theme.ink)
          .padding(.horizontal, 3)
          .padding(.vertical, 2)
          .background(active ? Theme.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6))
        if let word = item.word {
          Button {
            compare(word, at: i)
          } label: {
            label
          }
          .buttonStyle(.plain)
          .accessibilityLabel(item.token)
          .accessibilityHint(
            word.isWeak ? "発音を見直したい単語。お手本と自分の声を続けて聞く" : "お手本と自分の声を続けて聞く")
        } else {
          label
        }
      }
    }
  }

  /// お手本の読み上げのあとに、自分の録音のその単語の部分を流す。録音が無ければお手本だけ
  private func compare(_ word: SpokenWord, at index: Int) {
    player.stop()
    wordPlayer.stop()
    comparing = index
    let audio = playable
    voice.speak(word.word) { [wordPlayer] in
      if let audio { wordPlayer.play(audio, segment: word.segment) }
    }
  }

  private func stopComparing() {
    comparing = nil
    voice.stop()
    wordPlayer.stop()
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
