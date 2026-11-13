import BackendAPI
import Foundation
import Testing

@testable import NG2622

/// 苦手の場面: 頼む本文の作り方（引用を送らない・種類の並び・級）、覚える形、様子の出し分け（作っている間・できた・
/// 作れなかった）、Live の口の失敗の振り分け、Mock の場面
@MainActor
struct WeakSceneTests {
  typealias Records = WeakPointAnalysisTests

  /// kinds: 種類ごとの（言えた・一部・言えない）の並び。difficulty は級
  static func record(
    _ id: String, minutesAgo: Double = 0, difficulty: String? = "eiken-pre2",
    items: [(kind: String, level: String)] = [("center", "full"), ("reason", "none"), ("detail", "partial")]
  ) -> PlayRecord {
    PlayRecord(
      id: id, playedAt: Date(timeIntervalSince1970: 1_794_000_000 - minutesAgo * 60), difficulty: difficulty,
      scene: Records.scene,
      result: .init(
        transcript: "A boy is running.", score: .init(content: 60, expression: 70, speech: 70, total: 66),
        content: .init(
          claims: [.init(quote: "A boy is running.", verdict: "correct", item: nil, level: nil, note: nil)],
          items: items.enumerated().map { .init(id: "i\($0.offset)", kind: $0.element.kind, label: "項目", level: $0.element.level) },
          others: 0, recall: .init(earned: 1, max: 3), precision: .init(correct: 1, said: 1)),
        feedback: nil))
  }

  /// 癖 2 件（引用つき）と次に試すことのある分析
  static func analysis(basedOn: [String] = ["r0"], createdAt: Date = Date(timeIntervalSince1970: 1_794_000_000))
    -> WeakPointAnalysis
  {
    WeakPointAnalysis(
      createdAt: createdAt, basedOn: basedOn,
      result: .init(
        habits: [
          .init(
            viewpoint: "content", title: "理由をつなげずに文が終わる", what: "なぜを言わない",
            examples: [.init(record: "r0", quote: "A girl is carrying.")], fix: "because で理由を 1 つ足そう。"),
          .init(
            viewpoint: "expression", title: "短い文をくり返す", what: "There is が続く",
            examples: [.init(record: "r1", quote: "There is a dog.")], fix: "and でつないでみよう。"),
        ],
        improvement: nil,
        nextTry: .init(viewpoint: "content", text: "動きのあとに because で理由を 1 つ足してみよう。")))
  }

  static func recent(_ n: Int = 5) -> [PlayRecord] {
    (0..<n).map { record("r\($0)", minutesAgo: Double($0) * 10) }
  }

  // MARK: - 本文

  /// 送るのは級・種類・癖の観点と題と直し方・次に試すことだけ。自分の文の引用（examples）と癖の説明（what）は送らない
  @Test func requestCarriesNoQuotes() throws {
    let request = try #require(WeakSceneRequestBuilder.build(analysis: Self.analysis(), recent: Self.recent()))
    #expect(request.difficulty == .eikenPre2)
    #expect(request.habits?.map(\.title) == ["理由をつなげずに文が終わる", "短い文をくり返す"])
    #expect(request.habits?.map(\.viewpoint) == [.content, .expression])
    #expect(request.habits?.first?.fix == "because で理由を 1 つ足そう。")
    #expect(request.nextTry?.text == "動きのあとに because で理由を 1 つ足してみよう。")
    let json = try #require(String(data: JSONEncoder().encode(request), encoding: .utf8))
    for word in ["A girl is carrying", "There is a dog", "examples", "quote", "what", "なぜを言わない", "r0", "r1"] {
      #expect(!json.contains(word), "\(word) を送っている")
    }
  }

  /// 種類は言えた割合の低い順。分母 0 の種類（ここでは link）は入れない。同じ割合なら 中心 → 理由 → つながり → 細部
  @Test func kindsAreLowestFirst() throws {
    let request = try #require(WeakSceneRequestBuilder.build(analysis: Self.analysis(), recent: Self.recent()))
    // center 1.0・reason 0・detail 0.5
    #expect(request.kinds == [.reason, .detail, .center])

    let tie = (0..<5).map {
      Self.record("t\($0)", minutesAgo: Double($0), items: [("detail", "none"), ("link", "partial"), ("center", "none")])
    }
    #expect(WeakSceneRequestBuilder.kinds(WeakPointCounts(records: tie).coverage) == [.center, .detail, .link])
  }

