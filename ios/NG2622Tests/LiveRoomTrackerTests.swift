import BackendAPI
import Foundation
import Testing

@testable import NG2622

/// 部屋から届くメッセージ（JSON）を LiveRoomTracker に通し、画面に渡すできごとになるか
struct LiveRoomTrackerTests {
  let me = "00000000-0000-4000-8000-000000000001"
  let host = "00000000-0000-4000-8000-000000000002"
  let other = "00000000-0000-4000-8000-000000000003"

  func message(_ json: String) throws -> Components.Schemas.ServerMessage {
    try JSONDecoder().decode(Components.Schemas.ServerMessage.self, from: Data(json.utf8))
  }

  func room(_ phase: String, connected: Bool = true) -> String {
    #"{"type":"room","roomId":"0427","phase":"\#(phase)","hostId":"\#(host)","maxPlayers":5,"players":["#
      + #"{"id":"\#(host)","name":"はなこ","color":15760040,"isHost":true,"connected":true},"#
      + #"{"id":"\#(me)","name":"たろう","color":5987302,"isHost":false,"connected":true},"#
      + #"{"id":"\#(other)","name":"けん","color":3124891,"isHost":false,"connected":\#(connected)}]}"#
  }

  /// welcome を受け、自分が入った待合の room まで進めたもの
  func joined() throws -> LiveRoomTracker {
    var tracker = LiveRoomTracker()
    _ = tracker.apply(try message(#"{"type":"welcome","playerId":"\#(me)","token":"t0k","isHost":false}"#))
    _ = tracker.apply(try message(room("lobby")))
    return tracker
  }

  @Test func welcome() throws {
    var tracker = LiveRoomTracker()
    let updates = tracker.apply(try message(#"{"type":"welcome","playerId":"\#(me)","token":"t0k","isHost":true}"#))
    #expect(updates == [.welcome(playerID: me, token: "t0k", isHost: true)])
    #expect(tracker.selfID == me)
  }

  /// 待合の room は参加者の一覧になる。自分・ホスト・切断中が分かる
  @Test func lobbyRoom() throws {
    var tracker = LiveRoomTracker()
    _ = tracker.apply(try message(#"{"type":"welcome","playerId":"\#(me)","token":"t0k","isHost":false}"#))
    let updates = tracker.apply(try message(room("lobby", connected: false)))
    let members = [
      Participant(id: host, name: "はなこ", color: 0xF07AA8, isSelf: false, isHost: true, status: .connected),
      Participant(id: me, name: "たろう", color: 0x5B5BE6, isSelf: true, isHost: false, status: .connected),
      Participant(id: other, name: "けん", color: 0x2FAE9B, isSelf: false, isHost: false, status: .offline),
    ]
    #expect(updates == [.event(.room(RoomState(code: "0427", members: members)))])
    #expect(tracker.roomID == "0427")
  }

  /// round の startAt（UNIX 時刻のミリ秒）が Date になる。つなぎ直して届く同じ round は渡さない
  @Test func round() throws {
    var tracker = try joined()
    tracker.now = { Date(timeIntervalSince1970: 1_792_800_000) }
    #expect(tracker.apply(try message(room("playing"))) == [])
    let json = #"{"type":"round","round":1,"sceneId":"park","startAt":1792800000500}"#
    let start = Date(timeIntervalSince1970: 1_792_800_000.5)
    #expect(tracker.apply(try message(json)) == [.event(.roundStarted(RoundInfo(sceneID: "park", startsAt: start)))])
    #expect(tracker.round == 1)
    #expect(tracker.apply(try message(json)) == [])
  }

  /// 端末の時計が大きくずれていたら（startAt が受け取った時刻から 5 秒より離れていたら）、受け取ってから 1.5 秒後に始める
  @Test func roundWithClockSkew() throws {
    let received = Date(timeIntervalSince1970: 1_792_800_060)
    // 端末の時計が 60 秒進んでいる: startAt は端末から見て 58.5 秒前
    #expect(LiveRoomTracker.startDate(fromMilliseconds: 1_792_800_001_500, receivedAt: received) == received + 1.5)
    // 端末の時計が 60 秒遅れている
    let late = Date(timeIntervalSince1970: 1_792_799_940)
    #expect(LiveRoomTracker.startDate(fromMilliseconds: 1_792_800_001_500, receivedAt: late) == late + 1.5)
    // ずれが小さければ startAt のまま（全員でそろえる）
    let near = Date(timeIntervalSince1970: 1_792_800_002)
    #expect(
      LiveRoomTracker.startDate(fromMilliseconds: 1_792_800_001_500, receivedAt: near)
        == Date(timeIntervalSince1970: 1_792_800_001.5))
  }

  /// progress は room の名前と色を付けた参加者の一覧になる。ほかのラウンドの progress は捨てる
  @Test func progress() throws {
    var tracker = try joined()
    _ = tracker.apply(try message(#"{"type":"round","round":2,"sceneId":"park","startAt":0}"#))
    let updates = tracker.apply(
      try message(
        #"{"type":"progress","round":2,"players":[{"id":"\#(host)","status":"done"},{"id":"\#(me)","status":"grading"},{"id":"\#(other)","status":"offline"}]}"#
      ))
    let list = [
      Participant(id: host, name: "はなこ", color: 0xF07AA8, isSelf: false, isHost: true, status: .done),
      Participant(id: me, name: "たろう", color: 0x5B5BE6, isSelf: true, isHost: false, status: .grading),
      Participant(id: other, name: "けん", color: 0x2FAE9B, isSelf: false, isHost: false, status: .offline),
    ]
    #expect(updates == [.event(.participantsChanged(list))])
    #expect(tracker.apply(try message(#"{"type":"progress","round":1,"players":[]}"#)) == [])
  }

  /// 順位の順に並べ、採点できなかった人は score を nil にして最後に置く。自分の講評は myReview に入る
  @Test func results() throws {
    var tracker = try joined()
    _ = tracker.apply(try message(#"{"type":"round","round":1,"sceneId":"park","startAt":0}"#))
    let json =
      #"{"type":"results","round":1,"sceneId":"park","sceneName":"公園","players":["#
      + #"{"id":"\#(other)","name":"けん","color":3124891,"rank":null,"score":null,"transcript":"","comment":"","feedback":null},"#
      + #"{"id":"\#(me)","name":"たろう","color":5987302,"rank":2,"score":{"content":60,"expression":50,"speech":70,"total":60},"transcript":"A dog.","comment":"短い","feedback":{"strength":{"quote":"A dog.","text":"短い"},"nextStep":{"kind":"content","gain":10,"text":"ボールのことも言ってみよう"},"rewrite":{"before":"A dog.","after":"A dog is sleeping.","reason":"動きを足すと伝わる"},"speechTip":{"aspect":"fluency","text":"止まらずに言ってみよう"}}},"#
      + #"{"id":"\#(host)","name":"はなこ","color":15760040,"rank":1,"score":{"content":90,"expression":80,"speech":85,"total":86},"transcript":"A dog sleeps.","comment":"よい","feedback":{"strength":{"quote":"A dog sleeps.","text":"よい"},"nextStep":{"kind":"expression","gain":null,"text":"場所も足そう"},"rewrite":null,"speechTip":{"aspect":"prosody","text":"抑揚をつけよう"}}}]}"#
    let updates = tracker.apply(try message(json))
    guard case .event(.results(let results)) = updates.first, updates.count == 1 else {
      Issue.record("results でない: \(updates)")
      return
    }
    #expect(results.sceneID == "park")
    #expect(results.sceneName == "公園")
    #expect(results.players.map(\.id) == [host, me, other])
    #expect(results.players[1].isSelf)
    #expect(results.players[1].score == PlayerResult.Score(content: 60, expression: 50, speaking: 70, total: 60))
    #expect(results.players[2].score == nil)
    #expect(
      results.myReview
        == RoundResults.Review(
          strengthQuote: "A dog.", strength: "短い", nextStep: "ボールのことも言ってみよう", nextStepGain: 10,
          rewrite: .init(before: "A dog.", after: "A dog is sleeping.", reason: "動きを足すと伝わる"),
          speechTip: "止まらずに言ってみよう"))
    #expect(results.myReview?.nextStepBadge == "+10 点")
    // つなぎ直したときに送り直される同じ results は渡さない
    #expect(tracker.apply(try message(json)) == [])
  }

  /// 自分が採点できなかったときは myReview が nil。rank があっても score が null なら採点できなかった扱い
  @Test func resultsWithoutSelfScore() throws {
    var tracker = try joined()
    let updates = tracker.apply(
      try message(
        #"{"type":"results","round":1,"sceneId":"park","sceneName":"","players":[{"id":"\#(me)","name":"たろう","color":5987302,"rank":1,"score":null,"transcript":"","comment":"","feedback":null}]}"#
      ))
    guard case .event(.results(let results)) = updates.first else {
      Issue.record("results でない: \(updates)")
      return
    }
    #expect(results.players.first?.score == nil)
    #expect(results.myReview == nil)
  }

  /// 結果発表のあとに待合の room が届いたら、待合に戻る
  /// 作り置きの場面の採点: gain が null・引用が空・言い換えが無くても読め、「+N 点」は出さない
  @Test func resultsWithoutGain() throws {
    var tracker = try joined()
    let updates = tracker.apply(
      try message(
        #"{"type":"results","round":1,"sceneId":"gen-abc","sceneName":"公園","players":[{"id":"\#(me)","name":"たろう","color":5987302,"rank":1,"score":{"content":40,"expression":50,"speech":60,"total":48},"transcript":"A man.","comment":"よい","feedback":{"strength":{"quote":"","text":"よい"},"nextStep":{"kind":"content","gain":null,"text":"犬のことも言ってみよう"},"rewrite":null,"speechTip":{"aspect":"fluency","text":"止まらずに"}}}]}"#
      ))
    guard case .event(.results(let results)) = updates.first else {
      Issue.record("results でない: \(updates)")
      return
    }
    let review = try #require(results.myReview)
    #expect(review.nextStepGain == nil)
    #expect(review.nextStepBadge == nil)
    #expect(review.nextStep == "犬のことも言ってみよう")
    #expect(review.rewrite == nil)
  }

  @Test func returnedToLobby() throws {
    var tracker = try joined()
    _ = tracker.apply(try message(room("playing")))
    _ = tracker.apply(try message(room("results")))
    let updates = tracker.apply(try message(room("lobby")))
    guard case .event(.returnedToLobby(let state)) = updates.first, updates.count == 1 else {
      Issue.record("returnedToLobby でない: \(updates)")
      return
    }
    #expect(state.members.map(\.status) == [.connected, .connected, .connected])
    // 待合のままなら、ふつうの room
    guard case .event(.room) = tracker.apply(try message(room("lobby"))).first else {
      Issue.record("room でない")
      return
    }
  }

  @Test func error() throws {
    var tracker = try joined()
    let updates = tracker.apply(try message(#"{"type":"error","code":"not_in_lobby","message":"始まっている"}"#))
    #expect(updates == [.error(code: .notInLobby, message: "始まっている")])
  }
}

/// 手元のバックエンド（pnpm dev）で、参加者として入ってから「もう一度」で待合に戻るまでに実際に届いたメッセージ。
/// 途中で 1 度切断し、welcome の ID と合言葉でつなぎ直している（2 つ目の welcome から）。合言葉は伏せた。
/// results の feedback は、講評を分けた後の形（#39）に合わせて手で書き換えた
struct LiveRoomTrackerTranscriptTests {
  static let transcript = #"""
    {"type":"welcome","playerId":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","token":"<redacted>","isHost":false}
    {"type":"room","roomId":"4101","phase":"lobby","hostId":"7c93bda4-cedd-4265-90cf-099bf79291c3","maxPlayers":5,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"isHost":true,"connected":true},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"isHost":false,"connected":true}]}
    {"type":"error","code":"not_host","message":"スタートできるのはホストだけ"}
    {"type":"room","roomId":"4101","phase":"playing","hostId":"7c93bda4-cedd-4265-90cf-099bf79291c3","maxPlayers":5,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"isHost":true,"connected":true},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"isHost":false,"connected":true}]}
    {"type":"round","round":1,"sceneId":"park","startAt":1792832005826}
    {"type":"progress","round":1,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","status":"talking"},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","status":"talking"}]}
    {"type":"room","roomId":"4101","phase":"playing","hostId":"7c93bda4-cedd-4265-90cf-099bf79291c3","maxPlayers":5,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"isHost":true,"connected":true},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"isHost":false,"connected":true}]}
    {"type":"progress","round":1,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","status":"talking"},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","status":"grading"}]}
    {"type":"room","roomId":"4101","phase":"playing","hostId":"7c93bda4-cedd-4265-90cf-099bf79291c3","maxPlayers":5,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"isHost":true,"connected":true},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"isHost":false,"connected":true}]}
    {"type":"progress","round":1,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","status":"talking"},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","status":"done"}]}
    {"type":"room","roomId":"4101","phase":"results","hostId":"7c93bda4-cedd-4265-90cf-099bf79291c3","maxPlayers":5,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"isHost":true,"connected":true},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"isHost":false,"connected":true}]}
    {"type":"results","round":1,"sceneId":"park","sceneName":"公園","players":[{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"score":{"content":60,"expression":60,"speech":60,"total":60},"transcript":"(固定の点数のモードのため、文字起こしはありません)","comment":"固定の点数を返しています。","feedback":{"strength":{"quote":"","text":"固定の点数を返しています。"},"nextStep":{"kind":"content","gain":null,"text":"もう少し長く話してみよう。"},"rewrite":null,"speechTip":{"aspect":"accuracy","text":"はっきり発音しよう"}},"rank":1},{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"score":null,"transcript":"","comment":"","feedback":null,"rank":null}]}
    {"type":"welcome","playerId":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","token":"<redacted>","isHost":false}
    {"type":"room","roomId":"4101","phase":"results","hostId":"7c93bda4-cedd-4265-90cf-099bf79291c3","maxPlayers":5,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"isHost":true,"connected":true},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"isHost":false,"connected":true}]}
    {"type":"results","round":1,"sceneId":"park","sceneName":"公園","players":[{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"score":{"content":60,"expression":60,"speech":60,"total":60},"transcript":"(固定の点数のモードのため、文字起こしはありません)","comment":"固定の点数を返しています。","feedback":{"strength":{"quote":"","text":"固定の点数を返しています。"},"nextStep":{"kind":"content","gain":null,"text":"もう少し長く話してみよう。"},"rewrite":null,"speechTip":{"aspect":"accuracy","text":"はっきり発音しよう"}},"rank":1},{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"score":null,"transcript":"","comment":"","feedback":null,"rank":null}]}
    {"type":"room","roomId":"4101","phase":"lobby","hostId":"7c93bda4-cedd-4265-90cf-099bf79291c3","maxPlayers":5,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"isHost":true,"connected":true},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"isHost":false,"connected":true}]}
    """#

  @Test func guestTranscript() throws {
    var tracker = LiveRoomTracker()
    var kinds: [String] = []
    for line in Self.transcript.split(separator: "\n") {
      let message = try JSONDecoder().decode(Components.Schemas.ServerMessage.self, from: Data(line.utf8))
      for update in tracker.apply(message) {
        switch update {
        case .welcome: kinds.append("welcome")
        case .error(let code, _): kinds.append("error:\(code.rawValue)")
        case .event(.room): kinds.append("room")
        case .event(.roundStarted): kinds.append("round")
        case .event(.participantsChanged(let list)): kinds.append("progress:" + list.map { "\($0.status)" }.joined(separator: ","))
        case .event(.results(let results)):
          kinds.append("results:" + results.players.map { $0.score.map { "\($0.total)" } ?? "-" }.joined(separator: ","))
          #expect(results.players.first?.isSelf == true)
          #expect(results.myReview?.strength == "固定の点数を返しています。")
        case .event(.returnedToLobby): kinds.append("lobby")
        case .event(.hostChanged(let isSelf)): kinds.append("host:\(isSelf)")
        }
      }
    }
    // つなぎ直したときに送り直される results は渡さない
    #expect(
      kinds == [
        "welcome", "room", "error:not_host", "round", "progress:talking,talking", "progress:talking,grading",
        "progress:talking,done", "results:60,-", "welcome", "lobby",
      ])
  }
}

/// ホストが抜けて替わったときに、新しいホストが分かるか
struct LiveRoomTrackerHostTests {
  let me = "00000000-0000-4000-8000-000000000001"
  let host = "00000000-0000-4000-8000-000000000002"

  func message(_ json: String) throws -> Components.Schemas.ServerMessage {
    try JSONDecoder().decode(Components.Schemas.ServerMessage.self, from: Data(json.utf8))
  }

  /// hostId と、残っている人。hostLeft なら前のホストは抜けていて、自分がホスト
  func room(_ phase: String, hostLeft: Bool) -> String {
    let others = hostLeft ? "" : #"{"id":"\#(host)","name":"はなこ","color":15760040,"isHost":true,"connected":true},"#
    return #"{"type":"room","roomId":"0427","phase":"\#(phase)","hostId":"\#(hostLeft ? me : host)","maxPlayers":5,"players":["#
      + others + #"{"id":"\#(me)","name":"たろう","color":5987302,"isHost":\#(hostLeft),"connected":true}]}"#
  }

  func joined() throws -> LiveRoomTracker {
    var tracker = LiveRoomTracker()
    _ = tracker.apply(try message(#"{"type":"welcome","playerId":"\#(me)","token":"t0k","isHost":false}"#))
    _ = tracker.apply(try message(room("lobby", hostLeft: false)))
    return tracker
  }

  /// 待合では room の members の isHost で分かる
  @Test func lobby() throws {
    var tracker = try joined()
    let updates = tracker.apply(try message(room("lobby", hostLeft: true)))
    guard case .event(.room(let state)) = updates.first else {
      Issue.record("room でない: \(updates)")
      return
    }
    #expect(state.members.map(\.isHost) == [true])
    #expect(state.members.first?.isSelf == true)
  }

  /// ラウンド中と結果発表では hostChanged を渡す。ホストが替わらない room では渡さない
  @Test(arguments: ["playing", "results"])
  func duringRound(phase: String) throws {
    var tracker = try joined()
    #expect(tracker.apply(try message(room(phase, hostLeft: false))) == [])
    #expect(tracker.apply(try message(room(phase, hostLeft: true))) == [.event(.hostChanged(isSelf: true))])
    #expect(tracker.apply(try message(room(phase, hostLeft: true))) == [])
  }
}
