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
    // 部屋のコードも付ける（部屋がその場で作った場面の配置を取るときに要る）
    #expect(
      tracker.apply(try message(json)) == [
        .event(.roundStarted(RoundInfo(sceneID: "park", startsAt: start, room: "0427")))
      ])
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

  static let content =
    #"{"claims":[{"quote":"A dog is sleeping.","verdict":"correct","item":"dog_sleep","level":"full","note":null},"#
    + #"{"quote":"A cat.","verdict":"absent","item":null,"level":null,"note":"猫はいません"},"#
    + #"{"quote":"It is sunny.","verdict":"correct","item":null,"level":null,"note":null}],"#
    + #""items":[{"id":"dog_sleep","kind":"center","label":"犬が寝ている","level":"full"},"#
    + #"{"id":"why","kind":"reason","label":"理由","level":"partial"},{"id":"ball","kind":"detail","label":"ボール","level":"none"}],"#
    + #""others":1,"recall":{"earned":2.5,"max":5},"precision":{"correct":2,"said":3}}"#

  /// 順位の順に並べ、採点できなかった人は score を nil にして最後に置く。自分の講評は myReview に入り、内容の内訳は全員の分を持つ
  @Test func results() throws {
    var tracker = try joined()
    _ = tracker.apply(try message(#"{"type":"round","round":1,"sceneId":"temp-eiken-3-park","startAt":0}"#))
    let json =
      #"{"type":"results","round":1,"sceneId":"temp-eiken-3-park","sceneName":"公園","players":["#
      + #"{"id":"\#(other)","name":"けん","color":3124891,"rank":null,"score":null,"transcript":"","content":null,"feedback":null},"#
      + #"{"id":"\#(me)","name":"たろう","color":5987302,"rank":2,"score":{"content":60,"expression":50,"speech":70,"total":60},"transcript":"A dog is sleeping. A cat. It is sunny.","content":\#(Self.content),"feedback":{"nextStep":{"kind":"content","text":"ボールのことも言ってみよう","item":"ball","gain":10},"rewrite":{"before":"A cat.","after":"A dog is sleeping.","reason":"場面にいる物を言おう"},"speechTip":{"aspect":"fluency","text":"止まらずに言ってみよう"},"expressionBasis":"Uses the present continuous correctly."}},"#
      + #"{"id":"\#(host)","name":"はなこ","color":15760040,"rank":1,"score":{"content":90,"expression":80,"speech":85,"total":86},"transcript":"A dog sleeps.","content":\#(Self.content),"feedback":{"nextStep":{"kind":"expression","text":"場所も足そう","item":null,"gain":null},"rewrite":null,"speechTip":{"aspect":"prosody","text":"抑揚をつけよう"},"expressionBasis":"Uses the present continuous correctly."}}]}"#
    let updates = tracker.apply(try message(json))
    guard case .event(.results(let results)) = updates.first, updates.count == 1 else {
      Issue.record("results でない: \(updates)")
      return
    }
    #expect(results.sceneID == "temp-eiken-3-park")
    #expect(results.room == "0427")
    #expect(results.sceneName == "公園")
    #expect(results.players.map(\.id) == [host, me, other])
    #expect(results.players[1].isSelf)
    #expect(results.players[1].score == PlayerResult.Score(content: 60, expression: 50, speaking: 70, total: 60))
    #expect(results.players[2].score == nil)
    #expect(results.players[2].content == nil)
    // 他の人の内訳も持つ
    #expect(results.players[0].content != nil)
    let content = try #require(results.players[1].content)
    #expect(content.claims.map(\.verdict) == [.correct, .absent, .correct])
    #expect(content.claims[0] == .init(quote: "A dog is sleeping.", verdict: .correct, item: "dog_sleep", level: .full, note: nil))
    #expect(content.claims[1].note == "猫はいません")
    #expect(content.items.map(\.level) == [.full, .partial, .none])
    #expect(content.items.map(\.kind) == [.center, .reason, .detail])
    #expect(content.others == 1)
    #expect(content.recall == .init(earned: 2.5, max: 5))
    #expect(content.precision == .init(correct: 2, said: 3))
    #expect([content.fullCount, content.partialCount, content.mismatchCount] == [Int](repeating: 1, count: 3))
    #expect(
      results.myReview
        == RoundResults.Review(
          nextStep: .init(kind: .content, text: "ボールのことも言ってみよう", item: "ball", gain: 10),
          rewrite: .init(before: "A cat.", after: "A dog is sleeping.", reason: "場面にいる物を言おう"),
          speechTip: .init(aspect: .fluency, text: "止まらずに言ってみよう"),
          expressionBasis: "Uses the present continuous correctly."))
    #expect(results.myReview?.nextStep.badge == "+10 点")
    // つなぎ直したときに送り直される同じ results は渡さない
    #expect(tracker.apply(try message(json)) == [])
  }

  /// 自分が採点できなかったときは myReview が nil。rank があっても score が null なら採点できなかった扱い
  @Test func resultsWithoutSelfScore() throws {
    var tracker = try joined()
    let updates = tracker.apply(
      try message(
        #"{"type":"results","round":1,"sceneId":"temp-eiken-3-park","sceneName":"","players":[{"id":"\#(me)","name":"たろう","color":5987302,"rank":1,"score":null,"transcript":"","content":null,"feedback":null}]}"#
      ))
    guard case .event(.results(let results)) = updates.first else {
      Issue.record("results でない: \(updates)")
      return
    }
    #expect(results.players.first?.score == nil)
    #expect(results.myReview == nil)
  }

  /// rank が null なら、content が付いていても採点できなかった人として扱い、内訳を持たない
  @Test func resultsUngradedWithContent() throws {
    var tracker = try joined()
    let updates = tracker.apply(
      try message(
        #"{"type":"results","round":1,"sceneId":"temp-eiken-3-park","sceneName":"公園","players":[{"id":"\#(me)","name":"たろう","color":5987302,"rank":null,"score":{"content":60,"expression":50,"speech":70,"total":60},"transcript":"A dog.","content":\#(Self.content),"feedback":null}]}"#
      ))
    guard case .event(.results(let results)) = updates.first else {
      Issue.record("results でない: \(updates)")
      return
    }
    #expect(results.players.first?.score == nil)
    #expect(results.players.first?.content == nil)
    #expect(results.myReview == nil)
  }

  /// sceneName が空なら、取ってある配置の JSON の名前で埋める。取っていなければ ID のまま
  @Test func resultsFillSceneName() async throws {
    let sceneID = try #require(ScenePool.bundled.randomCandidate())
    let layout = try await SceneLayouts.store.layout(of: sceneID)
    let json =
      #"{"type":"results","round":1,"sceneId":"\#(sceneID)","sceneName":"","players":[]}"#
    let message = try JSONDecoder().decode(Components.Schemas.ServerMessage.self, from: Data(json.utf8))
    guard case .results(let results) = message else {
      Issue.record("results でない")
      return
    }
    #expect(RoundResults(results, selfID: nil).sceneName == layout.name)
    let unknown = try JSONDecoder().decode(
      Components.Schemas.ServerMessage.self,
      from: Data(#"{"type":"results","round":1,"sceneId":"gen-unknown","sceneName":"","players":[]}"#.utf8))
    guard case .results(let other) = unknown else { return }
    #expect(RoundResults(other, selfID: nil).sceneName == "gen-unknown")
  }

  /// 3 語未満の発話: 項目は全部 none・描写は空、次の一つは item も gain も null で、「+N 点」は出さない
  @Test func resultsTooShort() throws {
    var tracker = try joined()
    let short =
      #"{"claims":[],"items":[{"id":"a","kind":"center","label":"犬","level":"none"}],"others":0,"recall":{"earned":0,"max":2},"precision":{"correct":0,"said":0}}"#
    let updates = tracker.apply(
      try message(
        #"{"type":"results","round":1,"sceneId":"temp-eiken-3-park","sceneName":"公園","players":[{"id":"\#(me)","name":"たろう","color":5987302,"rank":1,"score":{"content":0,"expression":10,"speech":20,"total":8},"transcript":"A dog.","content":\#(short),"feedback":{"nextStep":{"kind":"content","text":"もっと話そう","item":null,"gain":null},"rewrite":null,"speechTip":{"aspect":"accuracy","text":"はっきり"},"expressionBasis":"Uses the present continuous correctly."}}]}"#
      ))
    guard case .event(.results(let results)) = updates.first else {
      Issue.record("results でない: \(updates)")
      return
    }
    let review = try #require(results.myReview)
    #expect(review.nextStep.item == nil)
    #expect(review.nextStep.badge == nil)
    #expect(review.rewrite == nil)
    #expect(review.speechTip.aspect.label == "正確さ")
    #expect(results.players.first?.content?.claims.isEmpty == true)
    #expect(results.players.first?.content?.items.map(\.level) == [ContentBreakdown.Level.none])
  }

  /// 結果発表のあとに待合の room が届いたら、待合に戻る
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

  /// スタートを受けて場面を作っている room（generating）は、待合と同じ参加者の一覧で generating になる。
  /// 作り終えて round が届けば始まり、待合に戻る扱い（returnedToLobby）にはしない
  @Test func generating() throws {
    var tracker = try joined()
    let updates = tracker.apply(try message(room("generating")))
    guard case .event(.generating(let state)) = updates.first, updates.count == 1 else {
      Issue.record("generating でない: \(updates)")
      return
    }
    #expect(state.code == "0427")
    #expect(state.members.map(\.isHost) == [true, false, false])
    let round = tracker.apply(try message(#"{"type":"round","round":1,"sceneId":"gen-abcdefghij","startAt":0}"#))
    guard case .event(.roundStarted(let info)) = round.first else {
      Issue.record("roundStarted でない: \(round)")
      return
    }
    #expect(info.sceneID == "gen-abcdefghij")
    #expect(info.room == "0427")
    // 作れずに待合へ戻ったときも、ふつうの room
    var other = try joined()
    _ = other.apply(try message(room("generating")))
    guard case .event(.room) = other.apply(try message(room("lobby"))).first else {
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
    {"type":"round","round":1,"sceneId":"temp-eiken-3-park","startAt":1792832005826}
    {"type":"progress","round":1,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","status":"talking"},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","status":"talking"}]}
    {"type":"room","roomId":"4101","phase":"playing","hostId":"7c93bda4-cedd-4265-90cf-099bf79291c3","maxPlayers":5,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"isHost":true,"connected":true},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"isHost":false,"connected":true}]}
    {"type":"progress","round":1,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","status":"talking"},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","status":"grading"}]}
    {"type":"room","roomId":"4101","phase":"playing","hostId":"7c93bda4-cedd-4265-90cf-099bf79291c3","maxPlayers":5,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"isHost":true,"connected":true},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"isHost":false,"connected":true}]}
    {"type":"progress","round":1,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","status":"talking"},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","status":"done"}]}
    {"type":"room","roomId":"4101","phase":"results","hostId":"7c93bda4-cedd-4265-90cf-099bf79291c3","maxPlayers":5,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"isHost":true,"connected":true},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"isHost":false,"connected":true}]}
    {"type":"results","round":1,"sceneId":"temp-eiken-3-park","sceneName":"公園","players":[{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"score":{"content":60,"expression":60,"speech":60,"total":60},"transcript":"(固定の点数のモードのため、文字起こしはありません)","content":{"claims":[],"items":[],"others":0,"recall":{"earned":0,"max":0},"precision":{"correct":0,"said":0}},"feedback":{"nextStep":{"kind":"content","text":"もう少し長く話してみよう。","item":null,"gain":null},"rewrite":null,"speechTip":{"aspect":"accuracy","text":"はっきり発音しよう"},"expressionBasis":"Fixed score mode: expression was not assessed."},"rank":1},{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"score":null,"transcript":"","content":null,"feedback":null,"rank":null}]}
    {"type":"welcome","playerId":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","token":"<redacted>","isHost":false}
    {"type":"room","roomId":"4101","phase":"results","hostId":"7c93bda4-cedd-4265-90cf-099bf79291c3","maxPlayers":5,"players":[{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"isHost":true,"connected":true},{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"isHost":false,"connected":true}]}
    {"type":"results","round":1,"sceneId":"temp-eiken-3-park","sceneName":"公園","players":[{"id":"2a17275a-de46-44f1-8ddb-a09a5cf691fc","name":"たろう","color":5987302,"score":{"content":60,"expression":60,"speech":60,"total":60},"transcript":"(固定の点数のモードのため、文字起こしはありません)","content":{"claims":[],"items":[],"others":0,"recall":{"earned":0,"max":0},"precision":{"correct":0,"said":0}},"feedback":{"nextStep":{"kind":"content","text":"もう少し長く話してみよう。","item":null,"gain":null},"rewrite":null,"speechTip":{"aspect":"accuracy","text":"はっきり発音しよう"},"expressionBasis":"Fixed score mode: expression was not assessed."},"rank":1},{"id":"7c93bda4-cedd-4265-90cf-099bf79291c3","name":"はなこ","color":15760040,"score":null,"transcript":"","content":null,"feedback":null,"rank":null}]}
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
        case .event(.generating): kinds.append("generating")
        case .event(.roundStarted): kinds.append("round")
        case .event(.participantsChanged(let list)): kinds.append("progress:" + list.map { "\($0.status)" }.joined(separator: ","))
        case .event(.results(let results)):
          kinds.append("results:" + results.players.map { $0.score.map { "\($0.total)" } ?? "-" }.joined(separator: ","))
          #expect(results.players.first?.isSelf == true)
          #expect(results.myReview?.nextStep.text == "もう少し長く話してみよう。")
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