  /// 数えられる種類が無ければ頼まない（本文を作らない）
  @Test func noKindsNoRequest() {
    let empty = (0..<5).map { Self.record("e\($0)", minutesAgo: Double($0), items: []) }
    #expect(WeakSceneRequestBuilder.build(analysis: Self.analysis(), recent: empty) == nil)
  }

  /// 級は直近の記録の級。級の無い記録は飛ばし、どれにも無ければ 3 級
  @Test func difficultyIsTheLatestGrade() {
    var records = Self.recent()
    records[0] = Self.record("r0", minutesAgo: 0, difficulty: nil)
    records[1] = Self.record("r1", minutesAgo: 10, difficulty: "eiken-2")
    #expect(WeakSceneRequestBuilder.difficulty(records.shuffled()) == .eiken2)
    #expect(WeakSceneRequestBuilder.difficulty([Self.record("x", difficulty: nil)]) == .eiken3)
  }

  /// 題は 80、直し方と次に試すことは 200（UTF-16）で切る。空の癖は送らず、癖は 3 件まで。癖が無ければ欄ごと送らない
  @Test func clipsAndLimitsHabits() throws {
    let long = String(repeating: "あ", count: 300)
    let habit = WeakPointAnalysis.Habit(
      viewpoint: "content", title: long, what: "", examples: [.init(record: "r0", quote: "x")], fix: long)
    let blank = WeakPointAnalysis.Habit(viewpoint: "content", title: "  ", what: "", examples: [], fix: "直す")
    let analysis = WeakPointAnalysis(
      createdAt: Date(), basedOn: ["r0"],
      result: .init(
        habits: [blank, habit, habit, habit, habit], improvement: nil, nextTry: .init(viewpoint: "content", text: long)))
    let request = try #require(WeakSceneRequestBuilder.build(analysis: analysis, recent: Self.recent()))
    #expect(request.habits?.count == 3)
    #expect(request.habits?.first?.title.utf16.count == 80)
    #expect(request.habits?.first?.fix.utf16.count == 200)
    #expect(request.nextTry?.text.utf16.count == 200)

    let none = WeakPointAnalysis(
      createdAt: Date(), basedOn: ["r0"], result: .init(habits: [], improvement: nil, nextTry: nil))
    let bare = try #require(WeakSceneRequestBuilder.build(analysis: none, recent: Self.recent()))
    #expect(bare.habits == nil)
    #expect(bare.nextTry == nil)
    let json = try #require(String(data: JSONEncoder().encode(bare), encoding: .utf8))
    #expect(!json.contains("habits"))
  }

  // MARK: - 覚える形

