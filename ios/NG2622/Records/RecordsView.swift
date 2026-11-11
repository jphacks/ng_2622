import Charts
import SwiftUI

/// きろく。遊んだ日数とラウンド数、合計点と話した語数の推移、これまでのラウンドの一覧。
/// 一覧を押すと、そのラウンドの振り返り（遊んだ直後と同じ画面。順位と自分の声は出さない）を開く
struct RecordsView: View {
  let onBack: () -> Void
  var client: any PlayRecordClient = PlayRecords.client

  private enum Load: Equatable {
    case loading
    case failed
    case loaded([PlayRecord])
  }

  @State private var load = Load.loading
  @State private var opened: PlayRecord?

  var body: some View {
    ZStack {
      if let opened {
        ReviewView(
          results: opened.results, title: Self.title(of: opened), savedLayout: opened.layout, showsPlace: false,
          onBack: { self.opened = nil }
        )
        .transition(.move(edge: .trailing))
      } else {
        list
          .transition(.opacity)
      }
    }
    .animation(.easeInOut(duration: 0.25), value: opened)
    .task { await fetch() }
  }

  private var list: some View {
    VStack(spacing: 0) {
      ResultSubHeader(title: "きろく", onBack: onBack)
        .resultColumn()
        .padding(.top, 8)
      switch load {
      case .loading:
        Spacer()
        ProgressView()
        Spacer()
      case .failed:
        Spacer()
        VStack(spacing: 14) {
          Text("きろくを取れませんでした")
            .font(Theme.font(20, .heavy))
          Text("通信できるか確かめて、もう一度読み込んでください。")
            .font(Theme.font(15, .bold))
            .foregroundStyle(Theme.muted)
            .multilineTextAlignment(.center)
          Button("もう一度読み込む") { Task { await fetch() } }
            .buttonStyle(BigButtonStyle(kind: .outlined))
            .padding(.top, 8)
        }
        .resultColumn()
        Spacer()
      case .loaded(let records) where records.isEmpty:
        Spacer()
        VStack(spacing: 10) {
          Image(systemName: "chart.line.uptrend.xyaxis")
            .font(.system(size: 40, weight: .bold))
            .foregroundStyle(Theme.gray)
          Text("まだきろくがありません")
            .font(Theme.font(20, .heavy))
          Text("部屋で遊ぶと、ここに点数と話した語数の推移が出ます。")
            .font(Theme.font(15, .bold))
            .foregroundStyle(Theme.muted)
            .multilineTextAlignment(.center)
        }
        .resultColumn()
        Spacer()
      case .loaded(let records):
        ScrollView {
          content(records)
            .resultColumn()
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
        .refreshable { await fetch() }
      }
    }
  }

  private func content(_ records: [PlayRecord]) -> some View {
    // records は新しい順。グラフは古い順に並べる
    let oldestFirst = Array(records.reversed())
    return VStack(spacing: 16) {
      HStack(spacing: 12) {
        StatTile(value: "\(RecordTrend.days(records)) 日", label: "遊んだ日")
        StatTile(value: "\(records.count) 回", label: "ラウンド")
      }
      TrendCard(title: "合計点", values: oldestFirst.map { Double($0.me.score?.total ?? 0) })
      TrendCard(title: "話した語数", values: oldestFirst.map { Double($0.words) })
      VStack(spacing: 0) {
        ForEach(Array(records.enumerated()), id: \.element.id) { i, record in
          Button {
            opened = record
          } label: {
            RecordRow(record: record)
          }
          .buttonStyle(.plain)
          if i < records.count - 1 {
            Rectangle().fill(Theme.line).frame(height: 1)
          }
        }
      }
      .padding(.horizontal, 18)
      .padding(.vertical, 4)
      .resultCard()
    }
  }

  private func fetch() async {
    if case .loaded = load {} else { load = .loading }
    do {
      load = .loaded(try await client.myRecords())
    } catch {
      load = .failed
    }
  }

  /// 振り返りの見出し（例: 11/28 公園）
  static func title(of record: PlayRecord) -> String {
    "\(record.playedAt.formatted(.dateTime.month(.defaultDigits).day())) \(record.sceneName)"
  }
}

private struct StatTile: View {
  let value: String
  let label: String

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(value)
        .font(Theme.font(28, .black))
        .foregroundStyle(Theme.accent)
        .monospacedDigit()
      Text(label)
        .font(Theme.font(13, .heavy))
        .foregroundStyle(Theme.muted)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
    .accessibilityElement(children: .combine)
  }
}

