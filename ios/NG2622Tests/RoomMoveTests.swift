import Foundation
import Testing

@testable import NG2622

/// 待合の「他のルーム」で別の部屋に移る手順（確かめの出し分け・入れてから抜ける順・入れないときに残る・抜けるのに失敗したとき）と、
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
    /// この部屋は無い（joinRoom が roomNotFound を投げる）
    var missing: Set<String> = []
    /// 満員の部屋（joinRoom が roomFull を投げる）
    var full: Set<String> = []
    /// 抜けるのに失敗する（leave を送れず、前の部屋の知らせが届き続ける）
    var leaveFails = false
    /// joinRoom の途中で呼ぶ（入っている途中に、前の部屋から知らせが届いたときを作る）
    var duringJoin: () -> Void = {}
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

    func joinRoom(code: String, as player: PlayerProfile) async throws {
      log.calls.append("\(name).join \(code)")
      duringJoin()
      if missing.contains(code) { throw GameError.roomNotFound }
      if full.contains(code) { throw GameError.roomFull }
    }

    func leaveRoom() {
      log.calls.append("\(name).leave")
      if !leaveFails { continuation.finish() }
    }

    /// 部屋から知らせが届く
    func send(_ event: GameEvent) {
      continuation.yield(event)
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

  /// コードがそろったら: 今いる部屋のコードは通信せずに sameRoom、ほかの人がいれば確かめ（切断中の人も数える）、
  /// 自分だけなら確かめずに移る
  @Test func stepForCode() async throws {
    let log = LogClient.Log()
    let (alone, _) = try await hosting(log)
    #expect(!alone.hasOthers)
    #expect(alone.step(for: "1111") == .sameRoom)
    #expect(alone.step(for: "4821") == .move)
    let (withFriend, _) = try await hosting(log, others: [member("f", isSelf: false, isHost: false)])
    #expect(withFriend.step(for: "4821") == .confirm)
    #expect(withFriend.step(for: "1111") == .sameRoom)
    let (withOffline, _) = try await hosting(log, others: [member("f", isSelf: false, isHost: false, status: .offline)])
    #expect(withOffline.step(for: "4821") == .confirm)
    #expect(!log.calls.contains { $0.contains("join") })
  }

  /// 移る先に入ってから、今の部屋を抜ける（先に確かめる通信はしない）
  @Test func joinsBeforeLeaving() async throws {
    let log = LogClient.Log()
    let (session, _) = try await hosting(log)
    let next = RoomSession(client: LogClient("new", log: log), me: me, records: .temporary())
    try await session.move(to: "4821", with: next)
    #expect(log.calls == ["old.create", "new.join 4821", "old.leave"])
    #expect(next.code == "4821")
  }

  /// 入れないときは今の部屋のまま（抜けない）。新しい方は後始末する。もう一度移れる
  @Test func failedJoinKeepsCurrentRoom() async throws {
    let log = LogClient.Log()
    let (session, _) = try await hosting(log)
    let missing = LogClient("missing", log: log)
    missing.missing = ["0000"]
    await #expect(throws: GameError.roomNotFound) {
      try await session.move(to: "0000", with: RoomSession(client: missing, me: me, records: .temporary()))
    }
    let full = LogClient("full", log: log)
    full.full = ["9999"]
    await #expect(throws: GameError.roomFull) {
      try await session.move(to: "9999", with: RoomSession(client: full, me: me, records: .temporary()))
    }
    #expect(!log.calls.contains("old.leave"))
    #expect(!session.isMoving)
    #expect(session.code == "1111")

    let next = RoomSession(client: LogClient("new", log: log), me: me, records: .temporary())
    try await session.move(to: "4821", with: next)
    #expect(
      log.calls == [
        "old.create", "missing.join 0000", "missing.leave", "full.join 9999", "full.leave", "new.join 4821", "old.leave",
      ])
  }

  /// 今いる部屋のコードは、通信せずに sameRoom を投げる
  @Test func sameRoomWithoutNetwork() async throws {
    let log = LogClient.Log()
    let (session, _) = try await hosting(log)
    let next = RoomSession(client: LogClient("new", log: log), me: me, records: .temporary())
    await #expect(throws: RoomSession.MoveError.sameRoom) { try await session.move(to: "1111", with: next) }
    #expect(log.calls == ["old.create"])
  }

  /// 入っている途中（一瞬 2 つの部屋にいる間）に前の部屋から届いた、場面が替わる知らせは受けない。参加者の知らせは受ける
  @Test func ignoresOldRoomPhaseWhileMoving() async throws {
    let log = LogClient.Log()
    let (session, _) = try await hosting(log)
    let newClient = LogClient("new", log: log)
    let info = RoundInfo(sceneID: "gen-abcdefghij", startsAt: Date(), room: "1111")
    newClient.duringJoin = {
      session.handle(.generating(RoomState(code: "1111", members: [self.member("me", isSelf: true, isHost: true)])))
      session.handle(.roundStarted(info))
      session.handle(.participantsChanged([self.member("me", isSelf: true, isHost: true), self.member("f", isSelf: false, isHost: false)]))
    }
    let next = RoomSession(client: newClient, me: me, records: .temporary())
    try await session.move(to: "4821", with: next)
    #expect(session.phase == .lobby)
    #expect(!session.isGenerating)
    #expect(session.participants.count == 2)
  }

  /// 入れたあとに今の部屋を抜けるのに失敗しても（leave を送れない）、移った先で進める。前の部屋の知らせはもう受けない
  @Test func leaveFailureStillMoves() async throws {
    let log = LogClient.Log()
    let (session, oldClient) = try await hosting(log)
    oldClient.leaveFails = true
    let next = RoomSession(client: LogClient("new", log: log), me: me, records: .temporary())
    try await session.move(to: "4821", with: next)
    #expect(next.code == "4821")
    oldClient.send(.roundStarted(RoundInfo(sceneID: "gen-abcdefghij", startsAt: Date(), room: "1111")))
    for _ in 0..<5 { await Task.yield() }
    #expect(session.phase == .lobby)
    #expect(next.phase == .lobby)
  }

  /// 入れなかった理由。部屋が無いと分かったときだけ「部屋が見つかりません」で、通信の失敗は「つながりませんでした」
  @Test func failureMessages() {
    #expect(JoinRoomSheet.message(for: GameError.roomNotFound) == "部屋が見つかりません")
    #expect(JoinRoomSheet.message(for: RoomSession.MoveError.sameRoom) == "いまいる部屋です")
    #expect(JoinRoomSheet.message(for: GameError.roomFull) == "満員で入れません")
    #expect(JoinRoomSheet.message(for: GameError.alreadyStarted) == "ゲーム中で入れません")
    #expect(JoinRoomSheet.message(for: GameError.connectionFailed) == "つながりませんでした")
    #expect(JoinRoomSheet.message(for: URLError(.notConnectedToInternet)) == "つながりませんでした")
    #expect(JoinRoomSheet.message(for: RoomSession.MoveError.sheetClosed) == "もう一度打ってください")
  }

  /// 部屋の画面は、今の場面がプレイならプレイから始める（移った直後に始まっていたラウンドで待合を挟まない）
  @Test func roomViewStartsWithRound() {
    let info = RoundInfo(sceneID: "gen-abcdefghij", startsAt: Date(), room: "4821")
    #expect(RoomView.showsRound(.playing(info)))
    #expect(!RoomView.showsRound(.lobby))
    #expect(!RoomView.showsRound(.waiting(enteredAt: Date())))
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
    #expect(results.filter { $0 }.count == 1)
    #expect(log.calls.filter { $0.hasSuffix(".join 4821") }.count == 1)
    #expect(log.calls.filter { $0 == "old.leave" }.count == 1)
    await #expect(throws: RoomSession.MoveError.alreadyMoving) { try await session.move(to: "4821", with: second) }
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

  /// 設定で打ち替えた名前と色。名前は前後の空白を除き、空なら前の名前のまま
  @Test func editedProfile() {
    let mika = PlayerProfile(name: "Mika", color: PlayerProfile.colors[0])
    #expect(mika.edited(name: " Ken ", color: PlayerProfile.colors[3]) == PlayerProfile(name: "Ken", color: PlayerProfile.colors[3]))
    #expect(mika.edited(name: "   ", color: PlayerProfile.colors[2]) == PlayerProfile(name: "Mika", color: PlayerProfile.colors[2]))
  }

  /// 打っている名前は、上限の 10 文字で切る
  @Test func nameIsLimited() {
    #expect(PlayerProfile.limited("abcdefghijklmn") == "abcdefghij")
    #expect(PlayerProfile.limited("たろう") == "たろう")
  }
}

/// 「他のルーム」のシートの番号
struct OtherRoomFlowTests {
  /// いま開いているシートからの「移る」だけを受け付ける
  @Test func acceptsOnlyOpenSheet() {
    var flow = OtherRoomFlow()
    #expect(!flow.accepts(flow.ticket))
    flow.open()
    #expect(flow.accepts(flow.ticket))
    flow.close()
    #expect(!flow.accepts(flow.ticket))
  }

  /// 閉じる → 開き直す → 前のシートの「移る」が届く、の順でも、前のシートからは移らない。今のシートからは移れる
  @Test func oldSheetAfterReopenIsIgnored() {
    var flow = OtherRoomFlow()
    flow.open()
    let old = flow.ticket
    flow.close()
    flow.open()
    #expect(!flow.accepts(old))
    #expect(flow.accepts(flow.ticket))
  }
}
