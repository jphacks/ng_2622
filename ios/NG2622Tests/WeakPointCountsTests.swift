import Foundation
import Testing

@testable import NG2622

/// 苦手の画面で数えるもの（docs/design/weak-point-analysis.md の 4 章）
struct WeakPointCountsTests {
  /// minutes 分前に遊んだ記録。items は (種類, 達成)、claims は判定の並び。内訳を持たない回は content を nil にする
  func record(
    _ id: String, minutesAgo: Double = 0, difficulty: String? = "eiken-pre2",
    items: [(String, String)]? = [], verdicts: [String] = [], score: (Int, Int, Int, Int) = (60, 60, 60, 60)
  ) -> PlayRecord {
    let content = items.map { items in
      PlayRecord.Content(
        claims: verdicts.map { .init(quote: "A boy is running.", verdict: $0, item: nil, level: nil, note: nil) },
        items: items.enumerated().map { i, item in .init(id: "item\(i)", kind: item.0, label: "項目", level: item.1) },
        others: 0, recall: .init(earned: 0, max: 0), precision: .init(correct: 0, said: 0))
    }
    return PlayRecord(
      id: id, playedAt: Date(timeIntervalSince1970: 1_794_000_000 - minutesAgo * 60), difficulty: difficulty,
      scene: .object([:]),
      result: .init(
        transcript: "A boy is running.",
        score: .init(content: score.0, expression: score.1, speech: score.2, total: score.3), content: content,
        feedback: nil))
  }

  /// 直近 10 件は、内容の内訳のある記録の新しいほうから。内訳の無い回は飛ばす
  @Test func recentSkipsRecordsWithoutContent() {
    var records = (0..<12).map { record("r\($0)", minutesAgo: Double($0)) }
    records.append(record("no-content", minutesAgo: -1, items: nil))
    let recent = WeakPointCounts.recent(records.shuffled())
    #expect(recent.map(\.id) == (0..<10).map { "r\($0)" })
  }

  /// 入口（苦手の画面）は、内容の内訳のある記録が 5 件以上のときだけ
  @Test func canOpenNeedsFiveRecordsWithContent() {
    let four = (0..<4).map { record("r\($0)", minutesAgo: Double($0)) }
    #expect(!WeakPointCounts.canOpen(four))
    #expect(!WeakPointCounts.canOpen(four + [record("no-content", items: nil)]))
    #expect(WeakPointCounts.canOpen(four + [record("r4", minutesAgo: 4)]))
  }

  /// 文書の例: 準 2 級 6 回と 3 級 4 回。理由は準 2 級の 6 回に 1 つずつで、言えた 2・一部 2・言えない 2 なら 50%。
  /// つながりは分母 0 で「—」。中心は分母 3 × 6 ＋ 2 × 4 = 26
  @Test func coverageMatchesTheDocumentExample() throws {
    let reasonLevels = ["full", "full", "partial", "partial", "none", "none"]
    let pre2 = reasonLevels.enumerated().map { i, level in
      record(
        "pre2-\(i)", minutesAgo: Double(i),
        items: [("center", "full"), ("center", "full"), ("center", "none"), ("reason", level), ("detail", "full"),
          ("detail", "partial")])
    }
    let eiken3 = (0..<4).map { i in
      record(
        "e3-\(i)", minutesAgo: Double(10 + i), difficulty: "eiken-3",
        items: [("center", "full"), ("center", "partial"), ("detail", "none")])
    }
    let counts = WeakPointCounts(records: pre2 + eiken3)
    let byKind = Dictionary(uniqueKeysWithValues: counts.coverage.map { ($0.kind, $0) })
    #expect(counts.coverage.map(\.kind) == [.center, .reason, .link, .detail])

    let reason = try #require(byKind[.reason])
    #expect(reason.count == 6)
    #expect(reason.rate == 0.5)
    #expect(reason.percent == 50)

    let link = try #require(byKind[.link])
    #expect(link.count == 0)
    #expect(link.rate == nil)
    #expect(link.percent == nil)

    let center = try #require(byKind[.center])
    #expect(center.count == 26)
    // 準 2 級 2 × 6 ＋ 3 級 1.5 × 4 = 18
    #expect(center.said == 18)

    let detail = try #require(byKind[.detail])
    #expect(detail.count == 16)
    #expect(detail.said == 9)
  }

