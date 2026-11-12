import SwiftUI

/// 振り返り。上から、難易度・合計・順位、3 つの軸の棒、あなたの描写（下線）、場面のチェック、場面と合わない描写、
/// 次の一つ、見本の答え、言い直してみよう、話し方の一言
struct ReviewView: View {
  let results: RoundResults
  /// このラウンドで録った自分の声。あれば「あなたの描写」から聞き直せる
  var recording: RecordedAudio?
  /// 見出し。きろくから開き直したときは、日付と場面の名前にする
  var title = "振り返り"
  /// きろくに残っている、遊んだときの場面の配置。あれば ID で取りに行かずにこれを使い、上に場面の 3D も出す
  /// （作り置きから外した場面や、部屋が閉じた AI の場面は、ID では取れない）
  var savedLayout: SceneLayout? = nil
  /// savedLayout の 3D を覚える名前（SceneLibrary）
  var savedSceneKey: String? = nil
  /// 順位を出すか。きろくから開き直したときは、自分 1 人分しか無いので出さない
  var showsPlace = true
  let onBack: () -> Void

  /// 遊んだ場面の配置の JSON（難易度・見本の答え・チェックリスト）。取れるまでは、それを使う所を出さない
  @State private var layout: SceneLayout?

  var body: some View {
    VStack(spacing: 0) {
      ResultSubHeader(title: title, onBack: onBack)
        .resultColumn()
        .padding(.top, 8)
      // 点数があれば出す。講評（feedback）が届かなかったときは、講評のカード（次の一つ・言い直し・話し方）だけ出さない
      if let me = results.me, let score = me.score {
        ScrollView {
          content(me: me, score: score, review: results.myReview)
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
    .task(id: results.sceneID) {
      if let savedLayout {
        layout = savedLayout
        return
      }
      // 3D を出すときに取ってあるので、ふつうは通信しない
      layout = try? await SceneLayouts.store.layout(of: results.sceneID, room: results.room)
    }
  }

  private func content(me: PlayerResult, score: PlayerResult.Score, review: RoundResults.Review?) -> some View {
    VStack(spacing: 16) {
      if let savedLayout, let savedSceneKey {
        // 開き直したときは、どの場面だったかを先に見せる（遊んだ直後は、見たばかりなので出さない）
        RecordSceneView(layout: savedLayout, key: savedSceneKey, distance: 5.2)
          .frame(maxWidth: .infinity)
          .frame(height: 200)
      }
      VStack(spacing: 4) {
        if let difficulty = layout?.difficulty {
          DifficultyChip(difficulty: difficulty)
        }
        PointsText(total: score.total, size: 64)
          .foregroundStyle(Theme.accent)
        if showsPlace, let place = results.place(of: me) {
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

      if !me.transcript.isEmpty {
        TranscriptCard(transcript: me.transcript, claims: me.content?.claims ?? [], recording: recording)
      }

      if let content = me.content {
        ChecklistCard(content: content)
        if content.mismatchCount > 0 {
          MismatchCard(content: content)
        }
      }

      if let review {
        NextStepCard(step: review.nextStep)
      }

      if let layout, let description = layout.description, !description.isEmpty {
        ModelAnswerCard(
          lines: ModelAnswerLines.lines(
            description: description, checklist: layout.checklist, items: me.content?.items ?? []))
      }

      if let rewrite = review?.rewrite {
        RewriteCard(rewrite: rewrite)
      }

      if let tip = review?.speechTip {
        ReviewCard(title: "話し方の一言", chip: tip.aspect.label) {
          Text(tip.text)
            .font(Theme.font(18, .heavy))
            .lineSpacing(3)
        }
      }
    }
  }
}

/// 項目の点数のバー。開いたときに左から伸びる
struct ScoreBar: View {
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

/// あなたの描写。描写ごとに下線を引く（チェックに当たった・一部・おまけ・場面と合わない）。
/// 録音があれば、見出しの右のボタンで聞き直せる（再生中はカードの地を薄い紫にする）
private struct TranscriptCard: View {
  let transcript: String
  let claims: [ContentBreakdown.Claim]
  let recording: RecordedAudio?
  @State private var player = VoicePlayer()

  /// 端末にファイルが残っているときだけボタンを出す
  private var playable: RecordedAudio? {
    guard let recording, FileManager.default.fileExists(atPath: recording.url.path) else { return nil }
    return recording
  }

  var body: some View {
    let marks = TranscriptMarks.marks(transcript: transcript, claims: claims)
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        CardTitle("あなたの描写")
        Spacer()
        if let playable {
          speakerButton(playable)
        }
      }
      .frame(minHeight: 22)
      markedText(transcript, marks: marks)
        .textRenderer(MarkedTextRenderer())
        .font(Theme.font(17, .bold))
        .lineSpacing(9)
        .foregroundStyle(Theme.ink)
        .fixedSize(horizontal: false, vertical: true)
      if !marks.isEmpty {
        Legend(kinds: [.hit, .partial, .bonus, .mismatch].filter { kind in marks.contains { $0.mark == kind } })
          .padding(.top, 2)
      }
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

/// 下線の凡例
private struct Legend: View {
  let kinds: [TextMark]

  var body: some View {
    // 4 つ並ぶとカードの幅を超えるので、収まらない分は次の行へ折り返す
    FlowLayout(spacing: 12, lineSpacing: 6) {
      ForEach(kinds, id: \.self) { kind in
        HStack(spacing: 5) {
          Canvas { ctx, size in
            draw(kind, in: &ctx, size: size)
          }
          .frame(width: 20, height: 8)
          Text(label(kind))
            .font(Theme.font(11, .bold))
            .foregroundStyle(Theme.muted)
            .fixedSize()
        }
      }
    }
    .accessibilityElement(children: .combine)
  }

  private func label(_ kind: TextMark) -> String {
    switch kind {
    case .hit: "チェックに当たった"
    case .partial: "一部"
    case .bonus: "おまけ"
    case .mismatch: "場面と合わない"
    case .highlight: ""
    }
  }

  private func draw(_ kind: TextMark, in ctx: inout GraphicsContext, size: CGSize) {
    let y = size.height / 2
    var line = Path()
    line.move(to: CGPoint(x: 1, y: y))
    line.addLine(to: CGPoint(x: size.width - 1, y: y))
    switch kind {
    case .hit:
      ctx.stroke(line, with: .color(Theme.accent), style: StrokeStyle(lineWidth: 2.4, lineCap: .round))
    case .partial:
      ctx.stroke(line, with: .color(Theme.accent), style: StrokeStyle(lineWidth: 2.4, lineCap: .round, dash: [5, 3.5]))
    case .bonus:
      ctx.stroke(line, with: .color(Theme.gray), style: StrokeStyle(lineWidth: 1.3, lineCap: .round))
    case .mismatch:
      ctx.stroke(
        MarkedTextRenderer.wave(from: 1, to: size.width - 1, y: y), with: .color(Theme.mismatch),
        style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
    case .highlight:
      break
    }
  }
}

/// 場面のチェック。言えた項目は札で、言えていない・一部の項目は「あと少し」に並べる
private struct ChecklistCard: View {
  let content: ContentBreakdown

  var body: some View {
    let done = content.items.filter { $0.level == .full }
    let rest = content.items.filter { $0.level != .full }
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline) {
        CardTitle("場面のチェック")
        Spacer()
        CardNote(
          "言えた \(ContentBreakdown.number(content.recall.earned)) / \(ContentBreakdown.number(content.recall.max))")
      }
      if !done.isEmpty {
        FlowLayout(spacing: 6, lineSpacing: 6) {
          ForEach(done) { item in
            HStack(spacing: 5) {
              Image(systemName: "checkmark")
                .font(.system(size: 12, weight: .black))
                .foregroundStyle(Theme.accent)
              Text(item.label)
                .font(Theme.font(14, .heavy))
                .foregroundStyle(Theme.ink)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Theme.accentSoft, in: Capsule())
          }
        }
      }
      if !rest.isEmpty {
        if !done.isEmpty {
          Rectangle().fill(Theme.line).frame(height: 1.5)
        }
        Text("あと少し")
          .font(Theme.font(13, .heavy))
          .foregroundStyle(Theme.muted)
        VStack(alignment: .leading, spacing: 10) {
          ForEach(rest) { item in
            HStack(spacing: 10) {
              LevelIcon(level: item.level)
              KindChip(kind: item.kind)
              Text(item.label)
                .font(Theme.font(15, .bold))
                .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
          }
        }
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
  }
}

/// 項目の達成の印。full は塗りのチェック、partial は半分塗りの丸、none は空の丸
struct LevelIcon: View {
  let level: ContentBreakdown.Level
  var size: CGFloat = 22

  var body: some View {
    ZStack {
      switch level {
      case .full:
        Circle().fill(Theme.accent)
        Image(systemName: "checkmark")
          .font(.system(size: size * 0.5, weight: .black))
          .foregroundStyle(.white)
      case .partial:
        Circle().fill(Theme.card)
        Circle()
          .fill(Theme.accent)
          .mask(alignment: .leading) { Rectangle().frame(width: size / 2) }
        Circle().strokeBorder(Theme.accent, lineWidth: 2)
      case .none:
        Circle().strokeBorder(Theme.gray, lineWidth: 2)
      }
    }
    .frame(width: size, height: size)
    .accessibilityLabel(level == .full ? "言えた" : level == .partial ? "一部" : "まだ")
  }
}

/// 項目の種類の札（中心・理由・つながり・細部）
private struct KindChip: View {
  let kind: ChecklistKind

  var body: some View {
    Text(kind.label)
      .font(Theme.font(13, .heavy))
      .foregroundStyle(Theme.accent)
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 8))
      .fixedSize()
  }
}

/// 場面と合わない描写（矛盾・場面に無い・関係が無い）
private struct MismatchCard: View {
  let content: ContentBreakdown

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline) {
        CardTitle("場面と合わない描写")
        Spacer()
        CardNote("正しさ \(content.precision.correct) / \(content.precision.said)")
      }
      ForEach(Array(content.claims.filter(\.isMismatch).enumerated()), id: \.offset) { _, claim in
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          Image(systemName: "xmark")
            .font(.system(size: 15, weight: .black))
            .foregroundStyle(Theme.mismatch)
          VStack(alignment: .leading, spacing: 4) {
            Text(claim.quote)
              .font(Theme.font(17, .heavy))
            if let note = claim.note, !note.isEmpty {
              Text(note)
                .font(Theme.font(14, .bold))
                .foregroundStyle(Theme.muted)
            }
          }
          .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
  }
}

/// 次の一つ。薄い紫の地で目立たせ、伸びる点があれば右に「+N 点」
private struct NextStepCard: View {
  let step: RoundResults.Review.NextStep

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      CardTitle("次の一つ")
      HStack(spacing: 12) {
        Text(step.text)
          .font(Theme.font(17, .heavy))
          .lineSpacing(3)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: .infinity, alignment: .leading)
        if let badge = step.badge {
          Text(badge)
            .font(Theme.font(17, .heavy))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Theme.accent, in: Capsule())
            .fixedSize()
        }
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.accentSoft.opacity(0.75), in: RoundedRectangle(cornerRadius: 22))
    .overlay {
      RoundedRectangle(cornerRadius: 22).strokeBorder(Theme.accent.opacity(0.18), lineWidth: 1.5)
    }
    .shadow(color: Theme.ink.opacity(0.07), radius: 10, y: 6)
    .accessibilityElement(children: .combine)
  }
}

/// 見本の答え。1 文ずつ、その文に結んだ項目の達成の印を左に付け、まだ言えていない所を薄い紫の地にする
private struct ModelAnswerCard: View {
  let lines: [ModelAnswerLines.Line]

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      CardTitle("見本の答え")
        .padding(.bottom, 8)
      ForEach(lines) { line in
        if line.id > 0 {
          Rectangle().fill(Theme.line).frame(height: 1.5)
        }
        HStack(alignment: .center, spacing: 12) {
          Group {
            if let level = line.level {
              LevelIcon(level: level, size: 24)
            } else {
              Color.clear
            }
          }
          .frame(width: 24, height: 24)
          markedText(line.text, marks: line.marks)
            .textRenderer(MarkedTextRenderer())
            .font(Theme.font(17, .heavy))
            .lineSpacing(6)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
      }
      if lines.contains(where: { $0.level != nil }) {
        HStack(spacing: 18) {
          HStack(spacing: 5) {
            Image(systemName: "checkmark")
              .font(.system(size: 12, weight: .black))
              .foregroundStyle(Theme.accent)
            Text("言えた")
          }
          if lines.contains(where: { !$0.marks.isEmpty }) {
            HStack(spacing: 5) {
              RoundedRectangle(cornerRadius: 4).fill(Theme.accentSoft).frame(width: 18, height: 12)
              Text("次に言ってみよう")
            }
          }
        }
        .font(Theme.font(12, .bold))
        .foregroundStyle(Theme.muted)
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
  }
}

/// 言い直してみよう。自分の一文（小さく灰色）→ 直した文（太字）→ 理由
private struct RewriteCard: View {
  let rewrite: RoundResults.Review.Rewrite

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      CardTitle("言い直してみよう")
      Text(rewrite.before)
        .font(Theme.font(15, .bold))
        .foregroundStyle(Theme.muted)
      Image(systemName: "arrow.down")
        .font(.system(size: 18, weight: .heavy))
        .foregroundStyle(Theme.accent)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
      Text(rewrite.after)
        .font(Theme.font(21, .heavy))
        .foregroundStyle(Theme.ink)
      Text(rewrite.reason)
        .font(Theme.font(14, .bold))
        .foregroundStyle(Theme.muted)
    }
    .fixedSize(horizontal: false, vertical: true)
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
  }
}

private struct ReviewCard<Content: View>: View {
  let title: String
  /// 見出しの右に出す小さな札（例: 流ちょうさ）
  var chip: String? = nil
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        CardTitle(title)
        if let chip {
          Text(chip)
            .font(Theme.font(13, .heavy))
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(Theme.accentSoft, in: Capsule())
        }
        Spacer()
      }
      content
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
  }
}

/// カードの見出し
private struct CardTitle: View {
  let text: String
  init(_ text: String) { self.text = text }

  var body: some View {
    Text(text)
      .font(Theme.font(14, .heavy))
      .foregroundStyle(Theme.muted)
  }
}

/// カードの右上の小さな数（言えた・正しさ）
private struct CardNote: View {
  let text: String
  init(_ text: String) { self.text = text }

  var body: some View {
    Text(text)
      .font(Theme.font(13, .heavy))
      .foregroundStyle(Theme.muted)
      .monospacedDigit()
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
