import BackendAPI
import Foundation
import Testing

@testable import NG2622

/// 苦手の AI の分析: 頼む本文の作り方・大きさ・覚える形・作り直す条件・前回の分析の選び方
/// （docs/design/weak-point-analysis.md の 3・7・9 章）
@MainActor
struct WeakPointAnalysisTests {
  /// 場面の JSON（見本の答えと、チェックリストの accept）
  static let scene: JSONValue = .object([
    "description": .string("A boy is running. A girl is reading a book."),
    "checklist": .array([
      .object(["id": .string("boy_run"), "kind": .string("center"), "accept": .string("a boy is running")]),
      .object([
        "id": .string("girl_why"), "kind": .string("reason"),
        "accept": .string("a girl is reading because she likes books"),
      ]),
    ]),
  ])

  /// minutes 分前に遊んだ記録。claims は判定の並び、basis は表現の根拠
  static func record(
    _ id: String, minutesAgo: Double = 0, difficulty: String? = "eiken-pre2", transcript: String = "A boy is running.",
    claims: Int = 2, basis: String? = "Uses the present continuous.", content: Bool = true,
    score: (Int, Int) = (60, 70)
  ) -> PlayRecord {
    let verdicts = ["correct", "absent", "contradiction", "offtopic"]
    let contentValue = PlayRecord.Content(
      claims: (0..<claims).map {
        .init(quote: "A boy is running.", verdict: verdicts[$0 % 4], item: $0 == 0 ? "boy_run" : nil, level: nil,
          note: $0 % 4 == 0 ? nil : "場面に無い")
      },
      items: [
        .init(id: "boy_run", kind: "center", label: "男の子が走っている", level: "full"),
        .init(id: "girl_why", kind: "reason", label: "女の子が本を読む理由", level: "partial"),
      ],
      others: 0, recall: .init(earned: 3, max: 4), precision: .init(correct: 1, said: 2))
    return PlayRecord(
      id: id, playedAt: Date(timeIntervalSince1970: 1_794_000_000 - minutesAgo * 60), difficulty: difficulty,
      scene: scene,
      result: .init(
        transcript: transcript,
        score: .init(content: score.0, expression: score.1, speech: 70, total: 66),
        content: content ? contentValue : nil,
        feedback: .init(
          nextStep: .init(kind: "content", text: "次は理由を足してみよう。", item: "girl_why", gain: 6),
          rewrite: .init(before: "A girl is reading.", after: "A girl is reading a book.", reason: "物を足す"),
          speechTip: .init(aspect: "fluency", text: "続けて言おう。"), expressionBasis: basis)))
  }

  /// i = 0 がいちばん新しい n 件
  static func records(_ n: Int) -> [PlayRecord] {
    (0..<n).map { record("r\($0)", minutesAgo: Double($0) * 10) }
  }

  // MARK: - 本文

  /// 回は古い順に 1 から番号を振り、記録の ID とは別に対応を持つ。級・判定・言い直し・次の一つ・根拠・見本・言えなかった項目を送る
  @Test func buildsRoundsOldestFirst() throws {
    var all = Self.records(12)
    all[3] = Self.record("r3", minutesAgo: 30, difficulty: nil, basis: "   ")
    let built = try #require(WeakPointRequestBuilder.build(recent: WeakPointCounts.recent(all)))
    #expect(built.request.rounds.map(\.n) == Array(1...10))
    // 古い順（r9 がいちばん古い 10 件目）
    #expect(built.recordIDs == (0..<10).reversed().map { "r\($0)" })
    let r3 = built.request.rounds[6]
    #expect(built.recordIDs[6] == "r3")
    #expect(r3.grade == nil)
    #expect(r3.expressionBasis == nil)
    let first = built.request.rounds[0]
    #expect(first.grade == .eikenPre2)
    #expect(first.claims.count == 2)
    #expect(first.claims[1].verdict == .absent)
    #expect(first.nextStep?.kind == .content)
    #expect(first.nextStep?.item == "girl_why")
    #expect(first.rewrite?.after == "A girl is reading a book.")
    #expect(first.expressionBasis == "Uses the present continuous.")
    #expect(first.scene.description == "A boy is running. A girl is reading a book.")
    // 言えなかった・一部だけの項目だけ。accept は場面の JSON から引く
    #expect(first.scene.missedItems.map(\.id) == ["girl_why"])
    #expect(first.scene.missedItems.first?.accept == "a girl is reading because she likes books")
    #expect(first.scene.missedItems.first?.level == .partial)
  }

