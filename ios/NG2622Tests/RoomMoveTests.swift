import Foundation
import Testing

@testable import NG2622

/// 待合の「他のルーム」で別の部屋に移る手順（確かめの出し分け・入れるかの確かめ・抜けてから入る順）と、
/// 初めて開いたときに名前を決める画面を出すか
struct RoomMoveTests {
  let me = PlayerProfile(name: "たろう", color: 0x5B5BE6)

  /// 呼ばれた口を順に書き留める GameClient
  final class LogClient: GameClient {
    final class Log {
      var calls: [String] = []
    }

    let name: String
    let log: Log
    /// この部屋は無い（findRoom・joinRoom が roomNotFound を投げる）
    var missing: Set<String> = []
    /// 確かめのあとで入れなくなった部屋（joinRoom だけが roomFull を投げる）
    var fullOnJoin: Set<String> = []
    let events: AsyncStream<GameEvent>
    private let continuation: AsyncStream<GameEvent>.Continuation

    init(_ name: String, log: Log) {
      self.name = name
      self.log = log
      (events, continuation) = AsyncStream.makeStream()
    }

    func createRoom(as player: PlayerProfile) async throws -> String {
      log.calls.append("\(name).create")
      return "1111"
    }

    func findRoom(code: String) async throws {
      log.calls.append("\(name).find \(code)")
      if missing.contains(code) { throw GameError.roomNotFound }
    }

    func joinRoom(code: String, as player: PlayerProfile) async throws {
      log.calls.append("\(name).join \(code)")
      if missing.contains(code) { throw GameError.roomNotFound }
      if fullOnJoin.contains(code) { throw GameError.roomFull }
    }

    func leaveRoom() {
      log.calls.append("\(name).leave")
      continuation.finish()
    }

    func startRound(sceneID: String?) async throws {}
    func startRound(difficulty: SceneDifficulty) async throws {}
    func finishSpeaking(audio: RecordedAudio?) async throws {}
    func playAgain() async throws {}
  }

  func member(_ id: String, isSelf: Bool, isHost: Bool, status: Participant.Status = .connected) -> Participant {
    Participant(id: id, name: id, color: 0x5B5BE6, isSelf: isSelf, isHost: isHost, status: status)
  }

  /// 投げずに終わったか
  func succeeded(_ body: () async throws -> Void) async -> Bool {
    do {
      try await body()
      return true
    } catch {
      return false
    }
  }

  /// 自分の部屋 1111 を作ったところの session（とその client）
  func hosting(_ log: LogClient.Log, others: [Participant] = []) async throws -> (RoomSession, LogClient) {
    let client = LogClient("old", log: log)
    let session = RoomSession(client: client, me: me, records: .temporary())
    _ = try await session.create()
    session.handle(.room(RoomState(code: "1111", members: [member("me", isSelf: true, isHost: true)] + others)))
    return (session, client)
  }

  /// ほかの人がいれば確かめる（切断中の人も数える）。自分だけなら確かめない
  @Test func confirmsOnlyWithOthers() async throws {
    let log = LogClient.Log()
    let (alone, _) = try await hosting(log)
    #expect(!alone.hasOthers)
    let (withFriend, _) = try await hosting(log, others: [member("f", isSelf: false, isHost: false)])
    #expect(withFriend.hasOthers)
    let (withOffline, _) = try await hosting(log, others: [member("f", isSelf: false, isHost: false, status: .offline)])
    #expect(withOffline.hasOthers)
  }

  /// 移る先を確かめてから、今の部屋を抜け、それから入る
  @Test func leavesBeforeJoining() async throws {
    let log = LogClient.Log()
    let (session, _) = try await hosting(log)
    try await session.checkMove(to: "4821")
    let next = RoomSession(client: LogClient("new", log: log), me: me, records: .temporary())
    try await session.move(to: "4821", with: next)
    #expect(log.calls == ["old.create", "old.find 4821", "old.leave", "new.join 4821"])
    #expect(next.code == "4821")
  }

  /// 無い部屋・いまいる部屋のコードは、確かめで止まり、今の部屋は抜けない
  @Test func checkKeepsCurrentRoom() async throws {
    let log = LogClient.Log()
    let (session, client) = try await hosting(log)
    client.missing = ["0000"]
    await #expect(throws: GameError.roomNotFound) { try await session.checkMove(to: "0000") }
    await #expect(throws: RoomSession.MoveError.sameRoom) { try await session.checkMove(to: "1111") }
    #expect(!log.calls.contains("old.leave"))
  }

  /// 入れなかった理由。部屋が無いと分かったときだけ「部屋が見つかりません」で、通信の失敗は「つながりませんでした」
  @Test func failureMessages() {
    #expect(JoinRoomSheet.message(for: GameError.roomNotFound) == "部屋が見つかりません")
    #expect(JoinRoomSheet.message(for: RoomSession.MoveError.sameRoom) == "いまいる部屋です")
    #expect(JoinRoomSheet.message(for: GameError.roomFull) == "満員で入れません")
    #expect(JoinRoomSheet.message(for: GameError.connectionFailed) == "つながりませんでした")
    #expect(JoinRoomSheet.message(for: URLError(.notConnectedToInternet)) == "つながりませんでした")
    #expect(JoinRoomSheet.notice(for: GameError.roomFull) == "入れませんでした（満員）")
    #expect(JoinRoomSheet.notice(for: URLError(.timedOut)) == "入れませんでした（つながらない）")
  }

