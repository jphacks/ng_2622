import Foundation
import Testing

@testable import NG2622

/// ホログラムの映像がアプリに入り、待合の「ホログラム」で始められるか
struct HologramTests {
  /// assets/holograms の縄跳びが、映像つきで入っている（ビルドの「Copy hologram videos」で写す）
  @Test func bundled() {
    let info = HologramCatalog.info("jump_rope")
    #expect(info?.name == "縄跳び")
    #expect(HologramCatalog.videoURL(of: "jump_rope") != nil)
    #expect(HologramCatalog.isHologram("jump_rope"))
    #expect(!HologramCatalog.isHologram("park"))
  }

  /// ホログラムの場面は、待合のシーンの一覧には出ない。名前と正答例は引ける
  @Test func notInSceneList() {
    #expect(SceneCatalog.scene("jump_rope") == nil)
    #expect(SceneCatalog.name(of: "jump_rope") == "縄跳び")
    #expect(SceneCatalog.description(of: "jump_rope") != nil)
  }

  /// ホストが「ホログラム」で始めると、この端末は映像を反転して出す。ほかの選び方で始めると戻る
  @Test func startHologram() {
    let me = PlayerProfile(name: "たろう", color: 0x5B5BE6)
    let session = RoomSession(client: MockGameClient(options: .init()), me: me)
    let host = Participant(id: "me", name: "たろう", color: 0x5B5BE6, isSelf: true, isHost: true, status: .connected)
    session.handle(.room(RoomState(code: "0427", members: [host])))
    #expect(!session.isHologramDisplay)
    session.startHologram()
    #expect(session.isHologramDisplay)
    session.start(sceneID: "park")
    #expect(!session.isHologramDisplay)
  }
}
