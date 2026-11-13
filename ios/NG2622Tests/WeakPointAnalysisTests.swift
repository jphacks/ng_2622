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

  /// 「new」（10 分後）より古く、r0 より新しい n 件（記録を 5 件ずつ増やすのに使う）
  static func fillers(_ n: Int) -> [PlayRecord] {
    (0..<n).map { record("fill\($0)", minutesAgo: -Double($0 + 1)) }
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

  /// 文字起こしが空（空白だけ）の回は "-" を送る（API は 1 文字以上で、空だと 400）
  @Test func sendsDashForEmptyTranscript() throws {
    var records = Self.records(5)
    records[0] = Self.record("r0", transcript: "  \n")
    let built = try #require(WeakPointRequestBuilder.build(recent: records))
    #expect(built.recordIDs.last == "r0")
    #expect(built.request.rounds.last?.transcript == "-")
    #expect(built.request.rounds.first?.transcript == "A boy is running.")
  }

  /// 長さはバックエンド（zod の max）と同じ UTF-16 の数で切り、文字の途中では切らない（絵文字は 2）
  @Test func clipsByUTF16Length() {
    #expect(WeakPointRequestBuilder.clip("😀😀😀", 3) == "😀")
    #expect(WeakPointRequestBuilder.clip("😀😀😀", 4) == "😀😀")
    #expect(WeakPointRequestBuilder.clip("あいう", 2) == "あい")
    #expect(WeakPointRequestBuilder.clip("abc", 3) == "abc")
    #expect(WeakPointRequestBuilder.clip("😀", 1) == "")
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
    habits: [(Int, Int)] = [(10, 8)], improvement: Int? = 10, nextTry: Bool = true
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
      nextTry: nextTry ? .init(value1: .init(viewpoint: .content, text: "because を足してみよう。")) : nil, retries: 0)
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

  /// 区切りの数（records）の無い前の分析: 作り直すのは、直近の回に元に無い記録がある（記録が増えた）か、
  /// 元の記録が 1 つでも消えたとき。直近の回より古い記録が消えただけでは作り直さない
  @Test func rebuildConditions() {
    let all = Self.records(12)
    let recent = WeakPointCounts.recent(all)
    let made = WeakPointAnalysis(Self.response(), basedOn: recent.reversed().map(\.id), createdAt: Date())
    let ids = Set(all.map(\.id))
    #expect(!made.needsRebuild(recent: recent, existing: ids, total: all.count))

    // 新しい記録が増えた
    let more = [Self.record("new", minutesAgo: -10)] + all
    #expect(made.needsRebuild(recent: WeakPointCounts.recent(more), existing: Set(more.map(\.id)), total: more.count))

    // 元の記録（r4）が消えた
    let removed = all.filter { $0.id != "r4" }
    #expect(made.needsRebuild(recent: WeakPointCounts.recent(removed), existing: Set(removed.map(\.id)), total: removed.count))
    #expect(!made.isUsable(existing: Set(removed.map(\.id))))

    // 直近の 10 件より古い記録（r11）が消えただけ
    let older = all.filter { $0.id != "r11" }
    #expect(!made.needsRebuild(recent: WeakPointCounts.recent(older), existing: Set(older.map(\.id)), total: older.count))
  }

  /// 作り直すのは、内容の内訳のある記録が 5 件の区切り（5・10・15 件目…）を越えたときだけ（2026-11-14 リーダーが決めた）。
  /// 元の記録が消えたときは、区切りによらず作り直す（前と同じ）
  @Test func rebuildsEveryFiveRecords() {
    let all = Self.records(12)
    let recent = WeakPointCounts.recent(all)
    let ids = Set(all.map(\.id))
    let made = WeakPointAnalysis(Self.response(), basedOn: recent.reversed().map(\.id), createdAt: Date(), records: 12)
    for total in 12...14 {
      #expect(!made.needsRebuild(recent: recent, existing: ids, total: total))
    }
    #expect(made.needsRebuild(recent: recent, existing: ids, total: 15))
    let at10 = WeakPointAnalysis(Self.response(), basedOn: recent.reversed().map(\.id), createdAt: Date(), records: 10)
    #expect(!at10.needsRebuild(recent: recent, existing: ids, total: 14))
    #expect(at10.needsRebuild(recent: recent, existing: ids, total: 15))
    // 元の記録（r4）が消えた
    let removed = all.filter { $0.id != "r4" }
    #expect(made.needsRebuild(recent: WeakPointCounts.recent(removed), existing: Set(removed.map(\.id)), total: 11))
    // 区切りの数は覚えて読み戻せる（欄の無い前のファイルは nil で読む）
    #expect(WeakPointAnalysis(Self.response(), basedOn: ["r0"], createdAt: Date()).records == nil)
  }

  /// 本文が大きくて新しい 5 回だけで作った分析は、送った 5 回と比べる（直近の 10 回と比べて、開くたびに作り直さない）
  @Test func rebuildComparesOnlyTheSentRounds() {
    let all = Self.records(10)
    let recent = WeakPointCounts.recent(all)
    let made = WeakPointAnalysis(Self.response(), basedOn: recent.prefix(5).reversed().map(\.id), createdAt: Date())
    #expect(!made.needsRebuild(recent: recent, existing: Set(all.map(\.id)), total: all.count))
    // 新しい記録が増えたら作り直す
    let more = [Self.record("new", minutesAgo: -10)] + all
    #expect(made.needsRebuild(recent: WeakPointCounts.recent(more), existing: Set(more.map(\.id)), total: more.count))
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
    // 記録が 5 件増えた（10 → 15 件目で、作り直す区切り）
    records.insert(contentsOf: [Self.record("new", minutesAgo: -10)] + Self.fillers(4), at: 0)
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

  /// 作っている途中に開き直しても、同じ記録なら二重に頼まない
  @Test func reopeningWhileLoadingDoesNotAskTwice() async throws {
    let store = WeakPointStore.temporary()
    defer { try? store.delete() }
    let client = StubClient()
    await client.hold()
    let analyzer = WeakPointAnalyzer(client: client, store: store)
    let records = Self.records(10)
    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    await client.waitUntilCalled(1)
    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    #expect(analyzer.phase == .loading)
    await client.release()
    await analyzer.waitForPending()
    #expect(analyzer.phase == .ready)
    #expect(await client.calls == 1)
  }

  /// すべて消す（forget）: 覚えた分析とメモリの分析を忘れる。作っている途中に忘れたら、あとで応答が返っても覚えず、出さない
  @Test func forgetDropsStoredAndInFlightAnalysis() async throws {
    let store = WeakPointStore.temporary()
    defer { try? store.delete() }
    let client = StubClient()
    let analyzer = WeakPointAnalyzer(client: client, store: store)
    var records = Self.records(10)
    analyzer.open(records: records, existing: { [records] in Set(records.map(\.id)) })
    await analyzer.waitForPending()
    #expect(store.exists())

    // 記録が増えて作り直している途中（前回の分析を出している）に忘れる
    // 記録が 5 件増えた（10 → 15 件目で、作り直す区切り）
    records.insert(contentsOf: [Self.record("new", minutesAgo: -10)] + Self.fillers(4), at: 0)
    await client.hold()
    analyzer.open(records: records, existing: { [records] in Set(records.map(\.id)) })
    await client.waitUntilCalled(2)
    #expect(analyzer.isPrevious)
    analyzer.forget()
    #expect(!store.exists())
    #expect(analyzer.analysis == nil)
    #expect(analyzer.phase == .idle)

    // 応答が返っても、覚えず出さない
    await client.release()
    await analyzer.waitForPending()
    #expect(!store.exists())
    #expect(analyzer.analysis == nil)
    #expect(analyzer.phase == .idle)
  }

  /// 覚えられない所（フォルダを作れない、ファイルの下）。blocker は終わったら消すファイル
  static func unwritableStore() throws -> (store: WeakPointStore, blocker: URL) {
    let blocker = FileManager.default.temporaryDirectory.appending(path: "blocker-\(UUID().uuidString)")
    try Data().write(to: blocker)
    return (WeakPointStore(directory: blocker.appending(path: "analysis", directoryHint: .isDirectory)), blocker)
  }

  /// 覚えるのに失敗しても（ファイルが無い）、メモリの分析を使い、開き直すたびには頼まない
  @Test func analyzerKeepsAnalysisInMemoryWhenSavingFails() async throws {
    let (store, blocker) = try Self.unwritableStore()
    defer { try? FileManager.default.removeItem(at: blocker) }
    let client = StubClient()
    let analyzer = WeakPointAnalyzer(client: client, store: store)
    let records = Self.records(10)
    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    await analyzer.waitForPending()
    #expect(analyzer.phase == .ready)
    #expect(!store.exists())
    let made = try #require(analyzer.analysis)

    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    #expect(analyzer.phase == .ready)
    #expect(analyzer.analysis == made)
    #expect(await client.calls == 1)
  }

  /// 覚えるのに失敗した（ファイルが無い）まま元の記録が 1 つ消えたら、メモリの分析は使わずに作り直す
  @Test func analyzerRebuildsWhenInMemoryAnalysisLostARecord() async throws {
    let (store, blocker) = try Self.unwritableStore()
    defer { try? FileManager.default.removeItem(at: blocker) }
    let client = StubClient()
    let analyzer = WeakPointAnalyzer(client: client, store: store)
    let records = Self.records(10)
    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    await analyzer.waitForPending()
    #expect(analyzer.analysis?.basedOn.contains("r2") == true)
    #expect(!store.exists())

    let remaining = records.filter { $0.id != "r2" }
    analyzer.open(records: remaining, existing: { Set(remaining.map(\.id)) })
    #expect(analyzer.phase == .loading)
    #expect(analyzer.analysis == nil)
    await analyzer.waitForPending()
    #expect(analyzer.phase == .ready)
    #expect(analyzer.analysis?.basedOn == WeakPointCounts.recent(remaining).reversed().map(\.id))
    #expect(await client.calls == 2)
  }

  /// forget のあと、捨てた分析が終わる前に同じ記録で開き直すと、新しく頼み、その分析を覚える
  @Test func reopeningAfterForgetStoresNewAnalysis() async throws {
    let store = WeakPointStore.temporary()
    defer { try? store.delete() }
    let client = StubClient()
    await client.hold()
    let analyzer = WeakPointAnalyzer(client: client, store: store)
    let records = Self.records(10)
    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    await client.waitUntilCalled(1)
    analyzer.forget()

    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    #expect(analyzer.phase == .loading)
    await client.waitUntilCalled(2)
    await client.release()
    await analyzer.waitForPending()
    #expect(analyzer.phase == .ready)
    #expect(analyzer.analysis?.basedOn == WeakPointCounts.recent(records).reversed().map(\.id))
    #expect(store.load() == analyzer.analysis)
  }

  /// 返るまで待つ長さを過ぎたら failed
  @Test func timesOut() async {
    await #expect(throws: WeakPointFailure.failed) {
      try await WeakPointClients.withTimeout(.milliseconds(50)) {
        try await Task.sleep(for: .seconds(10))
        return 1
      }
    }
  }

  /// 次はここ: 返った分析に次に試すことが無ければ（null）、数えた結果の代わりを出す
  @Test func nextFallsBackToCountsWhenNextTryIsNull() throws {
    let records = Self.records(10)
    let counts = WeakPointCounts(records: records)
    let hint = try #require(counts.nextHint)
    let counted = WeakPointsView.NextContent(title: hint.title, detail: hint.detail, note: hint.rate)
    let ids = WeakPointCounts.recent(records).reversed().map(\.id)
    let withoutNext = WeakPointAnalysis(Self.response(nextTry: false), basedOn: ids, createdAt: Date())
    #expect(withoutNext.result.nextTry == nil)
    #expect(WeakPointsView.next(withoutNext, counts: counts) == counted)
    #expect(WeakPointsView.next(nil, counts: counts) == counted)
    let withNext = WeakPointAnalysis(Self.response(), basedOn: ids, createdAt: Date())
    #expect(WeakPointsView.next(withNext, counts: counts) == .init(title: "because を足してみよう。"))
  }

  /// 自分の文: 別の回の同じ文は 1 行にまとめ、回の数と一番新しい日時を持つ。並びは初めて出た順
  @Test func quoteLinesMergeTheSameSentence() {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let dates = ["r1": now.addingTimeInterval(-7200), "r2": now.addingTimeInterval(-3600), "r3": now]
    let lines = QuoteLine.group(
      [
        .init(record: "r1", quote: "A girl is happy."),
        .init(record: "r2", quote: "The dog is sleeping."),
        .init(record: "r3", quote: "a girl is  happy"),
      ], dates: dates)
    #expect(
      lines == [
        QuoteLine(quote: "a girl is  happy", count: 2, latest: now),
        QuoteLine(quote: "The dog is sleeping.", count: 1, latest: now.addingTimeInterval(-3600)),
      ])
  }

  /// 同じ回の同じ文は 1 回と数える。日時の分からない回だけなら日時は nil。違う文はまとめない
  @Test func quoteLinesCountRoundsOnce() {
    let lines = QuoteLine.group(
      [
        .init(record: "r1", quote: "He is running."),
        .init(record: "r1", quote: "He is running."),
        .init(record: "r2", quote: "He is runnings."),
      ], dates: [:])
    #expect(
      lines == [
        QuoteLine(quote: "He is running.", count: 1, latest: nil),
        QuoteLine(quote: "He is runnings.", count: 1, latest: nil),
      ])
    #expect(QuoteLine.key(" Is it  raining?! ") == "is it raining")
  }
}

/// 呼ばれた回数を数え、決まった分析か失敗を返す。hold() から release() までは、返さずに待たせる
actor StubClient: WeakPointClient {
  private(set) var calls = 0
  private var failure: WeakPointFailure?
  private var held = false
  private var waiting: [CheckedContinuation<Void, Never>] = []

  func fail(with failure: WeakPointFailure?) {
    self.failure = failure
  }

  func hold() {
    held = true
  }

  func release() {
    held = false
    waiting.forEach { $0.resume() }
    waiting = []
  }

  /// n 回目に呼ばれるまで待つ
  func waitUntilCalled(_ n: Int) async {
    while calls < n { await Task.yield() }
  }

  nonisolated func analyze(_ request: Components.Schemas.WeakPointRequest) async throws
    -> Components.Schemas.WeakPointResponse
  {
    try await respond(request)
  }

  private func respond(_ request: Components.Schemas.WeakPointRequest) async throws
    -> Components.Schemas.WeakPointResponse
  {
    calls += 1
    if held { await withCheckedContinuation { waiting.append($0) } }
    if let failure { throw failure }
    return MockWeakPointClient.response(for: request, habits: true)
  }
}
