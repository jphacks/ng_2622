import Foundation
import Testing

@testable import NG2622

/// きろくの画面に出す形（場面ごとのまとめ方・並び順・消した後）
struct RecordLibraryTests {
  let store = PlayRecordStore.temporary()
  /// 苦手の分析を覚える所（アプリの本物の置き場所には触れない）
  let analysis = WeakPointStore.temporary()

  func cleanUp() {
    try? FileManager.default.removeItem(at: store.directory)
    try? analysis.delete()
  }

  /// 同梱の作り置きの場面（その級の出題の候補の index 番目）
  func sceneID(_ difficulty: SceneDifficulty, _ index: Int = 0) throws -> String {
    let ids = ScenePool.bundled.candidates(of: difficulty)
    try #require(ids.count > index)
    return ids[index]
  }

  /// minutes 分前に遊んだ記録
  func record(_ id: String, sceneID: String, minutesAgo: Double) throws -> PlayRecord {
    let scene = try MockSceneLayoutClient.readDocument(sceneID)
    let results = RoundResults.mock(
      sceneID: sceneID, players: [(id: "me", name: "たろう", color: 0, isSelf: true, graded: true)])
    return try #require(
      try PlayRecord(
        id: id, playedAt: Date(timeIntervalSince1970: 1_794_000_000 - minutesAgo * 60), scene: scene, results: results))
  }

  /// 同じ場面の記録は 1 つにまとめる。場面は最後に遊んだのが新しい順、場面の中も新しい順
  @Test func groupsByScene() throws {
    let park = try sceneID(.eiken3, 0)
    let beach = try sceneID(.eiken3, 1)
    let kitchen = try sceneID(.eiken2, 0)
    let records = [
      try record("a", sceneID: park, minutesAgo: 50),
      try record("b", sceneID: beach, minutesAgo: 40),
      try record("c", sceneID: park, minutesAgo: 10),
      try record("d", sceneID: kitchen, minutesAgo: 30),
      try record("e", sceneID: park, minutesAgo: 20),
    ]
    let scenes = RecordScenes.group(records)
    #expect(scenes.map(\.id) == [park, kitchen, beach])
    #expect(scenes[0].entries.map(\.id) == ["c", "e", "a"])
    #expect(scenes[0].latest.id == "c")
    #expect(scenes[0].name == (try MockSceneLayoutClient.read(park)).name)
    #expect(scenes[0].layout?.id == park)
    #expect(scenes[0].sceneKey == "record:c")
    // 同じ場面で配置も同じ回は、3D を使い回す
    #expect(scenes[0].entries.map(\.sceneKey) == ["record:c", "record:c", "record:c"])
    #expect(scenes[1].sceneKey == "record:d")
    #expect(scenes[1].entries.count == 1)
    #expect(scenes[0].latest.difficulty == .eiken3)
    #expect(scenes[1].latest.difficulty == .eiken2)
    #expect(RecordScenes.group([]).isEmpty)
  }

  /// 場面に ID が無い記録は、ほかとまとめず、その記録だけのまとまりにする
  @Test func sceneWithoutID() throws {
    let scene = try JSONValue(data: Data(#"{"protocol":"scenenglish.scene/2","name":"名なしの場面","items":[]}"#.utf8))
    let result = try record("x", sceneID: try sceneID(.eiken3), minutesAgo: 0).result
    let records = ["n1", "n2"].map {
      PlayRecord(id: $0, playedAt: Date(timeIntervalSince1970: 1_794_000_000), difficulty: nil, scene: scene, result: result)
    }
    let scenes = RecordScenes.group(records)
    #expect(scenes.count == 2)
    #expect(scenes.allSatisfy { $0.name == "名なしの場面" && $0.entries.count == 1 })
  }

  /// 縦の流れに出す形: 自分 1 人だけで、点と内訳と講評が記録のとおり
  @Test func entryForReview() throws {
    let record = try record("a", sceneID: try sceneID(.eikenPre2), minutesAgo: 0)
    let entry = RecordEntry(record)
    #expect(entry.results.players.count == 1)
    #expect(entry.score?.total == record.result.score.total)
    #expect(entry.content?.items.count == record.result.content?.items.count)
    #expect(entry.results.myReview != nil)
    #expect(entry.layout?.description?.isEmpty == false)
  }

  /// 読み直すと、端末の記録と録音の数に合う
  @Test func reloadCounts() async throws {
    defer { cleanUp() }
    let library = RecordLibrary(store: store, analysis: analysis)
    await library.reload()
    #expect(library.count == 0)
    #expect(library.scenes.isEmpty)
    #expect(!library.canDelete)

    let audio = FileManager.default.temporaryDirectory.appending(path: "audio-\(UUID().uuidString).wav")
    try Data([1, 2, 3]).write(to: audio)
    defer { try? FileManager.default.removeItem(at: audio) }
    let park = try sceneID(.eiken3)
    try store.save(try record("a", sceneID: park, minutesAgo: 20), audio: audio)
    try store.save(try record("b", sceneID: park, minutesAgo: 10))
    try store.save(try record("c", sceneID: try sceneID(.eiken2), minutesAgo: 5))
    await library.reload()
    #expect(library.count == 3)
    #expect(library.audioCount == 1)
    #expect(library.scenes.map(\.entries.count) == [1, 2])
    // WAV として読めない録音は、聴けるものとして渡さない
    #expect(library.recordings.isEmpty)

    // WAV として読める録音は、読み直したときに 1 度だけ読んで、記録の ID で渡す
    let wav = FileManager.default.temporaryDirectory.appending(path: "audio-\(UUID().uuidString).wav")
    try Self.wav(seconds: 1).write(to: wav)
    defer { try? FileManager.default.removeItem(at: wav) }
    try store.save(try record("d", sceneID: park, minutesAgo: 1), audio: wav)
    await library.reload()
    #expect(library.audioCount == 2)
    #expect(library.recordings.keys.sorted() == ["d"])
    #expect(library.recordings["d"]?.duration == 1)
  }

  /// 16 kHz・16 bit・モノラルの、無音の WAV
  static func wav(seconds: Int) -> Data {
    let rate = 16_000
    let size = rate * 2 * seconds
    var data = Data()
    func u32(_ v: Int) { withUnsafeBytes(of: UInt32(v).littleEndian) { data.append(contentsOf: $0) } }
    func u16(_ v: Int) { withUnsafeBytes(of: UInt16(v).littleEndian) { data.append(contentsOf: $0) } }
    data.append(contentsOf: Array("RIFF".utf8)); u32(36 + size); data.append(contentsOf: Array("WAVE".utf8))
    data.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
    data.append(contentsOf: Array("data".utf8)); u32(size); data.append(Data(count: size))
    return data
  }

  /// すべて消すと、端末の記録も例の記録も、覚えた苦手の分析も無くなり、数が 0 になる
  @Test func deleteAll() async throws {
    defer { cleanUp() }
    try store.save(try record("a", sceneID: try sceneID(.eiken3), minutesAgo: 0))
    try analysis.save(
      WeakPointAnalysis(createdAt: Date(), basedOn: ["a"], result: .init(habits: [], improvement: nil, nextTry: nil)))
    let library = RecordLibrary(store: store, analysis: analysis, samples: PlayRecord.samples(count: 4))
    await library.reload()
    #expect(library.count == 5)

    try await library.deleteAll()
    #expect(!analysis.exists())
    #expect(library.count == 0)
    #expect(library.audioCount == 0)
    #expect(library.scenes.isEmpty)
    #expect(store.all().isEmpty)
    await library.reload()
    #expect(library.count == 0)
  }

  /// 読める記録が 0 件でも、読めなかったファイルが残っていれば消せる。消すと、消すものが無くなる
  @Test func deletesUnreadableFiles() async throws {
    defer { cleanUp() }
    try FileManager.default.createDirectory(at: store.directory, withIntermediateDirectories: true)
    try Data("{ こわれた".utf8).write(to: store.directory.appending(path: "broken.json"))
    let library = RecordLibrary(store: store, analysis: analysis)
    await library.reload()
    #expect(library.count == 0)
    #expect(library.canDelete)
    try await library.deleteAll()
    #expect(!library.canDelete)
    #expect(!store.hasFiles())
  }

  /// 例の記録は、頼んだ数だけあり、同じ場面を何回か遊んだ形で、端末には書かない
  @Test func samples() async throws {
    defer { cleanUp() }
    let samples = PlayRecord.samples(count: 12, now: Date(timeIntervalSince1970: 1_794_000_000))
    #expect(samples.count == 12)
    #expect(Set(samples.map(\.id)).count == 12)
    #expect(PlayRecord.samples(count: 0).isEmpty)
    let scenes = RecordScenes.group(samples)
    #expect(scenes.count >= 3)
    #expect(scenes.contains { $0.entries.count >= 3 })
    // 新しい回ほど合計が高い（同じ場面の中で、下がらない）
    for scene in scenes {
      let totals = scene.entries.compactMap { $0.score?.total }
      #expect(totals == totals.sorted(by: >))
    }
    let library = RecordLibrary(store: store, analysis: analysis, samples: samples)
    await library.reload()
    #expect(library.count == 12)
    #expect(store.all().isEmpty)
  }
}
