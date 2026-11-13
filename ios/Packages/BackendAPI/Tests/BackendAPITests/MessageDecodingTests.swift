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
      #"{"type":"results","round":1,"sceneId":"temp-eiken-3-park","sceneName":"公園","players":[{"id":"\#(playerID)","name":"はなこ","color":5987302,\#(fields)"transcript":"","content":null,"feedback":null}]}"#
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

  /// 内容の内訳（描写の判定・項目の達成・言えたと正しさ）と、講評（次の一つ・言い直し・話し方の一言）が読める
  @Test func resultsWithContent() throws {
    let content =
      #"{"claims":[{"quote":"A dog is sleeping.","verdict":"correct","item":"dog","level":"partial","note":null},"#
      + #"{"quote":"A cat.","verdict":"absent","item":null,"level":null,"note":"猫はいません"}],"#
      + #""items":[{"id":"dog","kind":"center","label":"犬","level":"partial"}],"others":0,"#
      + #""recall":{"earned":1,"max":2},"precision":{"correct":1,"said":2}}"#
    let feedback =
      #"{"nextStep":{"kind":"content","text":"t","item":"dog","gain":4},"rewrite":null,"speechTip":{"aspect":"prosody","text":"s"},"#
      + #""expressionBasis":"Uses the present continuous correctly."}"#
    let message = try decode(
      #"{"type":"results","round":1,"sceneId":"temp-eiken-3-park","sceneName":"公園","players":[{"id":"\#(playerID)","name":"はなこ","color":5987302,"rank":1,"score":{"content":50,"expression":60,"speech":70,"total":58},"transcript":"A dog is sleeping. A cat.","content":\#(content),"feedback":\#(feedback)}]}"#
    )
    guard case .results(let results) = message, let player = results.players.first,
      let breakdown = player.content?.value1, let review = player.feedback?.value1
    else {
      Issue.record("results の内訳が読めない: \(message)")
      return
    }
    #expect(breakdown.claims.map(\.verdict.rawValue) == ["correct", "absent"])
    #expect(breakdown.claims.first?.level?.rawValue == "partial")
    #expect(breakdown.claims.last?.level == nil)
    #expect(breakdown.items.first?.kind == .center)
    #expect(breakdown.recall.earned == 1)
    #expect(breakdown.precision.said == 2)
    #expect(review.nextStep.gain == 4)
    #expect(review.speechTip.aspect.rawValue == "prosody")
    // 表現の点の根拠（画面には出さず、記録と苦手の分析に使う）
    #expect(review.expressionBasis == "Uses the present continuous correctly.")
  }

  /// 根拠が無い回（3 語未満・呼び直しても空・固定の点数のモード）は null で届き、nil で読める
  @Test func resultsWithNullExpressionBasis() throws {
    let feedback =
      #"{"nextStep":{"kind":"content","text":"t","item":null,"gain":null},"rewrite":null,"speechTip":{"aspect":"accuracy","text":"s"},"#
      + #""expressionBasis":null}"#
    let message = try decode(
      #"{"type":"results","round":1,"sceneId":"temp-eiken-3-park","sceneName":"公園","players":[{"id":"\#(playerID)","name":"はなこ","color":5987302,"rank":1,"score":{"content":0,"expression":0,"speech":40,"total":10},"transcript":"A dog.","content":null,"feedback":\#(feedback)}]}"#
    )
    guard case .results(let results) = message, let review = results.players.first?.feedback?.value1 else {
      Issue.record("results の講評が読めない: \(message)")
      return
    }
    #expect(review.expressionBasis == nil)
  }

  /// 講評に知らない欄があると、results ごと読めない（openapi.json の additionalProperties: false）。
  /// 欄を足すと、足す前のビルドのアプリは結果の画面に進めなくなる（2026-11-12 に受け入れた。互換の切れ目は docs/design/usecase.md の
  /// 「採点のときに Claude が返す形」の表現の点の根拠の項）
  @Test func resultsWithUnknownFeedbackField() throws {
    let known =
      #"{"nextStep":{"kind":"expression","text":"t","item":null,"gain":null},"rewrite":null,"speechTip":{"aspect":"prosody","text":"s"},"#
      + #""expressionBasis":"b""#
    let results = { (feedback: String) in
      #"{"type":"results","round":1,"sceneId":"temp-eiken-3-park","sceneName":"公園","players":[{"id":"\#(self.playerID)","name":"はなこ","color":5987302,"rank":1,"score":{"content":50,"expression":60,"speech":70,"total":58},"transcript":"A dog.","content":null,"feedback":\#(feedback)}]}"#
    }
    // 対照: 知らない欄を除いた同じ JSON は読める
    _ = try decode(results(known + "}"))
    #expect(throws: (any Error).self) {
      try decode(results(known + #","newField":"x"}"#))
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
