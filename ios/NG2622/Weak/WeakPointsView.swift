import SwiftUI

/// 苦手。上に「次はここ」を大きく 1 つ、その下に AI の分析（くり返す癖・良くなった点）、
/// その下の「くわしく」に、端末で数えた点の推移・どれだけ言えたか・間違いの種類。
/// 「次はここ」のカードの中に、分析から作る苦手の場面（作っている間・できた）を出し、できたら「この苦手の場面で練習する」で、
/// その場面の部屋を作る。作れなかったら、カードには出さず、画面の上に数秒のバナーで知らせる（案 A。docs/design/part-generation.md）。
/// 数える分析は記録からすぐ出し、AI の分析は作っている間・失敗したときも画面を止めない
/// （docs/design/weak-point-analysis.md。見せ方は画面設計書 v2 の weak.md）
struct WeakPointsView: View {
  let library: RecordLibrary
  let analyzer: WeakPointAnalyzer
  let onBack: () -> Void
  /// 「この苦手の場面で練習する」。その場面で練習する部屋を作る
  var onPractice: (WeakScene) -> Void = { _ in }

  /// 戻るボタンの後ろの帯の濃さ。スクロールのたびに変わるので、読むのは帯（CoverBand）だけにし、
  /// この画面の本体（数える分析と日付の表）はスクロールで作り直さない
  @State private var cover = CoverBand.Amount()
  /// 苦手の場面を作れなかったことを知らせるバナーを出しているか
  @State private var showsNotice = false

