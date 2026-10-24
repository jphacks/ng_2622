import Foundation
import Testing

@testable import NG2622

/// 手元のバックエンドの URL。無ければ LiveGameClientIntegrationTests を飛ばす
nonisolated private let liveBackendURL = ProcessInfo.processInfo.environment["LIVE_BACKEND_URL"].flatMap(URL.init(string:))

/// 手元のバックエンド（cd backend && pnpm dev）に LiveGameClient を 2 つつなぎ、1 ラウンドを通す。
/// ふだんは飛ばす。URL を渡したときだけ動く（xcodebuild の前に TEST_RUNNER_ を付けた環境変数で渡す）:
///   TEST_RUNNER_LIVE_BACKEND_URL=http://localhost:8787 xcodebuild test -scheme "NG2622 Live" ...
@Suite(.enabled(if: liveBackendURL != nil), .timeLimit(.minutes(1)))
struct LiveGameClientIntegrationTests {

  /// 条件に合うできごとが来るまで読み進める
  func next(
    _ iterator: inout AsyncStream<GameEvent>.Iterator, where match: (GameEvent) -> Bool
  ) async throws -> GameEvent {
    while let event = await iterator.next(isolation: #isolation) {
      if match(event) { return event }
    }
    throw GameError.connectionFailed
  }

  @Test func roomNotFound() async throws {
    let client = LiveGameClient(baseURL: try #require(liveBackendURL))
    await #expect(throws: GameError.roomNotFound) {
      // 作っていない部屋（作られていたらこのテストは偶然落ちる）
      try await client.joinRoom(code: "0000", as: PlayerProfile(name: "けん", color: 0x2FAE9B))
    }
    client.leaveRoom()
  }

  @Test func playOneRound() async throws {
    let url = try #require(liveBackendURL)
    let host = LiveGameClient(baseURL: url)
    let guest = LiveGameClient(baseURL: url)
    var hostEvents = host.events.makeAsyncIterator()
    var guestEvents = guest.events.makeAsyncIterator()

    let code = try await host.createRoom(as: PlayerProfile(name: "はなこ", color: 0xF07AA8))
    try await guest.joinRoom(code: code, as: PlayerProfile(name: "たろう", color: 0x5B5BE6))
    let lobby = try await next(&hostEvents) { if case .room(let r) = $0 { r.members.count == 2 } else { false } }
    guard case .room(let room) = lobby else { return }
    #expect(room.code == code)
    #expect(room.members.map(\.isSelf) == [true, false])
    #expect(room.members.map(\.isHost) == [true, false])

    // 参加者の接続が切れても、welcome の ID と合言葉でつなぎ直して待合に戻ってくる
    guest.dropConnectionForTesting()
    _ = try await next(&hostEvents) { if case .room(let r) = $0 { r.members.last?.status == .offline } else { false } }
    _ = try await next(&hostEvents) { if case .room(let r) = $0 { r.members.last?.status == .connected } else { false } }

    try await host.startRound(sceneID: "park")
    let started = try await next(&guestEvents) { if case .roundStarted = $0 { true } else { false } }
    guard case .roundStarted(let info) = started else { return }
    #expect(info.sceneID == "park")

    // ホストは WAV を送り（POST の音声）、参加者は録れなかったことにする（skip）
    try await host.finishSpeaking(audio: try silentWAV())
    try await guest.finishSpeaking(audio: nil)
    let finished = try await next(&guestEvents) { if case .results = $0 { true } else { false } }
    guard case .results(let results) = finished else { return }
    #expect(results.players.count == 2)
    #expect(results.players.last?.score == nil)
    #expect(results.players.last?.isSelf == true)
    #expect(results.myReview == nil)

    try await host.playAgain()
    _ = try await next(&guestEvents) { if case .returnedToLobby = $0 { true } else { false } }

    // 参加者が抜けると、ホストの待合から消える
    guest.leaveRoom()
    _ = try await next(&hostEvents) { if case .room(let r) = $0 { r.members.count == 1 } else { false } }
    host.leaveRoom()
  }

  /// ラウンド中にホストが抜けると、残った参加者がホストになり、締め切りともう一度を押せる
  @Test func hostLeavesDuringRound() async throws {
    let url = try #require(liveBackendURL)
    let host = LiveGameClient(baseURL: url)
    let guest = LiveGameClient(baseURL: url)
    var guestEvents = guest.events.makeAsyncIterator()

    let code = try await host.createRoom(as: PlayerProfile(name: "はなこ", color: 0xF07AA8))
    try await guest.joinRoom(code: code, as: PlayerProfile(name: "たろう", color: 0x5B5BE6))
    try await host.startRound(sceneID: nil)
    _ = try await next(&guestEvents) { if case .roundStarted = $0 { true } else { false } }

    host.leaveRoom()
    let changed = try await next(&guestEvents) { if case .hostChanged = $0 { true } else { false } }
    #expect(changed == .hostChanged(isSelf: true))

    try await guest.closeRound()
    _ = try await next(&guestEvents) { if case .results = $0 { true } else { false } }
    try await guest.playAgain()
    let lobby = try await next(&guestEvents) { if case .returnedToLobby = $0 { true } else { false } }
    guard case .returnedToLobby(let room) = lobby else { return }
    #expect(room.members.map(\.isHost) == [true])
    #expect(room.members.first?.isSelf == true)
    guest.leaveRoom()
  }

  /// 無音 0.1 秒の WAV（16 kHz・16 bit・モノラル）
  func silentWAV() throws -> RecordedAudio {
    let samples = 1600
    var data = Data()
    func append(_ text: String) { data.append(contentsOf: Array(text.utf8)) }
    func append<T: FixedWidthInteger>(_ value: T) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
    append("RIFF"); append(UInt32(36 + samples * 2)); append("WAVE")
    append("fmt "); append(UInt32(16)); append(UInt16(1)); append(UInt16(1))
    append(UInt32(16_000)); append(UInt32(32_000)); append(UInt16(2)); append(UInt16(16))
    append("data"); append(UInt32(samples * 2))
    data.append(Data(count: samples * 2))
    let url = FileManager.default.temporaryDirectory.appending(path: "live-test-\(UUID().uuidString).wav")
    try data.write(to: url)
    return RecordedAudio(url: url, duration: 0.1)
  }
}
