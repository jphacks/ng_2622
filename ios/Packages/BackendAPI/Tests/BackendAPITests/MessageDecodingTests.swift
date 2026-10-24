import BackendAPI
import Foundation
import Testing

/// WebSocket で部屋から届くメッセージ（ServerMessage）が、openapi.json から作った型で読めるか
struct MessageDecodingTests {
  let playerID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"

  func decode(_ json: String) throws -> Components.Schemas.ServerMessage {
    try JSONDecoder().decode(Components.Schemas.ServerMessage.self, from: Data(json.utf8))
  }

  @Test func room() throws {
    let message = try decode(
      #"{"type":"room","roomId":"0427","phase":"lobby","hostId":"\#(playerID)","maxPlayers":5,"players":[{"id":"\#(playerID)","name":"はなこ","color":5987302,"isHost":true,"connected":true}]}"#
    )
    guard case .room(let room) = message else { Issue.record("room でない: \(message)"); return }
    #expect(room.roomId == "0427")
    #expect(room.phase == .lobby)
    #expect(room.players.first?.name == "はなこ")
  }

  @Test func round() throws {
    let message = try decode(#"{"type":"round","round":1,"sceneId":"park","startAt":1792800000000}"#)
    guard case .round(let round) = message else { Issue.record("round でない: \(message)"); return }
    #expect(round.sceneId == "park")
    #expect(round.startAt == 1_792_800_000_000)
  }

  @Test func progress() throws {
    let message = try decode(#"{"type":"progress","round":1,"players":[{"id":"\#(playerID)","status":"grading"}]}"#)
    guard case .progress(let progress) = message else { Issue.record("progress でない: \(message)"); return }
    #expect(progress.players.first?.status == .grading)
  }

  @Test func welcome() throws {
    let message = try decode(#"{"type":"welcome","playerId":"\#(playerID)","token":"t","isHost":false}"#)
    guard case .welcome(let welcome) = message else { Issue.record("welcome でない: \(message)"); return }
    #expect(welcome.playerId == playerID)
    #expect(!welcome.isHost)
  }

  @Test func error() throws {
    let message = try decode(#"{"type":"error","code":"room_full","message":"満員"}"#)
    guard case .error(let error) = message else { Issue.record("error でない: \(message)"); return }
    #expect(error.code == .roomFull)
  }

  /// 採点できた人は rank と score があり、できなかった人は null（キーが無くても読める）
  @Test(arguments: [
    (#""rank":1,"score":{"content":80,"expression":70,"speech":90,"total":80},"#, true),
    (#""rank":null,"score":null,"#, false),
    ("", false),
  ])
  func results(fields: String, graded: Bool) throws {
    let message = try decode(
      #"{"type":"results","round":1,"sceneId":"park","sceneName":"公園","players":[{"id":"\#(playerID)","name":"はなこ","color":5987302,\#(fields)"transcript":"","comment":"","modelAnswer":""}]}"#
    )
    guard case .results(let results) = message, let player = results.players.first else {
      Issue.record("results でない: \(message)")
      return
    }
    if graded {
      #expect(player.rank == 1)
      #expect(player.score?.value1.total == 80)
    } else {
      #expect(player.rank == nil)
      #expect(player.score == nil)
    }
  }

  /// iPhone から送る join は、type と name だけの JSON になる
  @Test func encodeJoin() throws {
    let join = Components.Schemas.ClientMessage.join(.init(_type: .join, name: "はなこ"))
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    #expect(String(decoding: try encoder.encode(join), as: UTF8.self) == #"{"name":"はなこ","type":"join"}"#)
  }

  /// 音声を送らずにラウンドを終える skip は、type と round の JSON になる
  @Test func encodeSkip() throws {
    let skip = Components.Schemas.ClientMessage.skip(.init(_type: .skip, round: 1))
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    #expect(String(decoding: try encoder.encode(skip), as: UTF8.self) == #"{"round":1,"type":"skip"}"#)
    // 部屋の側と同じく、JSON から ClientMessage として読み直せる
    let decoded = try JSONDecoder().decode(Components.Schemas.ClientMessage.self, from: Data(#"{"type":"skip","round":1}"#.utf8))
    #expect(decoded == skip)
  }
}
