import Foundation
import Testing

@testable import NG2622

/// 遊んだ記録を端末に残す（PlayRecordStore）。一時のフォルダを使い、本物の領域（Application Support）は触らない
struct PlayRecordStoreTests {
  /// test ごとの一時のフォルダ
  let directory = FileManager.default.temporaryDirectory
    .appending(path: "records-test-\(UUID().uuidString)", directoryHint: .isDirectory)
  var store: PlayRecordStore { PlayRecordStore(directory: directory) }
  let me = PlayerProfile(name: "たろう", color: 0x5B5BE6)

  func cleanUp() {
    try? FileManager.default.removeItem(at: directory)
  }

  /// フォルダの中のファイルの名前
  func fileNames() -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []).sorted()
  }

  /// 同梱の作り置きの場面（出題の候補の 1 つ目）
  func sceneID(_ difficulty: SceneDifficulty = .eiken3) throws -> String {
    try #require(ScenePool.bundled.candidates(of: difficulty).first)
  }

  /// 仮の結果。自分とほかの 1 人
  func results(sceneID: String, graded: Bool = true) -> RoundResults {
    RoundResults.mock(
      sceneID: sceneID,
      players: [
        (id: "p0", name: "はなこ", color: 0xE5484D, isSelf: false, graded: true),
        (id: "me", name: "たろう", color: 0x5B5BE6, isSelf: true, graded: graded),
      ])
  }

  func record(
    id: String = PlayRecordStore.newID(), sceneID: String, playedAt: Date = Date(timeIntervalSince1970: 1_794_000_000)
  ) throws -> PlayRecord {
    let scene = try MockSceneLayoutClient.readDocument(sceneID)
    return try #require(try PlayRecord(id: id, playedAt: playedAt, scene: scene, results: results(sceneID: sceneID)))
  }

  /// 録音のかわりのファイル
  func audioFile(_ bytes: [UInt8] = [0x52, 0x49, 0x46, 0x46, 1, 2, 3]) throws -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: "audio-\(UUID().uuidString).wav")
    try Data(bytes).write(to: url)
    return url
  }

  func session() -> RoomSession {
    RoomSession(
      client: MockGameClient(options: .init()), me: me, records: store,
      scenes: SceneLayoutStore(client: MockSceneLayoutClient()))
  }

  // MARK: - 保存と読み出し

  /// 保存して読み戻すと同じ中身。場面はアプリが読まない項目も含めてまるごと残り、録音は <id>.wav に写る
  @Test func saveAndLoad() throws {
    defer { cleanUp() }
    let sceneID = try sceneID()
    let record = try record(sceneID: sceneID)
    let audio = try audioFile()
    defer { try? FileManager.default.removeItem(at: audio) }

    #expect(try store.save(record, audio: audio))
    #expect(fileNames() == ["\(record.id).json", "\(record.id).wav"])
    #expect(store.all() == [record])
    #expect(store.record(id: record.id) == record)
    let saved = try #require(store.audioURL(of: record.id))
    #expect(try Data(contentsOf: saved) == Data(contentsOf: audio))
    // 元の録音は消さない（振り返りで聞き直すのに使っている）
    #expect(FileManager.default.fileExists(atPath: audio.path))

    // 場面は同梱の JSON と同じ中身（place のように、アプリが並べるのに使わない項目も残る）
    let source = try JSONValue(data: MockSceneLayoutClient.readDocument(sceneID).data)
    #expect(record.scene == source)
    guard case .object(let scene) = store.record(id: record.id)?.scene, case .array(let items)? = scene["items"],
      case .object(let item)? = items.first
    else {
      Issue.record("場面の items が読めない")
      return
    }
    #expect(scene["protocol"] == .string(SceneLayout.protocolName))
    #expect(item["place"] != nil)
    #expect(record.difficulty == SceneDifficulty.eiken3.rawValue)
    #expect(record.protocol == "scenenglish.record/1")
  }

  /// ファイルの欄の名前は、バックエンドの PlayerResult と同じ（話し方は speech、null の欄も書く）。順位とほかの人は入らない
  @Test func fileShape() throws {
    defer { cleanUp() }
    let record = try record(id: "shape-1", sceneID: try sceneID())
    try store.save(record)
    let text = try String(contentsOf: directory.appending(path: "shape-1.json"), encoding: .utf8)
    let json = try #require(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
    #expect(Set(json.keys) == ["protocol", "id", "playedAt", "difficulty", "scene", "result"])
    #expect(json["playedAt"] as? String == "2026-11-06T21:20:00Z")
    let result = try #require(json["result"] as? [String: Any])
    #expect(Set(result.keys) == ["transcript", "score", "content", "feedback"])
    let score = try #require(result["score"] as? [String: Any])
    #expect(Set(score.keys) == ["content", "expression", "speech", "total"])
    let feedback = try #require(result["feedback"] as? [String: Any])
    #expect(Set(feedback.keys) == ["nextStep", "rewrite", "speechTip", "expressionBasis"])
    #expect(!text.contains("はなこ"))
    #expect(!text.contains("rank"))
  }

  /// 表現の点の根拠は、保存して読み戻しても残り、振り返りの形に戻しても残る（画面には出さない）
  @Test func keepsExpressionBasis() throws {
    defer { cleanUp() }
    let sceneID = try sceneID()
    let record = try record(id: "basis-1", sceneID: sceneID)
    let basis = try #require(results(sceneID: sceneID).myReview?.expressionBasis)
    #expect(!basis.isEmpty)
    #expect(record.result.feedback?.expressionBasis == basis)
    try store.save(record)
    let read = try #require(store.record(id: "basis-1"))
    #expect(read.result.feedback?.expressionBasis == basis)
    #expect(read.results.myReview?.expressionBasis == basis)
  }

  /// 欄を足す前の記録（feedback に expressionBasis が無い）も読め、根拠は nil になる。版は /1 のまま
  @Test func readsRecordWithoutExpressionBasis() throws {
    let record = try record(sceneID: try sceneID())
    var json = try #require(try JSONSerialization.jsonObject(with: record.encoded()) as? [String: Any])
    var result = try #require(json["result"] as? [String: Any])
    var feedback = try #require(result["feedback"] as? [String: Any])
    feedback.removeValue(forKey: "expressionBasis")
    result["feedback"] = feedback
    json["result"] = result
    let read = try PlayRecord.decode(JSONSerialization.data(withJSONObject: json))
    #expect(read.protocol == "scenenglish.record/1")
    #expect(read.result.feedback != nil)
    #expect(read.result.feedback?.expressionBasis == nil)
    #expect(read.result.feedback?.nextStep == record.result.feedback?.nextStep)
    #expect(read.results.myReview?.expressionBasis == nil)
  }

  /// 根拠が null で届いた回（3 語未満など）の記録は、null と書いて、読み戻しても nil のまま（空の文字列にしない）
  @Test func roundTripsNullExpressionBasis() throws {
    defer { cleanUp() }
    let sceneID = try sceneID()
    let original = try record(id: "null-basis", sceneID: sceneID)
    let feedback = try #require(original.result.feedback)
    let record = PlayRecord(
      id: original.id, playedAt: original.playedAt, difficulty: original.difficulty, scene: original.scene,
      result: .init(
        transcript: original.result.transcript, score: original.result.score, content: original.result.content,
        feedback: .init(
          nextStep: feedback.nextStep, rewrite: feedback.rewrite, speechTip: feedback.speechTip, expressionBasis: nil)))
    try store.save(record)
    let text = try String(contentsOf: directory.appending(path: "null-basis.json"), encoding: .utf8)
    #expect(text.contains(#""expressionBasis" : null"#))
    let read = try #require(store.record(id: "null-basis"))
    #expect(read == record)
    #expect(read.result.feedback?.expressionBasis == nil)
    #expect(read.results.myReview?.expressionBasis == nil)
  }

  /// 根拠が無い（nil）ときも、欄を省かずに null と書く（play-record.md の「null の欄は省かずに null と書く」）
  @Test func writesNullExpressionBasis() throws {
    let feedback = PlayRecord.Feedback(
      nextStep: .init(kind: "content", text: "t", item: nil, gain: nil), rewrite: nil,
      speechTip: .init(aspect: "fluency", text: "s"), expressionBasis: nil)
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    let text = String(decoding: try encoder.encode(feedback), as: UTF8.self)
    #expect(text.contains(#""expressionBasis":null"#))
    #expect(text.contains(#""rewrite":null"#))
    #expect(text.contains(#""item":null"#))
  }

  /// 記録から、振り返りの画面に渡す形（自分 1 人の結果）に戻せる
  @Test func resultsFromRecord() throws {
    let sceneID = try sceneID()
    let original = results(sceneID: sceneID)
    let record = try record(sceneID: sceneID)
    let restored = try PlayRecord.decode(record.encoded()).results
    let me = try #require(original.me)
    #expect(restored.sceneID == sceneID)
    #expect(restored.sceneName == original.sceneName)
    #expect(restored.players.count == 1)
    #expect(restored.me?.score == me.score)
    #expect(restored.me?.transcript == me.transcript)
    #expect(restored.me?.content == me.content)
    #expect(restored.myReview == original.myReview)
  }

  /// 記録の場面から、同じ 3D を組み立てられる（ID で取りに行かない）
  @Test func sceneFromRecord() async throws {
    let sceneID = try sceneID(.eikenPre2)
    let record = try record(sceneID: sceneID)
    let layout = try PlayRecord.decode(record.encoded()).sceneLayout()
    #expect(layout == (try MockSceneLayoutClient.read(sceneID)))
    let composed = try #require(await SceneLibrary.shared.instance(composing: layout))
    #expect(!composed.root.children.isEmpty)
  }

  /// 新しい順に並ぶ
  @Test func newestFirst() throws {
    defer { cleanUp() }
    let sceneID = try sceneID()
    let old = try record(id: "a-old", sceneID: sceneID, playedAt: Date(timeIntervalSince1970: 1_794_000_000))
    let new = try record(id: "b-new", sceneID: sceneID, playedAt: Date(timeIntervalSince1970: 1_794_000_600))
    try store.save(old)
    try store.save(new)
    #expect(store.all().map(\.id) == ["b-new", "a-old"])
  }

  /// 録音が無いラウンドは、録音なしの記録として残る
  @Test func withoutAudio() throws {
    defer { cleanUp() }
    let record = try record(sceneID: try sceneID())
    try store.save(record)
    #expect(fileNames() == ["\(record.id).json"])
    #expect(store.audioURL(of: record.id) == nil)
    // 録音のファイルが無くなっていた（写せない）ときも、記録は残す
    let other = try self.record(sceneID: try sceneID())
    try store.save(other, audio: FileManager.default.temporaryDirectory.appending(path: "no-such-\(UUID().uuidString).wav"))
    #expect(store.record(id: other.id) == other)
    #expect(store.audioURL(of: other.id) == nil)
  }

  /// 同じ ID の記録は 2 回保存しない（上書きもしない）
  @Test func savesOnce() throws {
    defer { cleanUp() }
    let first = try record(id: "same", sceneID: try sceneID(.eiken3))
    let second = try record(id: "same", sceneID: try sceneID(.eiken2))
    #expect(try store.save(first))
    #expect(try !store.save(second))
    #expect(store.all() == [first])
  }

  /// フォルダの外を指す ID は受け付けない
  @Test func rejectsPathLikeID() throws {
    defer { cleanUp() }
    let record = try record(id: "../escape", sceneID: try sceneID())
    #expect(throws: PlayRecordStoreError.invalidID) { try store.save(record) }
    #expect(throws: PlayRecordStoreError.invalidID) { try store.delete(id: "a/b") }
    #expect(store.record(id: "") == nil)
  }

  // MARK: - 壊れたファイル

  /// 壊れたファイル・知らない版の形・名前と ID が違う記録は飛ばして、残りを読む
  @Test func skipsUnreadable() throws {
    defer { cleanUp() }
    let good = try record(id: "good", sceneID: try sceneID())
    try store.save(good)
    try Data("{ こわれた".utf8).write(to: directory.appending(path: "broken.json"))
    try Data().write(to: directory.appending(path: "empty.json"))
    let future = String(decoding: try record(id: "future", sceneID: try sceneID()).encoded(), as: UTF8.self)
      .replacingOccurrences(of: "scenenglish.record/1", with: "scenenglish.record/2")
    try Data(future.utf8).write(to: directory.appending(path: "future.json"))
    try good.encoded().write(to: directory.appending(path: "renamed.json"))

    #expect(store.all() == [good])
    #expect(store.record(id: "broken") == nil)
    #expect(store.record(id: "future") == nil)
    #expect(store.record(id: "renamed") == nil)
  }

  /// 知らない種類の値（後から増えた verdict など）があっても、記録は読める。画面の形に直すときに、その描写だけ飛ばす
  @Test func toleratesUnknownKinds() throws {
    let record = try record(sceneID: try sceneID())
    let text = String(decoding: try record.encoded(), as: UTF8.self)
      .replacingOccurrences(of: #""verdict" : "correct""#, with: #""verdict" : "newkind""#)
    let read = try PlayRecord.decode(Data(text.utf8))
    let claims = try #require(read.result.content?.claims)
    #expect(claims.contains { $0.verdict == "newkind" })
    #expect((read.results.me?.content?.claims.count ?? 0) < claims.count)
  }

  // MARK: - 消去

  /// 1 つ消すと、その記録の json と wav が無くなり、ほかは残る
  @Test func deleteOne() throws {
    defer { cleanUp() }
    let audio = try audioFile()
    defer { try? FileManager.default.removeItem(at: audio) }
    let a = try record(id: "a", sceneID: try sceneID())
    let b = try record(id: "b", sceneID: try sceneID())
    try store.save(a, audio: audio)
    try store.save(b, audio: audio)
    try store.delete(id: "a")
    #expect(fileNames() == ["b.json", "b.wav"])
    #expect(store.all() == [b])
    // 無い記録を消しても失敗にしない
    try store.delete(id: "a")
  }

  /// すべて消すと、json も wav も（読めなかったファイルも）無くなる。そのあとも保存できる
  @Test func deleteAll() throws {
    defer { cleanUp() }
    let audio = try audioFile()
    defer { try? FileManager.default.removeItem(at: audio) }
    try store.save(try record(id: "a", sceneID: try sceneID()), audio: audio)
    try store.save(try record(id: "b", sceneID: try sceneID()), audio: audio)
    try Data("{".utf8).write(to: directory.appending(path: "broken.json"))
    #expect(fileNames().count == 5)

    try store.deleteAll()
    #expect(fileNames().isEmpty)
    #expect(store.all().isEmpty)
    #expect(store.audioURL(of: "a") == nil)
    // 何も無いときに呼んでも失敗にしない
    try store.deleteAll()

    try store.save(try record(id: "c", sceneID: try sceneID()))
    #expect(store.all().map(\.id) == ["c"])
  }

  // MARK: - ラウンドからの保存（RoomSession）

  /// 自分の採点の結果が届くと、場面と自分の結果を 1 つ保存する。同じ結果がもう一度届いても増えない
  @Test func sessionSavesOwnResult() async throws {
    defer { cleanUp() }
    let sceneID = try sceneID(.eiken2)
    let session = session()
    let startsAt = Date(timeIntervalSince1970: 1_794_000_000)
    session.handle(.roundStarted(RoundInfo(sceneID: sceneID, startsAt: startsAt)))
    let results = results(sceneID: sceneID)
    session.handle(.results(results))
    await session.recordSaving?.value
    session.handle(.results(results))
    await session.recordSaving?.value

    let saved = store.all()
    #expect(saved.count == 1)
    let record = try #require(saved.first)
    #expect(record.playedAt == startsAt)
    #expect(record.difficulty == "eiken-2")
    #expect(try record.sceneLayout().id == sceneID)
    #expect(record.result.transcript == results.me?.transcript)
    #expect(record.result.score.total == results.me?.score?.total)
    #expect(record.result.feedback != nil)
    #expect(fileNames() == ["\(record.id).json"])
  }

  /// 次のラウンドは別の記録になる
  @Test func sessionSavesEachRound() async throws {
    defer { cleanUp() }
    let session = session()
    for difficulty in [SceneDifficulty.eiken3, .eikenPre2] {
      let sceneID = try sceneID(difficulty)
      session.handle(.roundStarted(RoundInfo(sceneID: sceneID, startsAt: Date())))
      session.handle(.results(results(sceneID: sceneID)))
      await session.recordSaving?.value
    }
    #expect(Set(store.all().compactMap(\.difficulty)) == ["eiken-3", "eiken-pre2"])
  }

  /// 採点に失敗したラウンド（自分の結果が無い）は残さない
  @Test func sessionSkipsUngraded() async throws {
    defer { cleanUp() }
    let sceneID = try sceneID()
    let session = session()
    session.handle(.roundStarted(RoundInfo(sceneID: sceneID, startsAt: Date())))
    session.handle(.results(results(sceneID: sceneID, graded: false)))
    await session.recordSaving?.value
    #expect(store.all().isEmpty)
    #expect(fileNames().isEmpty)
  }

  /// 講評が届かなくても、点があれば残す（feedback は null）
  @Test func sessionSavesWithoutFeedback() async throws {
    defer { cleanUp() }
    let sceneID = try sceneID()
    let full = results(sceneID: sceneID)
    let results = RoundResults(sceneID: full.sceneID, sceneName: full.sceneName, players: full.players, myReview: nil)
    let session = session()
    session.handle(.roundStarted(RoundInfo(sceneID: sceneID, startsAt: Date())))
    session.handle(.results(results))
    await session.recordSaving?.value
    let record = try #require(store.all().first)
    #expect(record.result.feedback == nil)
    #expect(record.results.myReview == nil)
  }

  /// 場面の配置が取れなかったラウンドは残さない（場面の無い記録は作らない）
  @Test func sessionSkipsWhenSceneIsMissing() async throws {
    defer { cleanUp() }
    let session = session()
    session.handle(.roundStarted(RoundInfo(sceneID: "gen-nothing", startsAt: Date())))
    session.handle(.results(results(sceneID: try sceneID()).renamed(sceneID: "gen-nothing")))
    await session.recordSaving?.value
    #expect(fileNames().isEmpty)
  }
}

extension RoundResults {
  /// 場面の ID だけを替えた結果
  fileprivate func renamed(sceneID: String) -> RoundResults {
    RoundResults(sceneID: sceneID, sceneName: sceneName, players: players, myReview: myReview)
  }
}
