import Foundation
import Testing

@testable import NG2622

/// BACKEND_URL から WebSocket の URL を作れるか
struct RoomSocketTests {
  @Test(arguments: [
    ("https://ng-2622-backend.example.workers.dev", "wss://ng-2622-backend.example.workers.dev/rooms/0427/ws"),
    ("http://localhost:8787", "ws://localhost:8787/rooms/0427/ws"),
    ("http://192.168.1.23:8787/", "ws://192.168.1.23:8787/rooms/0427/ws"),
    ("https://example.com/api", "wss://example.com/api/rooms/0427/ws"),
  ])
  func url(base: String, expected: String) throws {
    let url = RoomSocket.url(baseURL: try #require(URL(string: base)), roomID: "0427")
    #expect(url.absoluteString == expected)
  }
}

/// 知らない type や形の違うメッセージは、throw せずに nil になる（受信を続けられる）
struct RoomSocketDecodeTests {
  @Test(arguments: [
    #"{"type":"hello"}"#,
    #"{"type":"progress","round":1,"players":[{"id":"x","status":"sleeping"}]}"#,
    "not json",
  ])
  func unreadable(json: String) {
    #expect(RoomSocket.decode(Data(json.utf8)) == nil)
  }

  @Test func readable() {
    #expect(RoomSocket.decode(Data(#"{"type":"error","code":"not_host","message":"m"}"#.utf8)) != nil)
  }
}

/// 難易度の start は { type: "start", difficulty } だけを送る（sceneId は送らない）
struct StartByDifficultyTests {
  @Test(arguments: SceneDifficulty.allCases)
  func encodes(difficulty: SceneDifficulty) throws {
    let data = try JSONEncoder().encode(LiveGameClient.startMessage(difficulty: difficulty))
    let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: String])
    #expect(object == ["type": "start", "difficulty": difficulty.rawValue])
  }
}