  var body: some View {
    // 数えるのは記録から毎回（覚えない）。数は多くても数百件で、すぐ終わる
    let counts = WeakPointCounts(records: library.records)
    let analysis = analyzer.analysis
    // 記録の ID から遊んだ日（実例の日付）
    let dates = Dictionary(library.records.map { ($0.id, $0.playedAt) }, uniquingKeysWith: { first, _ in first })
    // 苦手の場面（記録が足りないときは出さない）
    let enough = counts.recent.count >= WeakPointCounts.minimumRecords
    let scenePhase = enough ? analyzer.scenes?.phase ?? .idle : .idle
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        // 戻るボタンは上に浮かせて残すので、ここは見出しだけ（スクロールで流れて消える）
        VStack(spacing: 2) {
          Text("苦手")
            .font(Theme.font(20, .black))
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("weak-title")
          Text("直近 \(counts.recent.count) 回から")
            .font(Theme.font(14, .heavy))
            .foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 52)
        .padding(.top, 8)

        let showsScene = scenePhase.showsInCard
        let next = Self.next(analysis, counts: counts)
        if next != nil || showsScene {
          NextCard(content: next, showsScene: showsScene) {
            WeakSceneSection(phase: scenePhase, onPractice: onPractice)
          }
        }

        if counts.recent.count >= WeakPointCounts.minimumRecords {
          SectionTitle("くり返す癖")
            .padding(.top, 8)
          if let note = Self.note(analyzer.phase, previous: analyzer.isPrevious && analysis != nil) {
            StatusLine(text: note)
          }
          if let analysis {
            if analysis.result.habits.isEmpty {
              StatusLine(text: "くり返す癖は見つかりませんでした")
                .accessibilityIdentifier("weak-no-habits")
            } else {
              ForEach(Array(analysis.result.habits.enumerated()), id: \.offset) { _, habit in
                HabitCard(habit: habit, dates: dates)
              }
            }
            if let improvement = analysis.result.improvement {
              SectionTitle("良くなった点")
                .padding(.top, 8)
              ImprovementCard(improvement: improvement, date: dates[improvement.example.record])
            }
          } else if analyzer.phase == .loading {
            AnalyzingCard()
          }
        }

        SectionTitle("くわしく")
          .padding(.top, 8)
        TrendCard(trend: counts.trend, halves: counts.halves)
        CoverageCard(coverage: counts.coverage)
        MistakeCard(verdicts: counts.verdicts)
      }
      .resultColumn()
      .padding(.bottom, 40)
      // 苦手の場面の行が出入りするときは、カードの下の中身も一緒に動かす（カードだけが縮んで下の中身と重ならないように）
      .animation(.easeInOut(duration: 0.3), value: scenePhase)
    }
    .onAppear {
      // 開くたびに確かめる（記録が 5 件ずつ増えた・元の記録が消えたら作り直す。失敗しても、開き直すとまた頼む。
      // 苦手の場面も同じ）。
      // 待たない処理なので、最初の 1 フレームから様子（作っている間・前回の分析）がそろうよう、出る前に呼ぶ
      analyzer.open(records: library.records, existing: { [library] in Set(library.records.map(\.id)) })
    }
    // 上端は、下の帯で地の色にふさぐので、システムのぼかし（状態バーの下）は付けない
    .scrollEdgeEffectHidden(true, for: .top)
    .onScrollGeometryChange(for: CGFloat.self) { geometry in
      min(1, max(0, (geometry.contentOffset.y + geometry.contentInsets.top) / CoverBand.distance))
    } action: { [cover] _, value in
      cover.value = value
    }
    // 下にスクロールしたら、画面の上端から戻るボタンの下までを地の色でふさぐ（きろくの画面と同じ）。
    // 流れていく中身が戻るボタンの横に透けず、押しても、見えていない中身には届かない（戻るボタンは、この上に重ねる）
    .overlay(alignment: .top) {
      CoverBand(amount: cover)
    }
    .overlay(alignment: .top) {
      HStack {
        CircleIconButton(systemName: "chevron.left", label: "戻る", action: onBack)
        Spacer()
      }
      .frame(height: 52)
      .resultColumn()
      .padding(.top, 8)
    }
    // 苦手の場面を作れなかったら、画面の上に数秒だけバナーを出す（閉じている間に作れなかったときは、開いたときに出す）。
    // VoiceOver にも読み上げで知らせる
    .overlay(alignment: .top) {
      if showsNotice {
        WeakSceneNotice()
          .padding(.horizontal, 16)
          .frame(maxWidth: 378)
          .padding(.top, 4)
          .transition(.move(edge: .top).combined(with: .opacity))
      }
    }
    .animation(.spring(duration: 0.4), value: showsNotice)
    // 作っている → できた に替わったら、VoiceOver に読み上げで知らせる
    .onChange(of: scenePhase) { old, new in
      if old == .making, case .ready(let scene) = new {
        AccessibilityNotification.Announcement("苦手の場面ができました。\(scene.name)").post()
      }
    }
    .task(id: analyzer.scenes?.notices ?? 0) {
      guard let scenes = analyzer.scenes, scenes.notices > scenes.noticed else { return }
      scenes.markNoticed()
      showsNotice = true
      AccessibilityNotification.Announcement(WeakSceneNotice.text).post()
      try? await Task.sleep(for: WeakSceneNotice.duration)
      showsNotice = false
    }
  }

  /// 「次はここ」に出す中身
  struct NextContent: Equatable {
    /// 大きく出す文
    let title: String
    /// 下の一言（無ければ出さない）
    var detail: String? = nil
    /// 右上の小さな数（例: 理由 41%。無ければ出さない）
    var note: String? = nil
  }

  /// 次はここ: AI の次に試すこと。無ければ（作っている間・失敗・確かめで落ちた・返った分析に無い）数えた結果の代わり
  static func next(_ analysis: WeakPointAnalysis?, counts: WeakPointCounts) -> NextContent? {
    if let next = analysis?.result.nextTry { return NextContent(title: next.text) }
    return counts.nextHint.map { NextContent(title: $0.title, detail: $0.detail, note: $0.rate) }
  }

  /// 癖の欄の上に出す短い 1 行。前回の分析を出しているときは、そのことも添える
  static func note(_ phase: WeakPointAnalyzer.Phase, previous: Bool) -> String? {
    switch phase {
    case .loading:
      previous ? "前回の分析です。新しい分析を作っています…" : nil
    case .failed(let failure):
      (previous ? "前回の分析です。" : "") + failureText(failure)
    case .idle, .ready:
      nil
    }
  }

  static func failureText(_ failure: WeakPointFailure) -> String {
    switch failure {
    case .rateLimited: "AI の分析は、いまは使える回数をこえています。しばらくしてから、もう一度開いてください。"
    case .unavailable: "いまは AI の分析をお休みしています。"
    case .rejected: "AI の分析を作れませんでした。"
    case .failed: "AI の分析を作れませんでした。開き直すと、もう一度作ります。"
    }
  }
}