  /// 描写は先頭の 30 個に切る。次の一つの点（gain）は送らない
  @Test func cutsClaimsAndOmitsGain() throws {
    let records = (0..<5).map { Self.record("r\($0)", minutesAgo: Double($0), claims: 40) }
    let built = try #require(WeakPointRequestBuilder.build(recent: records))
    #expect(built.request.rounds.allSatisfy { $0.claims.count == 30 })
    let json = try #require(String(data: try WeakPointRequestBuilder.encode(built.request), encoding: .utf8))
    #expect(!json.contains("gain"))
    #expect(!json.contains("r0"))
  }

  /// 数えた値: 種類の分母が 0 のものは入れない。前半と後半は ⌊n/2⌋ 回ずつ
  @Test func countsMatchTheRounds() throws {
    let records = (0..<7).map { i in Self.record("r\(i)", minutesAgo: Double(7 - i), score: (10 * (i + 1), 50)) }
    let built = try #require(WeakPointRequestBuilder.build(recent: WeakPointCounts.recent(records)))
    let counts = built.request.counts
    #expect(counts.rounds == 7)
    #expect(counts.kinds.map(\.kind) == [.center, .reason])
    #expect(counts.kinds[1].earned == 3.5)
    #expect(counts.kinds[1].total == 7)
    #expect(counts.verdicts.correct == 7)
    #expect(counts.verdicts.absent == 7)
    #expect(counts.halves.first.rounds == 3)
    #expect(counts.halves.first.content == 20)
    #expect(counts.halves.second.content == 60)
  }

  /// 4 件以下では本文を作らない
  @Test func needsFiveRecords() {
    #expect(WeakPointRequestBuilder.build(recent: Self.records(4)) == nil)
  }

  /// 本文は整形しない JSON で、ふつうの記録 10 件なら詰めずに 64 KB に収まる
  @Test func typicalBodyFitsWithoutShrinking() throws {
    let samples = PlayRecord.samples(count: 12, now: Date(timeIntervalSince1970: 1_794_000_000))
    let built = try #require(WeakPointRequestBuilder.build(recent: WeakPointCounts.recent(samples)))
    let data = try WeakPointRequestBuilder.encode(built.request)
    #expect(data.count == built.bytes)
    #expect(built.bytes <= WeakPointRequestBuilder.maxBytes)
    #expect(!data.contains(UInt8(ascii: "\n")))
    #expect(built.request.rounds.count == 10)
    let full = try WeakPointRequestBuilder.build(recent: WeakPointCounts.recent(samples), caps: .init())
    #expect(full.bytes == built.bytes)
  }

  /// どの欄もいっぱい（全角の文字）の記録 10 件でも、詰めて 64 KB に収める
  @Test func largestBodyIsShrunkUnderTheLimit() throws {
    let long = String(repeating: "あ", count: 2500)
    let records = (0..<10).map { i in
      let base = Self.record("r\(i)", minutesAgo: Double(i), transcript: long, claims: 40, basis: long)
      let content = PlayRecord.Content(
        claims: (0..<40).map { _ in .init(quote: long, verdict: "absent", item: long, level: nil, note: long) },
        items: (0..<20).map { .init(id: "item\($0)", kind: "center", label: long, level: "none") },
        others: 0, recall: .init(earned: 0, max: 1), precision: .init(correct: 0, said: 40))
      let scene: JSONValue = .object([
        "description": .string(long),
        "checklist": .array((0..<20).map { .object(["id": .string("item\($0)"), "accept": .string(long)]) }),
      ])
      return PlayRecord(
        id: base.id, playedAt: base.playedAt, difficulty: base.difficulty, scene: scene,
        result: .init(
          transcript: long, score: base.result.score, content: content,
          feedback: .init(
            nextStep: .init(kind: "content", text: long, item: long, gain: 6),
            rewrite: .init(before: long, after: long, reason: long),
            speechTip: .init(aspect: "fluency", text: long), expressionBasis: long)))
    }
    let built = try #require(WeakPointRequestBuilder.build(recent: WeakPointCounts.recent(records)))
    #expect(built.bytes <= WeakPointRequestBuilder.maxBytes)
    #expect(built.request.rounds.count >= WeakPointCounts.minimumRecords)
    #expect(built.request.rounds.allSatisfy { $0.transcript.count <= 2000 && $0.claims.count <= 30 })
    #expect(built.recordIDs.count == built.request.rounds.count)
  }

  // MARK: - 返った分析を覚える形

