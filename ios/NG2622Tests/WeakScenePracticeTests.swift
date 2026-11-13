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