/// 戻るボタンの後ろの帯。画面の上端から戻るボタンの下までを地の色でふさぎ、その下を少し地の色に溶かす。
/// 濃さは下にスクロールした量で決まる（一番上では 0 で、見出しを隠さない）
private struct CoverBand: View {
  /// 帯の濃さ（0〜1）。スクロールのたびに変わる
  @Observable
  final class Amount {
    var value: CGFloat = 0
  }

  /// ふさぐ高さ（安全な領域の上端から、戻るボタンの下まで。上の余白 8 ＋ ボタンの段 52）
  static let height: CGFloat = 60
  /// 帯の下の、地の色に溶かす所の高さ（押した点はここでは止めない）
  static let fade: CGFloat = 12
  /// この長さだけスクロールしたら、ふさぎ切る。見出しの次の中身（16pt 下）が帯に入る前にふさぐ
  static let distance: CGFloat = 16

  let amount: Amount

  var body: some View {
    VStack(spacing: 0) {
      Theme.background
        .frame(height: Self.height)
        .background(Theme.background.ignoresSafeArea(edges: .top))
      LinearGradient(colors: [Theme.background, Theme.background.opacity(0)], startPoint: .top, endPoint: .bottom)
        .frame(height: Self.fade)
        .allowsHitTesting(false)
    }
    .opacity(amount.value)
    .allowsHitTesting(amount.value > 0)
    .accessibilityHidden(true)
  }
}

/// 遊んだ日（例: 11/12）
private func dayText(_ date: Date?) -> String? {
  guard let date else { return nil }
  let c = Calendar.current.dateComponents([.month, .day], from: date)
  return "\(c.month ?? 0)/\(c.day ?? 0)"
}

// MARK: - 次はここ

/// 次はここ。薄い紫の地（振り返りの「次の一つ」と同じ見た目）。AI の次に試すこと（文 1 つ）と、
/// 数えた結果の代わり（大きな一行・下の一言・右上の種類と割合）の両方を出す。文は押せない。
/// その下に、線で区切って苦手の場面（scene）を出す
private struct NextCard<Scene: View>: View {
  /// 文。無い（数えられる種類が無い）ときは、苦手の場面だけを出す
  let content: WeakPointsView.NextContent?
  /// 苦手の場面を出すか（出さないときは区切りの線も出さない）
  let showsScene: Bool
  @ViewBuilder let scene: () -> Scene

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      if let content {
        text(content)
          .accessibilityElement(children: .combine)
          .accessibilityIdentifier("weak-next")
      }
      if showsScene {
        if content != nil {
          Rectangle()
            .fill(Theme.accent.opacity(0.22))
            .frame(height: 1.5)
        }
        scene()
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.accentSoft.opacity(0.75), in: RoundedRectangle(cornerRadius: 22))
    .overlay {
      RoundedRectangle(cornerRadius: 22).strokeBorder(Theme.accent.opacity(0.18), lineWidth: 1.5)
    }
    .shadow(color: Theme.ink.opacity(0.07), radius: 10, y: 6)
  }

  private func text(_ content: WeakPointsView.NextContent) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        Text("次はここ")
          .font(Theme.font(15, .heavy))
          .foregroundStyle(Theme.muted)
        Spacer()
        if let note = content.note {
          Text(note)
            .font(Theme.font(15, .heavy))
            .foregroundStyle(Theme.muted)
            .monospacedDigit()
        }
      }
      Text(content.title)
        .font(Theme.font(26, .black))
        .lineSpacing(3)
        .fixedSize(horizontal: false, vertical: true)
      if let detail = content.detail {
        Text(detail)
          .font(Theme.font(18, .heavy))
          .lineSpacing(3)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

// MARK: - AI の分析

/// 欄の上の短い 1 行（前回の分析・失敗・癖が 0 件）
private struct StatusLine: View {
  let text: String

  var body: some View {
    Text(text)
      .font(Theme.font(15, .bold))
      .foregroundStyle(Theme.muted)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.horizontal, 4)
      .accessibilityIdentifier("weak-status")
  }
}