  static func response(
    habits: [(Int, Int)] = [(10, 8)], improvement: Int? = 10
  ) -> Components.Schemas.WeakPointResponse {
    .init(
      habits: habits.map { a, b in
        .init(
          viewpoint: .content, title: "理由をつけずに終わる", what: "理由が無い。",
          examples: [.init(n: a, quote: "A boy is running."), .init(n: b, quote: "A girl is reading.")],
          fix: "because を足そう。")
      },
      improvement: improvement.map {
        .init(value1: .init(viewpoint: .expression, text: "文をつなげた。", example: .init(n: $0, quote: "A boy is running.")))
      },
      nextTry: .init(value1: .init(viewpoint: .content, text: "because を足してみよう。")), retries: 0)
  }

  /// 実例と良くなった点の回の番号を、記録の ID に置き換える。範囲の外の番号は捨てる
  @Test func mapsRoundNumbersToRecordIDs() {
    let ids = (1...10).map { "id\($0)" }
    let made = WeakPointAnalysis(
      Self.response(habits: [(10, 8), (11, 12)], improvement: 10), basedOn: ids, createdAt: Date())
    #expect(made.protocol == "scenenglish.weakpoints/1")
    #expect(made.basedOn == ids)
    #expect(made.result.habits.count == 1)
    #expect(made.result.habits[0].examples.map(\.record) == ["id10", "id8"])
    #expect(made.result.improvement?.example.record == "id10")
    #expect(made.result.nextTry?.text == "because を足してみよう。")
    let noImprovement = WeakPointAnalysis(Self.response(improvement: 11), basedOn: ids, createdAt: Date())
    #expect(noImprovement.result.improvement == nil)
  }

  /// 覚えて読み戻せる。知らない版は読まない。消せる
  @Test func storeSavesLoadsAndDeletes() throws {
    let store = WeakPointStore.temporary()
    defer { try? store.delete() }
    #expect(store.load() == nil)
    let made = WeakPointAnalysis(
      Self.response(), basedOn: (1...10).map { "id\($0)" }, createdAt: Date(timeIntervalSince1970: 1_794_000_000.7))
    try store.save(made)
    #expect(store.load() == made)
    #expect(store.fileURL.lastPathComponent == "weak-points.json")
    #expect(store.fileURL.deletingLastPathComponent().lastPathComponent.hasPrefix("analysis"))
    // 入れ替える
    let next = WeakPointAnalysis(
      Self.response(habits: []), basedOn: (1...10).map { "id\($0)" }, createdAt: Date(timeIntervalSince1970: 1_794_000_100))
    try store.save(next)
    #expect(store.load() == next)
    // 知らない版
    let text = try #require(String(data: try next.encoded(), encoding: .utf8))
    try Data(text.replacingOccurrences(of: "scenenglish.weakpoints/1", with: "scenenglish.weakpoints/9").utf8)
      .write(to: store.fileURL)
    #expect(store.load() == nil)
    try store.delete()
    #expect(!store.exists())
  }

  // MARK: - 作り直す条件・前回の分析

  /// 作り直すのは、直近の回に元に無い記録がある（記録が増えた）か、元の記録が 1 つでも消えたとき。
  /// 直近の回より古い記録が消えただけでは作り直さない
  @Test func rebuildConditions() {
    let all = Self.records(12)
    let recent = WeakPointCounts.recent(all)
    let made = WeakPointAnalysis(Self.response(), basedOn: recent.reversed().map(\.id), createdAt: Date())
    let ids = Set(all.map(\.id))
    #expect(!made.needsRebuild(recent: recent, existing: ids))

    // 新しい記録が増えた
    let more = [Self.record("new", minutesAgo: -10)] + all
    #expect(made.needsRebuild(recent: WeakPointCounts.recent(more), existing: Set(more.map(\.id))))

    // 元の記録（r4）が消えた
    let removed = all.filter { $0.id != "r4" }
    #expect(made.needsRebuild(recent: WeakPointCounts.recent(removed), existing: Set(removed.map(\.id))))
    #expect(!made.isUsable(existing: Set(removed.map(\.id))))

    // 直近の 10 件より古い記録（r11）が消えただけ
    let older = all.filter { $0.id != "r11" }
    #expect(!made.needsRebuild(recent: WeakPointCounts.recent(older), existing: Set(older.map(\.id))))
  }

