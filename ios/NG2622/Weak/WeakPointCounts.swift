import Foundation

/// 苦手の画面で、端末に残した記録から数えるもの（docs/design/weak-point-analysis.md の 4 章）。
/// 記録だけから毎回計算する（覚えない）。AI の分析とは別に、通信を待たずにすぐ出せる
nonisolated struct WeakPointCounts: Equatable, Sendable {
  /// 数える回の数の上限（直近 10 件）
  static let recentLimit = 10
  /// 苦手の画面に入れる（AI を呼べる）のに要る、内容の内訳のある記録の数
  static let minimumRecords = 5

  /// 数える回（R）: 内容の内訳のある記録の、新しいほうから 10 件（新しい順）
  let recent: [PlayRecord]
  /// 項目の種類ごとの言えた割合（中心 → 理由 → つながり → 細部の順）
  let coverage: [KindCoverage]
  /// 判定の種類ごとの描写の数（R の中）
  let verdicts: VerdictCounts
  /// R の前半と後半の点の平均。R が 2 件に満たなければ nil
  let halves: Halves?
  /// 点の推移。全部の記録を古い順に（内容の内訳が無い回も入れる）
  let trend: [TrendPoint]

  init(records: [PlayRecord]) {
    let recent = Self.recent(records)
    self.recent = recent
    coverage = Self.coverage(recent)
    verdicts = VerdictCounts(recent)
    halves = Halves(recent)
    trend = records.sorted(by: Self.olderFirst).map(TrendPoint.init)
  }

  /// 数える回（R）。内容の内訳（result.content）のある記録を新しい順に並べ、上から 10 件
  static func recent(_ records: [PlayRecord]) -> [PlayRecord] {
    Array(records.filter { $0.result.content != nil }.sorted { olderFirst($1, $0) }.prefix(recentLimit))
  }

  /// 内容の内訳のある記録の数（AI の分析を作り直す区切りに使う）
  static func countable(_ records: [PlayRecord]) -> Int {
    records.lazy.filter { $0.result.content != nil }.count
  }

  /// 苦手の画面に入れるか（R が 5 件以上）
  static func canOpen(_ records: [PlayRecord]) -> Bool {
    records.lazy.filter { $0.result.content != nil }.prefix(minimumRecords).count >= minimumRecords
  }

  /// 古い順（同じ時刻なら ID の順）
  static func olderFirst(_ a: PlayRecord, _ b: PlayRecord) -> Bool {
    (a.playedAt, a.id) < (b.playedAt, b.id)
  }

  /// 種類ごとに、R の中のその種類の項目の数（分母）と、言えた量（言えた 1・一部 0.5・言えない 0 の和）を数える。
  /// その他（一覧に無い正しい描写）は数えない。重み（中心 2 など）は掛けない。
  /// 知らない種類や知らない達成の項目は、分母にも入れずに捨てる（振り返りの画面が記録を読むときと同じ。ContentBreakdown.init）
  static func coverage(_ recent: [PlayRecord]) -> [KindCoverage] {
    let items = recent.flatMap { $0.result.content?.items ?? [] }
    return KindCoverage.order.map { kind in
      let values = items.filter { $0.kind == kind.rawValue }.compactMap { Self.value(of: $0.level) }
      return KindCoverage(kind: kind, said: values.reduce(0, +), count: values.count)
    }
  }

  /// 項目の達成の重さ（言えた 1・一部 0.5・言えない 0）。知らない値は nil（数えない）
  static func value(of level: String) -> Double? {
    switch level {
    case "full": 1
    case "partial": 0.5
    case "none": 0
    default: nil
    }
  }

  /// 「次はここ」の代わり（AI の分析が無いとき）。言えた割合が最も低い種類（分母が 0 の種類は除く。
  /// 同じ割合なら 中心 → 理由 → つながり → 細部 の順）。数えられる種類が無ければ nil
  var nextHint: NextHint? {
    var lowest: KindCoverage?
    for c in coverage {
      guard let rate = c.rate else { continue }
      // 先に来た種類を残す（同じ割合なら順の早いほう）
      if let l = lowest, let low = l.rate, rate >= low - 1e-9 { continue }
      lowest = c
    }
    return lowest.flatMap(NextHint.init)
  }
}