  /// 項目の数は直近 10 件の中だけで数える。知らない種類と知らない達成の項目は、振り返りの画面と同じく捨てる
  /// （分母にも入れない）
  @Test func coverageUsesOnlyRecentAndDropsUnknownValues() throws {
    var records = (0..<10).map { record("r\($0)", minutesAgo: Double($0), items: [("reason", "full")]) }
    records.append(record("old", minutesAgo: 100, items: [("reason", "none"), ("reason", "none")]))
    records.append(
      record("odd", minutesAgo: -1, items: [("reason", "great"), ("reason", "none"), ("future-kind", "full")]))
    let counts = WeakPointCounts(records: records)
    let reason = try #require(counts.coverage.first { $0.kind == .reason })
    // odd（いちばん新しい）と r0〜r8 の 10 件。old は入らない。odd の great は捨て、none は分母に入る
    #expect(counts.recent.map(\.id) == ["odd"] + (0..<9).map { "r\($0)" })
    #expect(reason.count == 10)
    #expect(reason.said == 9)
    #expect(counts.coverage.map(\.count).reduce(0, +) == 10)
  }

  /// 知らない達成だけの種類は、分母が 0 になり「—」（0% にしない）
  @Test func unknownLevelsAloneLeaveTheKindUncounted() throws {
    let records = (0..<5).map { record("r\($0)", minutesAgo: Double($0), items: [("link", "great"), ("center", "full")]) }
    let counts = WeakPointCounts(records: records)
    let link = try #require(counts.coverage.first { $0.kind == .link })
    #expect(link.count == 0)
    #expect(link.percent == nil)
    #expect(counts.nextHint?.kind == .center)
  }

  /// 判定の種類ごとの数は、直近 10 件の描写をそのまま数える
  @Test func verdictCounts() {
    let records = [
      record("a", minutesAgo: 0, verdicts: ["correct", "contradiction", "absent"]),
      record("b", minutesAgo: 1, verdicts: ["correct", "correct", "offtopic", "absent"]),
      record("c", minutesAgo: 2, verdicts: ["unknown"]),
    ]
    let v = WeakPointCounts(records: records).verdicts
    #expect(v == VerdictCounts(correct: 3, contradiction: 1, absent: 2, offtopic: 1))
  }

  /// 前半と後半: n = 7 なら h = 3 で、真ん中（古いほうから 4 回目）は使わない
  @Test func halvesSkipTheMiddleWhenOdd() throws {
    // 古いほうから 10, 20, …, 70 点
    let records = (0..<7).map { i in
      record("r\(i)", minutesAgo: Double(7 - i), score: (10 * (i + 1), 0, 100, 10 * (i + 1)))
    }
    let halves = try #require(WeakPointCounts(records: records).halves)
    #expect(halves.front.total == 20)
    #expect(halves.back.total == 60)
    #expect(halves.front.speech == 100)
    #expect(halves.growth(\.total) == 40)
    #expect(halves.growth(\.expression) == 0)
  }

  /// n = 10 なら 5 回ずつ。伸びは四捨五入
  @Test func halvesOfTen() throws {
    let contents = [50, 51, 52, 53, 54, 60, 61, 62, 63, 65]
    let records = contents.enumerated().map { i, c in
      record("r\(i)", minutesAgo: Double(10 - i), score: (c, 70, 70, 70))
    }
    let halves = try #require(WeakPointCounts(records: records).halves)
    #expect(halves.front.content == 52)
    #expect(halves.back.content == 62.2)
    #expect(halves.growth(\.content) == 10)
  }