  /// 移っている途中にもう一度 move を呼んでも、2 つ目の部屋には入らない（幽霊の参加者を残さない）
  @Test func moveOnlyOnce() async throws {
    let log = LogClient.Log()
    let (session, _) = try await hosting(log)
    let first = RoomSession(client: LogClient("new", log: log), me: me, records: .temporary())
    let second = RoomSession(client: LogClient("dup", log: log), me: me, records: .temporary())
    async let a = succeeded { try await session.move(to: "4821", with: first) }
    async let b = succeeded { try await session.move(to: "4821", with: second) }
    let results = await [a, b]
    #expect(session.isMoving)
    #expect(results.filter { $0 }.count == 1)
    #expect(log.calls.filter { $0.hasSuffix(".join 4821") }.count == 1)
    #expect(log.calls.filter { $0 == "old.leave" }.count == 1)
    await #expect(throws: RoomSession.MoveError.alreadyMoving) { try await session.move(to: "4821", with: second) }
  }

  /// 確かめたあとで入れなくなっていたら、新しい方も抜けて投げる（今の部屋には戻らない）
  @Test func joinFailsAfterLeaving() async throws {
    let log = LogClient.Log()
    let (session, _) = try await hosting(log)
    let nextClient = LogClient("new", log: log)
    nextClient.fullOnJoin = ["4821"]
    let next = RoomSession(client: nextClient, me: me, records: .temporary())
    await #expect(throws: GameError.roomFull) { try await session.move(to: "4821", with: next) }
    #expect(log.calls == ["old.create", "old.leave", "new.join 4821", "new.leave"])
  }

  /// 名前を保存していないとき（初めて開いた）と、空白だけのときは、最初の画面を出す
  @Test func firstScreenWithoutName() throws {
    let suite = "test.profile.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    #expect(PlayerProfile.load(from: defaults).needsName)
    PlayerProfile(name: "  ", color: PlayerProfile.colors[2]).save(to: defaults)
    #expect(PlayerProfile.load(from: defaults).needsName)
    PlayerProfile.first(name: " Mika ", color: PlayerProfile.colors[2]).save(to: defaults)
    let loaded = PlayerProfile.load(from: defaults)
    #expect(!loaded.needsName)
    #expect(loaded == PlayerProfile(name: "Mika", color: PlayerProfile.colors[2]))
  }

  /// 最初の画面で決めた名前の色は、選べる色のどれか
  @Test func firstColorIsFromPalette() {
    for _ in 0..<20 {
      #expect(PlayerProfile.colors.contains(PlayerProfile.first(name: "Mika").color))
    }
  }

  /// 打っている名前は、上限の 10 文字で切る
  @Test func nameIsLimited() {
    #expect(PlayerProfile.limited("abcdefghijklmn") == "abcdefghij")
    #expect(PlayerProfile.limited("たろう") == "たろう")
  }
}

/// 「他のルーム」のシート・確かめの順番
struct OtherRoomFlowTests {
  /// 確かめている途中に下に引いて閉じると、あとで届いた確かめの結果は受け取らず、
  /// 次に開いて何もせず閉じても移らない
  @Test func lateFoundAfterSwipeIsIgnored() {
    var flow = OtherRoomFlow()
    flow.open()
    flow.close()
    #expect(flow.sheetDismissed(hasOthers: false) == nil)
    flow.found("4821", ticket: flow.ticket)
    #expect(flow.found == nil)
    flow.open()
    flow.close()
    #expect(flow.sheetDismissed(hasOthers: false) == nil)
    #expect(flow.confirming == nil)
  }

  /// 確かめ中に閉じてすぐ開き直したあとで、前のシートの結果が届いても受け取らない（開いたシートは閉じない）。
  /// 今のシートの結果は受け取る
  @Test func lateFoundAfterReopenIsIgnored() {
    var flow = OtherRoomFlow()
    flow.open()
    let old = flow.ticket
    flow.close()
    #expect(flow.sheetDismissed(hasOthers: false) == nil)
    flow.open()
    flow.found("4821", ticket: old)
    #expect(flow.sheetOpen)
    #expect(flow.found == nil)
    flow.close()
    #expect(flow.sheetDismissed(hasOthers: false) == nil)

    flow.open()
    flow.found("5300", ticket: flow.ticket)
    #expect(!flow.sheetOpen)
    #expect(flow.sheetDismissed(hasOthers: false) == "5300")
  }

  /// 開くと、前に残っていたコードは捨てる
  @Test func openClearsFound() {
    var flow = OtherRoomFlow()
    flow.open()
    flow.found("4821", ticket: flow.ticket)
    flow.open()
    #expect(flow.found == nil)
  }

  /// 自分しかいなければ確かめずに移る。ほかの人がいれば確かめ、「入る」は 1 度だけ移る先を返す
  @Test func confirmOnlyWithOthers() {
    var alone = OtherRoomFlow()
    alone.open()
    alone.found("4821", ticket: alone.ticket)
    #expect(!alone.sheetOpen)
    #expect(alone.sheetDismissed(hasOthers: false) == "4821")
    #expect(alone.confirming == nil)

    var withOthers = OtherRoomFlow()
    withOthers.open()
    withOthers.found("4821", ticket: withOthers.ticket)
    #expect(withOthers.sheetDismissed(hasOthers: true) == nil)
    #expect(withOthers.confirming == "4821")
    #expect(withOthers.confirm() == "4821")
    #expect(withOthers.confirm() == nil)

    var cancelled = OtherRoomFlow()
    cancelled.open()
    cancelled.found("4821", ticket: cancelled.ticket)
    _ = cancelled.sheetDismissed(hasOthers: true)
    cancelled.cancel()
    #expect(cancelled.confirm() == nil)
  }
}