/// 項目の種類ごとの言えた割合
nonisolated struct KindCoverage: Equatable, Sendable {
  /// 並べる順（採点の次の一つと同じ順）
  static let order: [ChecklistKind] = [.center, .reason, .link, .detail]

  let kind: ChecklistKind
  /// 言えた量（言えた 1・一部 0.5・言えない 0 の和）
  let said: Double
  /// その種類の項目の数（分母）
  let count: Int

  /// 言えた割合（0〜1）。分母が 0 なら nil（画面では「—」にして、棒を出さない）
  var rate: Double? { count > 0 ? said / Double(count) : nil }
  /// 画面に出す百分率（四捨五入）
  var percent: Int? { rate.map { Int(($0 * 100).rounded()) } }
}

/// 判定の種類ごとの描写の数。画面に出すのは間違いの 3 つ（correct は AI への参考）
nonisolated struct VerdictCounts: Equatable, Sendable {
  var correct = 0
  /// 場面と食い違う
  var contradiction = 0
  /// 場面に無い
  var absent = 0
  /// 的外れ
  var offtopic = 0

  init(correct: Int = 0, contradiction: Int = 0, absent: Int = 0, offtopic: Int = 0) {
    self.correct = correct
    self.contradiction = contradiction
    self.absent = absent
    self.offtopic = offtopic
  }

  /// 知らない判定は数えない
  init(_ recent: [PlayRecord]) {
    for claim in recent.flatMap({ $0.result.content?.claims ?? [] }) {
      switch claim.verdict {
      case "correct": correct += 1
      case "contradiction": contradiction += 1
      case "absent": absent += 1
      case "offtopic": offtopic += 1
      default: break
      }
    }
  }
}

/// R を古い順に並べた前半と後半の、点の平均。n 件なら h = ⌊n/2⌋ 件ずつ（n が奇数なら真ん中の 1 件は使わない）
nonisolated struct Halves: Equatable, Sendable {
  let front: Average
  let back: Average

  /// 各点の平均
  nonisolated struct Average: Equatable, Sendable {
    let total: Double
    let content: Double
    let expression: Double
    let speech: Double

    init(total: Double, content: Double, expression: Double, speech: Double) {
      self.total = total
      self.content = content
      self.expression = expression
      self.speech = speech
    }

    init(_ records: ArraySlice<PlayRecord>) {
      let n = Double(records.count)
      func mean(_ value: (PlayRecord.Score) -> Int) -> Double {
        records.map { Double(value($0.result.score)) }.reduce(0, +) / n
      }
      self.init(total: mean(\.total), content: mean(\.content), expression: mean(\.expression), speech: mean(\.speech))
    }
  }

  /// recent は新しい順でも古い順でもよい（中で古い順に並べ直す）。2 件に満たなければ nil
  init?(_ recent: [PlayRecord]) {
    let ordered = recent.sorted(by: WeakPointCounts.olderFirst)
    let h = ordered.count / 2
    guard h > 0 else { return nil }
    front = Average(ordered.prefix(h))
    back = Average(ordered.suffix(h))
  }

  /// 伸び（後半の平均 − 前半の平均。四捨五入した整数）
  func growth(_ value: (Average) -> Double) -> Int {
    Int((value(back) - value(front)).rounded())
  }
}

/// 点の推移の 1 回分
nonisolated struct TrendPoint: Equatable, Sendable {
  let id: String
  let playedAt: Date
  let total: Int
  let content: Int
  let expression: Int
  let speech: Int

  init(_ record: PlayRecord) {
    id = record.id
    playedAt = record.playedAt
    let s = record.result.score
    total = s.total
    content = s.content
    expression = s.expression
    speech = s.speech
  }
}

/// 「次はここ」に出す、数えた結果からの代わり（種類ごとに決まった文）
nonisolated struct NextHint: Equatable, Sendable {
  let kind: ChecklistKind
  /// 大きく出す一行（例: 「理由」を言おう）
  let title: String
  /// 下の一言（例: because を足してみよう。）
  let detail: String
  /// 右上に出す種類と割合（例: 理由 41%）。内訳の棒と同じ値
  let rate: String

  init?(_ coverage: KindCoverage) {
    guard let percent = coverage.percent else { return nil }
    kind = coverage.kind
    title = "「\(coverage.kind.label)」を言おう"
    detail = Self.detail(coverage.kind)
    rate = "\(coverage.kind.label) \(percent)%"
  }

  static func detail(_ kind: ChecklistKind) -> String {
    switch kind {
    case .center: "だれが何をしているかを、1 人ずつ言ってみよう。"
    case .reason: "because を足してみよう。"
    case .link: "so や to で、何のためか・そのあとどうなるかをつなげてみよう。"
    case .detail: "物の場所を、on や next to で言ってみよう。"
    }
  }
}