/// 観点の札（内容・表現）
private struct ViewpointChip: View {
  let viewpoint: String

  var body: some View {
    Text(viewpoint == "expression" ? "表現" : "内容")
      .font(Theme.font(14, .heavy))
      .foregroundStyle(Theme.accent)
      .padding(.horizontal, 12)
      .padding(.vertical, 4)
      .background(Theme.accentSoft, in: Capsule())
  }
}

/// カードの中の小さな見出し（自分の文・直し方）
private struct InnerLabel: View {
  let text: String
  init(_ text: String) { self.text = text }

  var body: some View {
    Text(text)
      .font(Theme.font(14, .heavy))
      .foregroundStyle(Theme.muted)
  }
}

/// くり返す癖 1 件。観点の札、見出し、自分の文（実例と日付）、直し方
private struct HabitCard: View {
  let habit: WeakPointAnalysis.Habit
  /// 記録の ID から遊んだ日時
  let dates: [String: Date]

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ViewpointChip(viewpoint: habit.viewpoint)
      Text(habit.title)
        .font(Theme.font(21, .black))
        .fixedSize(horizontal: false, vertical: true)
      Rectangle().fill(Theme.line).frame(height: 1.5)
      VStack(alignment: .leading, spacing: 8) {
        InnerLabel("自分の文")
        // 同じ文を別の回でも言っていたら、1 行にまとめて「2 回」と一番新しい日を出す
        ForEach(Array(QuoteLine.group(habit.examples, dates: dates).enumerated()), id: \.offset) { _, line in
          HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(line.quote)
              .font(Theme.font(17, .heavy))
              .fixedSize(horizontal: false, vertical: true)
              .frame(maxWidth: .infinity, alignment: .leading)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              if line.count > 1 { Text("\(line.count) 回") }
              if let day = dayText(line.latest) { Text(day) }
            }
            .font(Theme.font(14, .heavy))
            .foregroundStyle(Theme.muted)
            .monospacedDigit()
            .fixedSize()
          }
        }
      }
      Rectangle().fill(Theme.line).frame(height: 1.5)
      VStack(alignment: .leading, spacing: 6) {
        InnerLabel("直し方")
        Text(habit.fix)
          .font(Theme.font(17, .heavy))
          .lineSpacing(3)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("weak-habit")
  }
}

/// 良くなった点（1 つ。引用と日付）
private struct ImprovementCard: View {
  let improvement: WeakPointAnalysis.Improvement
  let date: Date?

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(improvement.text)
        .font(Theme.font(20, .black))
        .fixedSize(horizontal: false, vertical: true)
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        Text(improvement.example.quote)
          .font(Theme.font(17, .heavy))
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: .infinity, alignment: .leading)
        if let day = dayText(date) {
          Text(day)
            .font(Theme.font(14, .heavy))
            .foregroundStyle(Theme.muted)
            .monospacedDigit()
            .fixedSize()
        }
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("weak-improvement")
  }
}

/// AI の分析を作っている間（初めて。前回の分析が無い）。灰色の仮の行と「AI が分析しています…」
private struct AnalyzingCard: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      ForEach([1.0, 0.62, 0.78], id: \.self) { width in
        GeometryReader { geo in
          Capsule()
            .fill(Theme.offlineIcon)
            .frame(width: geo.size.width * width)
        }
        .frame(height: 18)
      }
      Text("AI が分析しています…")
        .font(Theme.font(16, .heavy))
        .foregroundStyle(Theme.muted)
    }
    .padding(24)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("AI が分析しています")
    .accessibilityIdentifier("weak-analyzing")
  }
}

// MARK: - くわしく

/// 欄の見出し（くわしく）
private struct SectionTitle: View {
  let text: String
  init(_ text: String) { self.text = text }

  var body: some View {
    Text(text)
      .font(Theme.font(16, .heavy))
      .foregroundStyle(Theme.muted)
      .padding(.leading, 4)
      .accessibilityAddTraits(.isHeader)
  }
}

/// カードの見出し（点の推移など）
private struct CardHeading: View {
  let text: String
  init(_ text: String) { self.text = text }

  var body: some View {
    Text(text)
      .font(Theme.font(20, .black))
      .accessibilityAddTraits(.isHeader)
  }
}