  /// n = 5 なら h = 2 で、古いほうから 2 回と新しいほうから 2 回。3 回目は使わない
  @Test func halvesOfFive() throws {
    // 古いほうから 40, 50, 100（使わない）, 70, 80 点
    let totals = [40, 50, 100, 70, 80]
    let records = totals.enumerated().map { i, t in
      record("r\(i)", minutesAgo: Double(5 - i), score: (t, t, t, t))
    }
    let halves = try #require(WeakPointCounts(records: records.shuffled()).halves)
    #expect(halves.front.total == 45)
    #expect(halves.back.total == 75)
    #expect(halves.front.content == 45)
    #expect(halves.back.speech == 75)
    #expect(halves.growth(\.total) == 30)
  }

  /// 直近 10 件の外の記録と、内容の内訳の無い記録は、判定の数にも前半と後半にも入らない
  @Test func verdictsAndHalvesUseOnlyRecent() throws {
    // 直近 10 件: 古いほうから 5 回は 50 点、新しいほうから 5 回は 70 点。判定は 1 回に食い違い 1 つ
    var records = (0..<10).map { i in
      let t = i < 5 ? 70 : 50
      return record("r\(i)", minutesAgo: Double(i), verdicts: ["contradiction"], score: (t, t, t, t))
    }
    // 10 件の外（いちばん古い）: 判定が多く、点も低い
    records.append(
      record("old", minutesAgo: 100, verdicts: ["absent", "absent", "offtopic", "contradiction"], score: (0, 0, 0, 0)))
    // 内容の内訳の無い回（いちばん新しい）: 点が高い
    records.append(record("no-content", minutesAgo: -1, items: nil, verdicts: ["absent"], score: (100, 100, 100, 100)))
    let counts = WeakPointCounts(records: records.shuffled())
    #expect(counts.recent.count == 10)
    #expect(!counts.recent.contains { $0.id == "old" || $0.id == "no-content" })
    #expect(counts.verdicts == VerdictCounts(contradiction: 10))
    let halves = try #require(counts.halves)
    #expect(halves.front.total == 50)
    #expect(halves.back.total == 70)
    #expect(halves.growth(\.content) == 20)
    // 点の推移には、どちらも入る（全部の記録）
    #expect(counts.trend.count == 12)
  }

  /// 1 件では前半と後半を作らない
  @Test func noHalvesForOneRecord() {
    #expect(WeakPointCounts(records: [record("r0")]).halves == nil)
  }

  /// 点の推移は、内容の内訳が無い回も入れて、全部を古い順に
  @Test func trendHasAllRecordsOldestFirst() {
    let records = (0..<12).map { i in
      record("r\(i)", minutesAgo: Double(i), items: i == 3 ? nil : [], score: (0, 0, 0, 100 - i))
    }
    let trend = WeakPointCounts(records: records.shuffled()).trend
    #expect(trend.count == 12)
    #expect(trend.map(\.id) == (0..<12).reversed().map { "r\($0)" })
    #expect(trend.map(\.total) == (0..<12).reversed().map { 100 - $0 })
  }

  /// 「次はここ」の代わりは、言えた割合が最も低い種類。分母が 0 の種類は除く
  @Test func nextHintPicksTheLowestKind() throws {
    let records = (0..<5).map { i in
      record(
        "r\(i)", minutesAgo: Double(i),
        items: [("center", "full"), ("reason", i < 2 ? "full" : "none"), ("detail", "partial")])
    }
    let hint = try #require(WeakPointCounts(records: records).nextHint)
    #expect(hint.kind == .reason)
    #expect(hint.title == "「理由」を言おう")
    #expect(hint.detail == "because を足してみよう。")
    #expect(hint.rate == "理由 40%")
  }

  /// 同じ割合なら 中心 → 理由 → つながり → 細部 の順
  @Test func nextHintBreaksTiesInOrder() throws {
    let records = (0..<5).map { i in
      record("r\(i)", minutesAgo: Double(i), items: [("detail", "partial"), ("link", "partial"), ("center", "full")])
    }
    let hint = try #require(WeakPointCounts(records: records).nextHint)
    #expect(hint.kind == .link)
    #expect(hint.rate == "つながり 50%")
  }

  /// 数えられる種類が無ければ、代わりも無い
  @Test func noNextHintWithoutItems() {
    #expect(WeakPointCounts(records: [record("r0", items: [])]).nextHint == nil)
  }
}