  static func scene(_ id: String = "weak-0f8fad5b-d9cb-469f-a165-70867728950e") throws -> WeakScene {
    let document = try MockSceneLayoutClient.readDocument(try #require(ScenePool.bundled.candidates(of: .eikenPre2).first))
    return WeakScene(
      sceneId: id, name: "雨のバス停", difficulty: "eiken-pre2", focus: "reason", pitch: "because で理由を言いやすい場面です",
      layout: try JSONValue(data: document.data), createdParts: ["teapot_red@1"])
  }

  /// 覚えて読み戻せる。知らない版は読まない。分析を忘れる（フォルダごと消す）と、場面も消える
  @Test func storeSavesLoadsAndDeletes() throws {
    let analysisStore = WeakPointStore.temporary()
    let store = WeakSceneStore(directory: analysisStore.directory)
    defer { try? analysisStore.delete() }
    let saved = SavedWeakScene(createdAt: Date(), basedOn: ["r1", "r0"], scene: try Self.scene())
    try store.save(saved)
    #expect(store.load() == saved)
    #expect(try store.load()?.scene.document().layout.items.isEmpty == false)

    var json = try #require(String(data: saved.encoded(), encoding: .utf8))
    json = json.replacingOccurrences(of: SavedWeakScene.protocolName, with: "scenenglish.weakscene/9")
    try Data(json.utf8).write(to: store.fileURL)
    #expect(store.load() == nil)

    try store.save(saved)
    try analysisStore.delete()
    #expect(store.load() == nil)
  }

  // MARK: - 様子

  /// 一時のフォルダに覚える作り手。終わったら folder を消す
  func maker(_ client: StubSceneClient, timeout: Duration = .seconds(100)) -> (WeakSceneMaker, WeakSceneStore) {
    let store = WeakSceneStore(directory: WeakPointStore.temporary().directory)
    return (WeakSceneMaker(client: client, store: store, timeout: timeout), store)
  }

  /// 分析を待つ間 → 分析が届いたら頼む → できた。同じ記録の分析では、開き直しても起動し直しても頼まずに覚えた場面を出す。
  /// 分析を作り直す（元の記録が替わる）ときは「作っている」から作り直す
  @Test func makesOncePerRecordsAndRebuilds() async throws {
    let client = StubSceneClient()
    let (maker, store) = maker(client)
    defer { try? FileManager.default.removeItem(at: store.directory) }
    let analysis = Self.analysis(basedOn: ["r1", "r0"])

    maker.waiting(basedOn: analysis.basedOn)
    #expect(maker.phase == .making)
    maker.make(analysis: analysis, recent: Self.recent())
    #expect(maker.phase == .making)
    await maker.waitForPending()
    guard case .ready(let scene) = maker.phase else { Issue.record("できていない: \(maker.phase)"); return }
    #expect(store.load()?.scene == scene)
    #expect(store.load()?.basedOn == ["r1", "r0"])
    #expect(await client.calls == 1)
    #expect(await client.requests.first?.kinds == [.reason, .detail, .center])
    #expect(await client.requests.first?.habits?.count == 2)

    // 開き直す（同じ分析）: 頼まない。起動し直しても、覚えた場面を出す
    maker.make(analysis: analysis, recent: Self.recent())
    #expect(maker.phase == .ready(scene))
    let relaunched = WeakSceneMaker(client: client, store: store)
    relaunched.make(analysis: analysis, recent: Self.recent())
    #expect(relaunched.phase == .ready(scene))
    #expect(await client.calls == 1)

    // 分析を作り直している間は「作っている」。新しい分析が届いたら作り直す
    let newer = Self.analysis(basedOn: ["r1", "r0", "new"], createdAt: Date(timeIntervalSince1970: 1_794_100_000))
    maker.waiting(basedOn: newer.basedOn)
    #expect(maker.phase == .making)
    maker.make(analysis: newer, recent: Self.recent())
    await maker.waitForPending()
    #expect(await client.calls == 2)
    #expect(store.load()?.basedOn == newer.basedOn)
  }

  /// 作れなかったら（理由を問わず）カードに出さず、知らせる数を 1 つ増やす。開き直す（reopen）までは頼み直さず、
  /// 開き直したら、もう一度頼む（上限なら、また知らせる）
  @Test func failureHidesNotifiesAndRetriesOnReopen() async throws {
    let client = StubSceneClient()
    await client.fail(with: .rateLimited)
    let (maker, store) = maker(client)
    defer { try? FileManager.default.removeItem(at: store.directory) }
    let analysis = Self.analysis()
    maker.make(analysis: analysis, recent: Self.recent())
    await maker.waitForPending()
    #expect(maker.phase == .failed(.rateLimited))
    #expect(!maker.phase.showsInCard)
    #expect(maker.notices == 1)
    #expect(maker.noticed == 0)
    maker.markNoticed()
    #expect(maker.noticed == 1)

    // 開き直すまでは頼み直さない
    maker.make(analysis: analysis, recent: Self.recent())
    #expect(maker.phase == .failed(.rateLimited))
    #expect(await client.calls == 1)

    // 開き直すと、もう一度頼む。また上限なら、また知らせる
    maker.reopen()
    maker.make(analysis: analysis, recent: Self.recent())
    #expect(maker.phase == .making)
    await maker.waitForPending()
    #expect(maker.phase == .failed(.rateLimited))
    #expect(await client.calls == 2)
    #expect(maker.notices == 2)

    // 閉じている間に作れなかったことは、開き直して頼み直すので知らせない。できたら出す
    await client.fail(with: nil)
    maker.reopen()
    #expect(maker.noticed == maker.notices)
    maker.make(analysis: analysis, recent: Self.recent())
    await maker.waitForPending()
    guard case .ready = maker.phase else { Issue.record("できていない: \(maker.phase)"); return }
    #expect(await client.calls == 3)
  }

  /// 100 秒（テストでは縮める）待っても返らなければ、作れなかった
  @Test func timesOutAfterTheLimit() async throws {
    #expect(WeakSceneClients.timeout == .seconds(100))
    let client = StubSceneClient()
    await client.hold()
    let (maker, store) = maker(client, timeout: .milliseconds(50))
    defer { try? FileManager.default.removeItem(at: store.directory) }
    maker.make(analysis: Self.analysis(), recent: Self.recent())
    // 打ち切っても、止められない頼み（このスタブ）は終わるまで待つので、打ち切りのあとで返させる
    // （本物の通信は止めると返る）
    Task {
      try? await Task.sleep(for: .milliseconds(300))
      await client.release()
    }
    await maker.waitForPending()
    #expect(maker.phase == .failed(.failed))
    #expect(maker.notices == 1)
  }

  /// AI の分析を作れなかった: 級と種類だけで頼む（癖と次に試すことは付けない）。同じ記録の分析を頼み直している間と、
  /// あとで分析が届いたときは、その場面を出して頼み直さない
  @Test func analysisFailureSendsKindsOnly() async throws {
    let client = StubSceneClient()
    let (maker, store) = maker(client)
    defer { try? FileManager.default.removeItem(at: store.directory) }
    maker.makeWithoutAnalysis(basedOn: ["r1", "r0"], recent: Self.recent())
    await maker.waitForPending()
    guard case .ready(let scene) = maker.phase else { Issue.record("できていない: \(maker.phase)"); return }
    let request = try #require(await client.requests.first)
    #expect(request.habits == nil)
    #expect(request.nextTry == nil)
    #expect(request.kinds == [.reason, .detail, .center])
    #expect(request.difficulty == .eikenPre2)

    maker.waiting(basedOn: ["r1", "r0"])
    #expect(maker.phase == .ready(scene))
    maker.make(analysis: Self.analysis(basedOn: ["r1", "r0"]), recent: Self.recent())
    #expect(maker.phase == .ready(scene))
    #expect(await client.calls == 1)
  }

  /// 作っている途中に開き直しても（同じ記録）、頼んだものを止めずに待つ（アプリの中で 1 本だけ）
  @Test func reopeningWhileMakingKeepsTheRequest() async throws {
    let client = StubSceneClient()
    await client.hold()
    let (maker, store) = maker(client)
    defer { try? FileManager.default.removeItem(at: store.directory) }
    let analysis = Self.analysis()
    maker.make(analysis: analysis, recent: Self.recent())
    await client.waitUntilCalled(1)
    maker.waiting(basedOn: analysis.basedOn)
    maker.make(analysis: analysis, recent: Self.recent())
    #expect(maker.phase == .making)
    await client.release()
    await maker.waitForPending()
    guard case .ready = maker.phase else { Issue.record("できていない: \(maker.phase)"); return }
    #expect(await client.calls == 1)
  }

  /// すべて消す: 作っている途中のものも捨て、あとで返っても覚えない。記録が足りなくなったら（reset）、覚えた場面も消す
  @Test func forgetAndResetDropScenes() async throws {
    let client = StubSceneClient()
    await client.hold()
    let (maker, store) = maker(client)
    defer { try? FileManager.default.removeItem(at: store.directory) }
    maker.make(analysis: Self.analysis(), recent: Self.recent())
    await client.waitUntilCalled(1)
    maker.forget()
    #expect(maker.phase == .idle)
    await client.release()
    await maker.waitForPending()
    #expect(maker.phase == .idle)
    #expect(store.load() == nil)

    maker.make(analysis: Self.analysis(), recent: Self.recent())
    await maker.waitForPending()
    #expect(store.load() != nil)
    maker.reset()
    #expect(maker.phase == .idle)
    #expect(store.load() == nil)
  }

  // MARK: - 分析の口から

  /// i = 0 がいちばん新しい n 件（分析の口のテストの記録）
  static func analyzer(_ analysisClient: StubClient, scenes: StubSceneClient) -> (WeakPointAnalyzer, WeakSceneMaker, WeakPointStore) {
    let analysisStore = WeakPointStore.temporary()
    let maker = WeakSceneMaker(client: scenes, store: WeakSceneStore(directory: analysisStore.directory))
    return (WeakPointAnalyzer(client: analysisClient, store: analysisStore, scenes: maker), maker, analysisStore)
  }

  /// 分析が届いたら、画面を待たずにすぐ場面を頼む。すべて消すと、場面も忘れる
  @Test func analyzerAsksForSceneWhenAnalysisArrives() async throws {
    let sceneClient = StubSceneClient()
    let (analyzer, maker, store) = Self.analyzer(StubClient(), scenes: sceneClient)
    defer { try? store.delete() }
    let records = Records.records(10)
    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    #expect(maker.phase == .making)
    await analyzer.waitForPending()
    #expect(analyzer.phase == .ready)
    await maker.waitForPending()
    guard case .ready = maker.phase else { Issue.record("できていない: \(maker.phase)"); return }
    let request = try #require(await sceneClient.requests.first)
    #expect(request.difficulty == .eikenPre2)
    #expect(request.habits?.count == 2)

    analyzer.forget()
    #expect(maker.phase == .idle)
  }

  /// 分析と場面を作り直すのは、記録が 5 件ずつ増えたとき（10 → 15 件目）だけ。その間は覚えた分析と場面を出して頼まない
  @Test func analyzerRebuildsOnlyEveryFiveRecords() async throws {
    let analysisClient = StubClient()
    let sceneClient = StubSceneClient()
    let (analyzer, maker, store) = Self.analyzer(analysisClient, scenes: sceneClient)
    defer { try? store.delete() }
    var records = Records.records(10)
    analyzer.open(records: records, existing: { [records] in Set(records.map(\.id)) })
    await analyzer.waitForPending()
    await maker.waitForPending()
    #expect(analyzer.analysis?.records == 10)
    guard case .ready(let first) = maker.phase else { Issue.record("できていない: \(maker.phase)"); return }

    for i in 1...4 {
      records.insert(Records.record("add\(i)", minutesAgo: -Double(i)), at: 0)
      analyzer.open(records: records, existing: { [records] in Set(records.map(\.id)) })
      #expect(analyzer.phase == .ready)
      #expect(maker.phase == .ready(first))
    }
    #expect(await analysisClient.calls == 1)
    #expect(await sceneClient.calls == 1)

    records.insert(Records.record("add5", minutesAgo: -5), at: 0)
    analyzer.open(records: records, existing: { [records] in Set(records.map(\.id)) })
    #expect(analyzer.phase == .loading)
    #expect(maker.phase == .making)
    await analyzer.waitForPending()
    await maker.waitForPending()
    #expect(analyzer.analysis?.records == 15)
    #expect(await analysisClient.calls == 2)
    #expect(await sceneClient.calls == 2)
    guard case .ready(let second) = maker.phase else { Issue.record("できていない: \(maker.phase)"); return }
    #expect(second != first)
  }

  /// 場面を作れなかったあと、覚えた場面が無いまま開き直したら、分析は頼まずに場面だけもう一度頼む
  @Test func analyzerReopenRetriesFailedScene() async throws {
    let analysisClient = StubClient()
    let sceneClient = StubSceneClient()
    await sceneClient.fail(with: .rateLimited)
    let (analyzer, maker, store) = Self.analyzer(analysisClient, scenes: sceneClient)
    defer { try? store.delete() }
    let records = Records.records(10)
    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    await analyzer.waitForPending()
    await maker.waitForPending()
    #expect(maker.phase == .failed(.rateLimited))
    #expect(maker.notices == 1)

    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    #expect(analyzer.phase == .ready)
    #expect(maker.phase == .making)
    await maker.waitForPending()
    #expect(maker.phase == .failed(.rateLimited))
    #expect(maker.notices == 2)
    #expect(await analysisClient.calls == 1)
    #expect(await sceneClient.calls == 2)
  }

  /// 分析を作れなかったら、級と種類だけで場面を頼む。開き直して分析を頼み直しても、同じ記録なら場面は頼み直さない
  @Test func analyzerFailureMakesKindsOnlyScene() async throws {
    let analysisClient = StubClient()
    await analysisClient.fail(with: .failed)
    let sceneClient = StubSceneClient()
    let (analyzer, maker, store) = Self.analyzer(analysisClient, scenes: sceneClient)
    defer { try? store.delete() }
    let records = Records.records(10)
    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    await analyzer.waitForPending()
    #expect(analyzer.phase == .failed(.failed))
    await maker.waitForPending()
    guard case .ready(let scene) = maker.phase else { Issue.record("できていない: \(maker.phase)"); return }
    #expect(await sceneClient.requests.first?.habits == nil)

    analyzer.open(records: records, existing: { Set(records.map(\.id)) })
    #expect(analyzer.phase == .loading)
    #expect(maker.phase == .ready(scene))
    await analyzer.waitForPending()
    #expect(maker.phase == .ready(scene))
    #expect(await analysisClient.calls == 2)
    #expect(await sceneClient.calls == 1)
  }

  // MARK: - Live の口

  static func live(_ transport: FakeTransport) -> LiveWeakSceneClient {
    LiveWeakSceneClient(baseURL: URL(string: "http://localhost:8787")!, transport: transport)
  }

  static func request() throws -> Components.Schemas.WeakSceneRequest {
    try #require(WeakSceneRequestBuilder.build(analysis: analysis(), recent: recent()))
  }

  /// 200 は場面を返す（配置は JSON のまま持つ）。送るのは整形しない JSON
  @Test func liveReturnsScene() async throws {
    let scene = try Self.scene()
    let body = """
      {"sceneId":"\(scene.sceneId)","name":"雨のバス停","difficulty":"eiken-pre2","focus":"reason",
      "pitch":"because で理由を言いやすい場面です","createdParts":["teapot_red@1"],
      "layout":\(String(data: try JSONEncoder().encode(scene.layout), encoding: .utf8)!)}
      """
    let transport = FakeTransport(status: 200, body: Data(body.utf8))
    let returned = try await Self.live(transport).make(try Self.request())
    #expect(returned.sceneId == scene.sceneId)
    #expect(returned.focusKind == .reason)
    #expect(returned.createdParts == ["teapot_red@1"])
    #expect(try returned.document().layout == scene.document().layout)
    let sent = try #require(await transport.sent.data)
    #expect(!sent.contains(UInt8(ascii: "\n")))
    #expect(await transport.sent.operationID == "generateWeakScene")
  }

  /// 429 は上限、503 は止めている、400・413 は受け付けない、502・知らないコードは作れない、応答が無ければ通信できない
  @Test(arguments: zip(
    [429, 503, 400, 413, 502, 500],
    [WeakSceneFailure.rateLimited, .unavailable, .rejected, .rejected, .failed, .failed]))
  func liveMapsStatus(status: Int, expected: WeakSceneFailure) async throws {
    let transport = FakeTransport(status: status, body: WeakPointClientTests.errorBody)
    await #expect(throws: expected) { _ = try await Self.live(transport).make(try Self.request()) }
  }

  @Test func liveOfflineAndUnreadable() async throws {
    let offline = FakeTransport(status: 0, body: Data(), error: URLError(.notConnectedToInternet))
    await #expect(throws: WeakSceneFailure.offline) { _ = try await Self.live(offline).make(try Self.request()) }
    let html = FakeTransport(status: 429, body: Data("<html>429</html>".utf8), contentType: "text/html")
    await #expect(throws: WeakSceneFailure.rateLimited) { _ = try await Self.live(html).make(try Self.request()) }
  }

  // MARK: - Mock

  /// Mock は頼んだ級の作り置きの場面を、weak- の ID にして返す（配置の id も替える）。狙う種類は場面にあるもの
  @Test func mockReturnsPoolSceneAsWeakScene() async throws {
    let client = MockWeakSceneClient(behavior: .ok, delay: .zero)
    let scene = try await client.make(try Self.request())
    #expect(scene.sceneId.hasPrefix("weak-"))
    #expect(scene.difficulty == "eiken-pre2")
    let layout = try scene.document().layout
    #expect(layout.id == scene.sceneId)
    #expect(layout.difficulty == .eikenPre2)
    #expect(layout.checklist.contains { $0.kind.rawValue == scene.focus })
    await #expect(throws: WeakSceneFailure.rateLimited) {
      _ = try await MockWeakSceneClient(behavior: .limit, delay: .zero).make(try Self.request())
    }
  }
}

/// 呼ばれた回数と本文を控え、Mock の場面か失敗を返す。hold() から release() までは、返さずに待たせる
actor StubSceneClient: WeakSceneClient {
  private(set) var calls = 0
  private(set) var requests: [Components.Schemas.WeakSceneRequest] = []
  private var failure: WeakSceneFailure?
  private var held = false
  private var waiting: [CheckedContinuation<Void, Never>] = []

  func fail(with failure: WeakSceneFailure?) {
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

  func waitUntilCalled(_ n: Int) async {
    while calls < n { await Task.yield() }
  }

  nonisolated func make(_ request: Components.Schemas.WeakSceneRequest) async throws -> WeakScene {
    try await respond(request)
  }

  private func respond(_ request: Components.Schemas.WeakSceneRequest) async throws -> WeakScene {
    calls += 1
    requests.append(request)
    if held { await withCheckedContinuation { waiting.append($0) } }
    if let failure { throw failure }
    return try await MockWeakSceneClient(behavior: .ok, delay: .zero).make(request)
  }
}