/// 推移のグラフ。見出しの右に、最初の 3 回と最近の 3 回の平均を出す
private struct TrendCard: View {
  let title: String
  /// 古い順
  let values: [Double]

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        Text(title)
          .font(Theme.font(13, .heavy))
          .foregroundStyle(Theme.muted)
        Spacer()
        if let trend = RecordTrend.firstAndRecent(values) {
          summary(trend)
        }
      }
      if values.count >= 2 {
        chart
          .frame(height: 110)
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
  }

  private func summary(_ trend: (first: Double, recent: Double?)) -> some View {
    HStack(spacing: 4) {
      if let recent = trend.recent {
        Text("最初 \(Self.number(trend.first)) →")
          .foregroundStyle(Theme.muted)
        Text("最近 \(Self.number(recent))")
          .foregroundStyle(Theme.accent)
      } else {
        Text("\(Self.number(trend.first))")
          .foregroundStyle(Theme.accent)
      }
    }
    .font(Theme.font(14, .heavy))
    .monospacedDigit()
  }

  private var chart: some View {
    let low = (values.min() ?? 0) * 0.85
    let high = max((values.max() ?? 1) * 1.05, low + 1)
    return Chart {
      ForEach(Array(values.enumerated()), id: \.offset) { i, value in
        AreaMark(x: .value("回", i), yStart: .value("下", low), yEnd: .value(title, value))
          .foregroundStyle(Theme.accentSoft)
        LineMark(x: .value("回", i), y: .value(title, value))
          .foregroundStyle(Theme.accent)
          .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
        if i == values.count - 1 {
          PointMark(x: .value("回", i), y: .value(title, value))
            .foregroundStyle(Theme.accent)
            .symbolSize(60)
        }
      }
    }
    .chartXAxis(.hidden)
    .chartYScale(domain: low...high)
    .chartYAxis {
      AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { _ in
        AxisGridLine().foregroundStyle(Theme.line)
        AxisValueLabel().foregroundStyle(Theme.gray)
      }
    }
    .accessibilityLabel("\(title)の推移")
  }

  /// 整数なら小数点を付けない
  static func number(_ value: Double) -> String {
    value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
  }
}

private struct RecordRow: View {
  let record: PlayRecord

  var body: some View {
    HStack(spacing: 10) {
      Text(record.playedAt.formatted(.dateTime.month(.defaultDigits).day()))
        .font(Theme.font(14, .heavy))
        .foregroundStyle(Theme.muted)
        .monospacedDigit()
        .frame(width: 48, alignment: .leading)
      Text(record.sceneName)
        .font(Theme.font(16, .heavy))
        .lineLimit(1)
      if let difficulty = record.difficulty {
        DifficultyChip(difficulty: difficulty, size: 11)
      }
      Spacer(minLength: 8)
      if let total = record.me.score?.total {
        Text("\(total)")
          .font(Theme.font(19, .black))
          .foregroundStyle(Theme.accent)
          .monospacedDigit()
      }
      Image(systemName: "chevron.right")
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(Theme.gray)
    }
    .frame(height: 56)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityHint("このラウンドの振り返りを開く")
  }
}

#Preview("きろく（例）") {
  RecordsView(onBack: {}, client: MockPlayRecordClient.shared)
    .background(Theme.background)
}