  /// 開いたとき: 覚えた分析が使えればそれを出して頼まない。記録が増えたら、前回の分析を出したまま作り直す。
  /// 失敗したら前回の分析を出したまま失敗を知らせ、開き直すとまた頼む
  @Test func analyzerUsesPreviousWhileRebuildingAndAfterFailure() async throws {
    let store = WeakPointStore.temporary()
    defer { try? store.delete() }
    let client = StubClient()
    let analyzer = WeakPointAnalyzer(client: client, store: store)
    var records = Self.records(10)
    let existing: @MainActor @Sendable () -> Set<String> = { [records] in Set(records.map(\.id)) }

    analyzer.open(records: records, existing: existing)
    #expect(analyzer.phase == .loading)
    #expect(analyzer.analysis == nil)
    await analyzer.waitForPending()
    #expect(analyzer.phase == .ready)
    #expect(analyzer.isPrevious == false)
    #expect(store.load() == analyzer.analysis)
    #expect(await client.calls == 1)

    // 変わっていなければ頼まない
    analyzer.open(records: records, existing: existing)
    #expect(analyzer.phase == .ready)
    #expect(await client.calls == 1)

    // 記録が増えた: 前回の分析を出したまま作り直す。失敗したら、前回の分析を出したまま失敗を知らせる
    let previous = analyzer.analysis
    records.insert(Self.record("new", minutesAgo: -10), at: 0)
    await client.fail(with: .rateLimited)
    analyzer.open(records: records, existing: { [records] in Set(records.map(\.id)) })
    #expect(analyzer.phase == .loading)
    #expect(analyzer.isPrevious)
    #expect(analyzer.analysis == previous)
    await analyzer.waitForPending()
    #expect(analyzer.phase == .failed(.rateLimited))
    #expect(analyzer.isPrevious)
    #expect(analyzer.analysis == previous)
    #expect(store.load() == previous)

    // 開き直すと、また頼む
    await client.fail(with: nil)
    analyzer.open(records: records, existing: { [records] in Set(records.map(\.id)) })
    await analyzer.waitForPending()
    #expect(analyzer.phase == .ready)
    #expect(analyzer.analysis?.basedOn.last == "new")
    #expect(await client.calls == 3)
  }

  /// 前回の分析の元の記録が消えていたら、前回の分析は出さない。作っている間に元の記録が消えたら、覚えない
  @Test func analyzerDropsAnalysisWhoseRecordsAreGone() async throws {
    let store = WeakPointStore.temporary()
    defer { try? store.delete() }
    let client = StubClient()
    let analyzer = WeakPointAnalyzer(client: client, store: store)
    let records = Self.records(10)
    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    await analyzer.waitForPending()
    #expect(store.load() != nil)

    // 元の記録（r2）を消して 11 件目を足す: 前回の分析は出さずに作る。作っている間に r5 も消えたら覚えない
    let remaining = records.filter { $0.id != "r2" } + [Self.record("old", minutesAgo: 1000)]
    analyzer.open(records: remaining, existing: { Set(remaining.map(\.id)).subtracting(["r5"]) })
    #expect(analyzer.analysis == nil)
    #expect(analyzer.phase == .loading)
    await analyzer.waitForPending()
    #expect(analyzer.phase == .failed(.failed))
    #expect(analyzer.analysis == nil)
    #expect(store.load()?.basedOn.contains("r2") == true)
  }

  /// 4 件以下では頼まず、覚えた分析も消す
  @Test func analyzerSkipsWithFewRecords() async throws {
    let store = WeakPointStore.temporary()
    defer { try? store.delete() }
    try store.save(WeakPointAnalysis(Self.response(), basedOn: ["r0"], createdAt: Date()))
    let client = StubClient()
    let analyzer = WeakPointAnalyzer(client: client, store: store)
    let records = Self.records(4)
    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    #expect(analyzer.phase == .idle)
    #expect(!store.exists())
    #expect(await client.calls == 0)
  }
}

/// 呼ばれた回数を数え、決まった分析か失敗を返す
actor StubClient: WeakPointClient {
  private(set) var calls = 0
  private var failure: WeakPointFailure?

  func fail(with failure: WeakPointFailure?) {
    self.failure = failure
  }

  nonisolated func analyze(_ request: Components.Schemas.WeakPointRequest) async throws
    -> Components.Schemas.WeakPointResponse
  {
    try await respond(request)
  }

  private func respond(_ request: Components.Schemas.WeakPointRequest) throws -> Components.Schemas.WeakPointResponse {
    calls += 1
    if let failure { throw failure }
    return MockWeakPointClient.response(for: request, habits: true)
  }
}