/// 点の推移。全部の回の合計の太い線 1 本と、最後の点に「いま N点」。その下に、内容・表現・話し方の今の点と伸び。
/// 伸びは、直近 10 回の前半と後半の平均の差（数え方は docs/design/weak-point-analysis.md の「点の前半と後半」）
private struct TrendCard: View {
  let trend: [TrendPoint]
  let halves: Halves?

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .firstTextBaseline) {
        CardHeading("点の推移")
        Spacer()
        Text("全 \(trend.count) 回")
          .font(Theme.font(15, .heavy))
          .foregroundStyle(Theme.muted)
          .monospacedDigit()
      }
      TrendChart(values: trend.map(\.total))
        .frame(height: 170)
      if let now = trend.last {
        HStack(spacing: 0) {
          AxisNow(label: "内容", now: now.content, growth: halves?.growth(\.content))
          AxisDivider()
          AxisNow(label: "表現", now: now.expression, growth: halves?.growth(\.expression))
          AxisDivider()
          AxisNow(label: "話し方", now: now.speech, growth: halves?.growth(\.speech))
        }
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("weak-trend")
  }
}

/// 合計の点の折れ線（0〜100）。古い回が左
private struct TrendChart: View {
  let values: [Int]
  @State private var drawn = false

  /// 目盛りの文字の幅
  private static let gutter: CGFloat = 42
  /// 上の空き（最後の点の「いま N点」の分）
  private static let top: CGFloat = 26
  /// 下の空き（回の番号の分）
  private static let bottom: CGFloat = 22

  var body: some View {
    GeometryReader { geo in
      let plot = CGRect(
        x: Self.gutter, y: Self.top, width: max(1, geo.size.width - Self.gutter - 8),
        height: max(1, geo.size.height - Self.top - Self.bottom))
      let points = Self.points(values, in: plot)
      ZStack(alignment: .topLeading) {
        ForEach([0, 50, 100], id: \.self) { mark in
          let y = plot.maxY - plot.height * CGFloat(mark) / 100
          Path { p in
            p.move(to: CGPoint(x: plot.minX, y: y))
            p.addLine(to: CGPoint(x: plot.maxX, y: y))
          }
          .stroke(Theme.line, lineWidth: 1.5)
          Text("\(mark)")
            .font(Theme.font(13, .heavy))
            .foregroundStyle(Theme.gray)
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
            .frame(width: Self.gutter - 8, alignment: .trailing)
            .position(x: (Self.gutter - 8) / 2, y: y)
        }
        Path { p in
          guard let first = points.first else { return }
          p.move(to: first)
          for point in points.dropFirst() { p.addLine(to: point) }
        }
        .trim(from: 0, to: drawn ? 1 : 0)
        .stroke(Theme.accent, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
        if let last = points.last, let value = values.last {
          Circle()
            .fill(Theme.accent)
            .frame(width: 14, height: 14)
            .position(last)
            .opacity(drawn ? 1 : 0)
          Text("いま \(value)点")
            .font(Theme.font(16, .black))
            .fixedSize()
            .frame(width: plot.width, alignment: .trailing)
            .position(x: plot.midX, y: last.y - 20)
        }
        if let first = points.first, let last = points.last {
          Text("1")
            .font(Theme.font(13, .heavy))
            .foregroundStyle(Theme.gray)
            .position(x: first.x, y: plot.maxY + Self.bottom / 2 + 2)
          if values.count > 1 {
            Text("\(values.count)")
              .font(Theme.font(13, .heavy))
              .foregroundStyle(Theme.gray)
              .monospacedDigit()
              .position(x: last.x, y: plot.maxY + Self.bottom / 2 + 2)
          }
        }
      }
    }
    .onAppear {
      withAnimation(.easeOut(duration: 0.8).delay(0.15)) { drawn = true }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Self.summary(values))
  }

  /// 点を、左端から右端まで等しい間に置く（1 回だけなら真ん中）
  static func points(_ values: [Int], in plot: CGRect) -> [CGPoint] {
    values.enumerated().map { i, v in
      let x = values.count > 1 ? plot.minX + plot.width * CGFloat(i) / CGFloat(values.count - 1) : plot.midX
      let y = plot.maxY - plot.height * CGFloat(min(100, max(0, v))) / 100
      return CGPoint(x: x, y: y)
    }
  }

  static func summary(_ values: [Int]) -> String {
    guard let first = values.first, let last = values.last else { return "点の推移はまだありません" }
    return "合計の点の推移。最初 \(first) 点、いま \(last) 点"
  }
}

/// 3 つの軸の 1 つ。今の点と伸び（+13・−4 など）。伸びが 0 なら、今の点だけを出す（「±0」は伝わりにくいため）
private struct AxisNow: View {
  let label: String
  let now: Int
  /// 伸び。数えられないか 0 なら nil（出さない）
  let growth: Int?

