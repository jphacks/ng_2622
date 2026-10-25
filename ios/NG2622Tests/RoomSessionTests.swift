import Foundation
import Testing

@testable import NG2622

/// RoomSession がホストの交代に合わせて isHost を決め直すか（スタート・締め切り・もう一度のボタンが出るか）
struct RoomSessionTests {
  let me = PlayerProfile(name: "たろう", color: 0x5B5BE6)

  func member(_ id: String, isSelf: Bool, isHost: Bool, status: Participant.Status = .connected) -> Participant {
    Participant(id: id, name: id, color: 0x5B5BE6, isSelf: isSelf, isHost: isHost, status: status)
  }

  func session() -> RoomSession {
    RoomSession(client: MockGameClient(options: .init()), me: me)
  }

  /// 待合でホストが抜けた room が届くと、残った自分がホストになる
  @Test func lobby() {
    let session = session()
    session.handle(.room(RoomState(code: "0427", members: [member("h", isSelf: false, isHost: true), member("me", isSelf: true, isHost: false)])))
    #expect(!session.isHost)
    session.handle(.room(RoomState(code: "0427", members: [member("me", isSelf: true, isHost: true)])))
    #expect(session.isHost)
  }

  /// ラウンド中は progress（participantsChanged）か hostChanged で、結果発表は hostChanged で替わる
  @Test func duringRound() {
    let session = session()
    session.handle(.room(RoomState(code: "0427", members: [member("h", isSelf: false, isHost: true), member("me", isSelf: true, isHost: false)])))
    session.handle(.participantsChanged([member("me", isSelf: true, isHost: true, status: .grading)]))
    #expect(session.isHost)
    session.handle(.hostChanged(isSelf: false))
    #expect(!session.isHost)
    session.handle(.hostChanged(isSelf: true))
    #expect(session.isHost)
  }

  /// 場面を作っている間は isGenerating で、ホストはもう一度スタートできない。round が届くと終わる
  @Test func generating() {
    let session = session()
    session.handle(.room(RoomState(code: "0427", members: [member("me", isSelf: true, isHost: true)])))
    session.handle(.generating(RoomState(code: "0427", members: [member("me", isSelf: true, isHost: true)])))
    #expect(session.isGenerating)
    #expect(session.phase == .lobby)
    let info = RoundInfo(sceneID: "gen-abcdefghij", startsAt: Date(), room: "0427")
    session.handle(.roundStarted(info))
    #expect(!session.isGenerating)
    #expect(session.phase == .playing(info))
  }

  /// もう一度で待合に戻ったときも、届いた members に合わせる
  @Test func returnedToLobby() {
    let session = session()
    session.handle(.returnedToLobby(RoomState(code: "0427", members: [member("me", isSelf: true, isHost: true)])))
    #expect(session.isHost)
  }
}
