import Foundation
import Testing

@testable import NG2622

/// 苦手の場面で練習する部屋: 配置を覚えて取りに行かないこと、スタートで start の sceneId に場面の ID を入れること
@MainActor
struct WeakScenePracticeTests {
  /// 苦手の場面の部屋: 配置を覚えて（取りに行かない）、スタートで start の sceneId に場面の ID を入れて送る
  @Test func practiceRoomStartsWithSceneID() async throws {
    let scene = try WeakSceneTests.scene()
    let layouts = SceneLayoutStore(client: MockSceneLayoutClient())
    let client = StartLogClient()
    let session = RoomSession(
      client: client, me: PlayerProfile(name: "みか", color: 0x5B5BE6), records: .temporary(), scenes: layouts,
      practice: scene)
    #expect(session.practice == scene)
    #expect(layouts.remembered(scene.sceneId) != nil)
    #expect(try await layouts.layout(of: scene.sceneId) == scene.document().layout)

    try await session.create()
    session.startPractice()
    await client.waitForStart()
    #expect(client.started == [.scene(scene.sceneId)])
  }

  /// 苦手の場面のスタートを部屋に断られたら（置き場に場面が無い unknown_scene など）、苦手の場面を外して
  /// 難易度を選ぶふつうの待合に戻し、ホストに一言を出す。難易度でスタートしたら一言を消す。
  /// 苦手の場面のスタートを送っていないときの断りでは、何も変えない
  @Test func rejectedPracticeStartFallsBackToDifficulty() async throws {
    let scene = try WeakSceneTests.scene()
    let client = StartLogClient()
    let session = RoomSession(
      client: client, me: PlayerProfile(name: "みか", color: 0x5B5BE6), records: .temporary(),
      scenes: SceneLayoutStore(client: MockSceneLayoutClient()), practice: scene)
    try await session.create()

    session.handle(.rejected(code: "not_host", message: ""))
    #expect(session.practice == scene)
    #expect(session.practiceNotice == nil)

    session.startPractice()
    session.handle(.rejected(code: "unknown_scene", message: "シーンがありません"))
    #expect(session.practice == nil)
    #expect(session.practiceNotice == RoomSession.practiceRejectedText)
    #expect(session.phase == .lobby)

    session.start(difficulty: .eiken3)
    #expect(session.practiceNotice == nil)
    await client.waitForStart(count: 2)
    #expect(client.started.last == .difficulty(.eiken3))
    #expect(!GameEvent.rejected(code: "unknown_scene", message: "").changesPhase)
  }

  /// 置き場に無い場面（unknown_scene）で断られたら、端末に覚えた苦手の場面も忘れ、苦手の画面を開き直したら作り直す。
  /// ほかの断り（not_in_lobby など）と、別の場面の ID では忘れない
  @Test func unknownSceneForgetsTheSavedScene() async throws {
    let store = WeakSceneStore(directory: WeakPointStore.temporary().directory)
    defer { try? FileManager.default.removeItem(at: store.directory) }
    let scenes = StubSceneClient()
    let maker = WeakSceneMaker(client: scenes, store: store)
    let analysis = WeakSceneTests.analysis()
    maker.make(analysis: analysis, recent: WeakSceneTests.recent(), stage: 2)
    await maker.waitForPending()
    guard case .ready(let scene) = maker.phase else { Issue.record("できていない: \(maker.phase)"); return }

    func practiceRoom() async throws -> RoomSession {
      let session = RoomSession(
        client: StartLogClient(), me: PlayerProfile(name: "みか", color: 0x5B5BE6), records: .temporary(),
        scenes: SceneLayoutStore(client: MockSceneLayoutClient()), practice: scene, weakScenes: maker)
      try await session.create()
      session.startPractice()
      return session
    }

    // ほかの断り: ふつうの待合には戻すが、覚えた場面はそのまま
    let busy = try await practiceRoom()
    busy.handle(.rejected(code: "not_in_lobby", message: ""))
    #expect(busy.practice == nil)
    #expect(store.load()?.scene == scene)
    #expect(maker.phase == .ready(scene))
    // 別の場面の ID では忘れない
    maker.discard(sceneId: "weak-00000000-0000-0000-0000-000000000001")
    #expect(store.load()?.scene == scene)

    // 置き場に無い: 覚えた場面を忘れ、カードからも外す
    let missing = try await practiceRoom()
    missing.handle(.rejected(code: "unknown_scene", message: "シーンがありません"))
    #expect(missing.practice == nil)
    #expect(missing.practiceNotice == RoomSession.practiceRejectedText)
    #expect(store.load() == nil)
    #expect(maker.phase == .idle)

    // 苦手の画面を開き直したら（同じ区切り）、覚えた場面が無いので作り直す
    maker.reopen()
    maker.make(analysis: analysis, recent: WeakSceneTests.recent(), stage: 2)
    #expect(maker.phase == .making)
    await maker.waitForPending()
    guard case .ready = maker.phase else { Issue.record("作り直していない: \(maker.phase)"); return }
    #expect(await scenes.calls == 2)
    #expect(store.load()?.stage == 2)
  }

  /// 配置の読めない苦手の場面は持たない（ふつうの部屋になる）
  @Test func unreadablePracticeIsDropped() {
    let broken = WeakScene(
      sceneId: "weak-x", name: "x", difficulty: "eiken-3", focus: "reason", pitch: "", layout: .object([:]),
      createdParts: [])
    let session = RoomSession(
      client: StartLogClient(), me: PlayerProfile(name: "みか", color: 0x5B5BE6), records: .temporary(), practice: broken)
    #expect(session.practice == nil)
  }
}

/// スタートの口だけを控える GameClient
final class StartLogClient: GameClient {
  enum Start: Equatable {
    case scene(String?)
    case difficulty(SceneDifficulty)
  }

  private(set) var started: [Start] = []
  let events: AsyncStream<GameEvent>
  private let continuation: AsyncStream<GameEvent>.Continuation

  init() {
    (events, continuation) = AsyncStream.makeStream()
  }

  func createRoom(as player: PlayerProfile) async throws -> String { "1234" }
  func joinRoom(code: String, as player: PlayerProfile) async throws {}
  func leaveRoom() { continuation.finish() }
  func startRound(sceneID: String?) async throws { started.append(.scene(sceneID)) }
  func startRound(difficulty: SceneDifficulty) async throws { started.append(.difficulty(difficulty)) }
  func finishSpeaking(audio: RecordedAudio?) async throws {}
  func playAgain() async throws {}

  /// スタートが count 回呼ばれるまで待つ（startPractice・start は裏で送る）
  func waitForStart(count: Int = 1) async {
    for _ in 0..<1000 where started.count < count { await Task.yield() }
  }
}