  init(label: String, now: Int, growth: Int?) {
    self.label = label
    self.now = now
    self.growth = growth == 0 ? nil : growth
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label)
        .font(Theme.font(15, .heavy))
        .foregroundStyle(Theme.muted)
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text("\(now)")
          .font(Theme.font(32, .black))
          .monospacedDigit()
        if let growth {
          Text(Self.signed(growth))
            .font(Theme.font(18, .heavy))
            .foregroundStyle(growth > 0 ? Theme.accent : Theme.muted)
            .monospacedDigit()
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.leading, 6)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(growth.map { "\(label) \(now) 点、伸び \(Self.signed($0))" } ?? "\(label) \(now) 点")
  }

  /// 0 は渡さない（出さない）
  static func signed(_ value: Int) -> String {
    value > 0 ? "+\(value)" : "−\(-value)"
  }
}

/// 3 つの軸の間の縦の線
private struct AxisDivider: View {
  var body: some View {
    Rectangle()
      .fill(Theme.line)
      .frame(width: 1.5, height: 52)
  }
}

/// どれだけ言えたか。項目の種類ごとの言えた割合の棒（中心・理由・つながり・細部）。数えられない種類は「—」で、棒を出さない
private struct CoverageCard: View {
  let coverage: [KindCoverage]

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      CardHeading("どれだけ言えたか")
      ForEach(coverage, id: \.kind) { c in
        CoverageRow(coverage: c)
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("weak-coverage")
  }
}

private struct CoverageRow: View {
  let coverage: KindCoverage
  @State private var grown = false

  var body: some View {
    HStack(spacing: 12) {
      Text(coverage.kind.label)
        .font(Theme.font(16, .heavy))
        .frame(width: 76, alignment: .leading)
      GeometryReader { geo in
        if let rate = coverage.rate {
          Capsule()
            .fill(Theme.accentSoft)
            .overlay(alignment: .leading) {
              Capsule()
                .fill(Theme.accent)
                .frame(width: grown ? geo.size.width * min(1, max(0, rate)) : 0)
            }
        }
      }
      .frame(height: 12)
      Text(coverage.percent.map { "\($0)%" } ?? "—")
        .font(Theme.font(17, .heavy))
        .foregroundStyle(coverage.rate == nil ? Theme.gray : Theme.ink)
        .monospacedDigit()
        .frame(width: 52, alignment: .trailing)
    }
    .onAppear {
      withAnimation(.easeOut(duration: 0.7).delay(0.15)) { grown = true }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(coverage.kind.label) \(coverage.percent.map { "\($0)%" } ?? "まだ数えられない")")
  }
}

/// 間違いの種類ごとの数（直近の回の中）
private struct MistakeCard: View {
  let verdicts: VerdictCounts

  private var rows: [(label: String, count: Int)] {
    [("場面と食い違う", verdicts.contradiction), ("場面に無い", verdicts.absent), ("的外れ", verdicts.offtopic)]
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      CardHeading("間違いの種類")
      ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
        if index > 0 {
          Rectangle().fill(Theme.line).frame(height: 1.5)
        }
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          Image(systemName: "xmark")
            .font(.system(size: 15, weight: .black))
            .foregroundStyle(Theme.mismatch)
          Text(row.label)
            .font(Theme.font(17, .heavy))
          Spacer()
          Text("\(row.count)")
            .font(Theme.font(22, .black))
            .monospacedDigit()
          Text("回")
            .font(Theme.font(14, .heavy))
            .foregroundStyle(Theme.muted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(row.label) \(row.count) 回")
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("weak-mistakes")
  }
}
