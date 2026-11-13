import SwiftUI

/// 苦手。端末に残した記録から数えた結果（WeakPointCounts）を出す。上に「次はここ」を大きく 1 つ、
/// その下の「くわしく」に、点の推移・どれだけ言えたか・間違いの種類。押す所は無い（「次はここ」も押せない）。
/// AI の分析（くり返す癖・良くなった点・次の 1 回で試すこと）は後の PR で、「次はここ」と「くわしく」の間に足す
/// （docs/design/weak-point-analysis.md の 14 章。見せ方は画面設計書 v2 の weak.md）
struct WeakPointsView: View {
  let library: RecordLibrary
  let onBack: () -> Void

  /// 下にスクロールしたか（戻るボタンの後ろの帯を、スクロールしたときだけ出す。一番上では見出しを隠さない）
  @State private var scrolled = false

  var body: some View {
    // 数えるのは記録から毎回（覚えない）。数は多くても数百件で、すぐ終わる
    let counts = WeakPointCounts(records: library.records)
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

        if let hint = counts.nextHint {
          NextHintCard(hint: hint)
        }

        SectionTitle("くわしく")
          .padding(.top, 8)
        TrendCard(trend: counts.trend, halves: counts.halves)
        CoverageCard(coverage: counts.coverage)
        MistakeCard(verdicts: counts.verdicts)
      }
      .resultColumn()
      .padding(.bottom, 40)
    }
    // 上端は、下の帯で地の色に溶かすので、システムのぼかし（状態バーの下）は付けない
    .scrollEdgeEffectHidden(true, for: .top)
    .onScrollGeometryChange(for: Bool.self) { geometry in
      geometry.contentOffset.y + geometry.contentInsets.top > 8
    } action: { _, value in
      scrolled = value
    }
    // 下にスクロールしたら、戻るボタンの後ろを、上ほど地の色に溶かす（流れていく中身がボタンと重なって読みにくくならないよう）
    .overlay(alignment: .top) {
      // 帯は、上の安全な領域（状態バー）まで広げる
      Color.clear
        .frame(height: 76)
        .background {
          LinearGradient(
            stops: [.init(color: Theme.background, location: 0.6), .init(color: Theme.background.opacity(0), location: 1)],
            startPoint: .top, endPoint: .bottom
          )
          .ignoresSafeArea(edges: .top)
        }
        .opacity(scrolled ? 1 : 0)
        .animation(.easeOut(duration: 0.15), value: scrolled)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
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
  }
}

// MARK: - 次はここ

/// 次はここ。薄い紫の地（振り返りの「次の一つ」と同じ見た目）。右上に、その種類の言えた割合
private struct NextHintCard: View {
  let hint: NextHint

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        Text("次はここ")
          .font(Theme.font(15, .heavy))
          .foregroundStyle(Theme.muted)
        Spacer()
        Text(hint.rate)
          .font(Theme.font(15, .heavy))
          .foregroundStyle(Theme.muted)
          .monospacedDigit()
      }
      Text(hint.title)
        .font(Theme.font(28, .black))
        .fixedSize(horizontal: false, vertical: true)
      Text(hint.detail)
        .font(Theme.font(18, .heavy))
        .lineSpacing(3)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.accentSoft.opacity(0.75), in: RoundedRectangle(cornerRadius: 22))
    .overlay {
      RoundedRectangle(cornerRadius: 22).strokeBorder(Theme.accent.opacity(0.18), lineWidth: 1.5)
    }
    .shadow(color: Theme.ink.opacity(0.07), radius: 10, y: 6)
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("weak-next")
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

/// 3 つの軸の 1 つ。今の点と伸び（+13 など）
private struct AxisNow: View {
  let label: String
  let now: Int
  /// 伸び。数えられなければ nil（出さない）
  let growth: Int?

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

  static func signed(_ value: Int) -> String {
    value > 0 ? "+\(value)" : value < 0 ? "−\(-value)" : "±0"
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
