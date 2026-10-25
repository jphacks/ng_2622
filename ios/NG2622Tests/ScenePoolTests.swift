import Foundation
import Testing

@testable import NG2622

/// 難易度で作り置きの場面を選ぶ（docs/design/scene-protocol.md の「待合での出し方」）
struct ScenePoolTests {
  let easy = ["gen-easy-a", "gen-easy-b"]
  let hard = ["gen-hard-a", "gen-hard-b", "gen-hard-c"]

  func pool() -> ScenePool {
    ScenePool(scenes: [.easy: easy, .normal: [], .hard: hard])
  }

  /// その難易度の場面だけから選ぶ。場面の無い難易度は nil で、difficulties にも入らない
  @Test func drawsOnlyThatDifficulty() {
    var pool = pool()
    for _ in 0..<30 {
      let drawn = pool.draw(.hard)
      #expect(hard.contains(drawn ?? ""))
    }
    let none = pool.draw(.normal)
    #expect(none == nil)
    #expect(pool.difficulties == [.easy, .hard])
    #expect(pool.played.isDisjoint(with: easy))
  }

  /// その部屋で出た場面は、全部出るまで選ばない
  @Test func avoidsPlayed() {
    for _ in 0..<20 {
      var pool = pool()
      let drawn = (0..<hard.count).compactMap { _ in pool.draw(.hard) }
      #expect(Set(drawn) == Set(hard))
      #expect(pool.played == Set(hard))
    }
  }

  /// 全部出たら最初に戻る。戻るのはその難易度の分だけで、直前の場面は続けて出さない
  @Test func wrapsAroundAfterAllPlayed() throws {
    for _ in 0..<20 {
      var pool = pool()
      let firstEasyDrawn = pool.draw(.easy)
      let firstEasy = try #require(firstEasyDrawn)
      let round = hard.compactMap { _ in pool.draw(.hard) }
      #expect(Set(round) == Set(hard))
      let nextDrawn = pool.draw(.hard)
      let next = try #require(nextDrawn)
      #expect(next != round.last)
      #expect(pool.played.intersection(hard) == [next])
      // ほかの難易度の出た場面は覚えたまま
      #expect(pool.played.contains(firstEasy))
    }
  }

  /// 前の周の最後の場面は、戻った直後には出ない
  @Test func noRepeatAcrossWrap() throws {
    for _ in 0..<20 {
      var pool = pool()
      let firstDrawn = pool.draw(.easy)
      let first = try #require(firstDrawn)
      let secondDrawn = pool.draw(.easy)
      let second = try #require(secondDrawn)
      #expect(first != second)
      let third = pool.draw(.easy)
      #expect(third == first)
    }
    // 1 つしか無ければ、続けて同じ場面が出る
    var single = ScenePool(scenes: [.normal: ["gen-only"]])
    let once = single.draw(.normal)
    let twice = single.draw(.normal)
    #expect(once == "gen-only")
    #expect(twice == "gen-only")
  }

  /// 例の場面（待合でホストに見せる）は出題しない。例しか無い難易度は選べない
  @Test func exampleIsNeverDrawn() {
    var pool = ScenePool(
      scenes: [.easy: easy, .normal: ["gen-normal-example"], .hard: hard],
      examples: [.easy: "gen-easy-a", .normal: "gen-normal-example", .hard: "gen-hard-b"])
    #expect(pool.example(of: .easy) == "gen-easy-a")
    #expect(pool.candidates(of: .hard) == ["gen-hard-a", "gen-hard-c"])
    #expect(pool.difficulties == [.easy, .hard])
    for _ in 0..<30 {
      let e = pool.draw(.easy)
      let h = pool.draw(.hard)
      let n = pool.draw(.normal)
      #expect(e == "gen-easy-b")
      #expect(h != "gen-hard-b")
      #expect(n == nil)
    }
    #expect(!pool.played.contains("gen-easy-a"))
    #expect(!pool.played.contains("gen-hard-b"))
    // 場面に無い ID を例にしても、例は出さない
    let broken = ScenePool(scenes: [.easy: easy], examples: [.easy: "gen-nothing"])
    #expect(broken.example(of: .easy) == nil)
  }

  /// 同梱の作り置きの場面は、難易度ごとに 2 つ（例 1 つと出題 1 つ）あり、配置の JSON の difficulty と合っている
  @Test func bundledPool() async throws {
    let pool = ScenePool.bundled
    #expect(pool.difficulties == SceneDifficulty.allCases)
    let client = MockSceneLayoutClient()
    for difficulty in SceneDifficulty.allCases {
      let ids = pool.scenes[difficulty] ?? []
      #expect(ids.count == 2)
      let example = try #require(pool.example(of: difficulty))
      #expect(ids.contains(example))
      #expect(pool.candidates(of: difficulty) == ids.filter { $0 != example })
      for id in ids {
        #expect(try await client.layout(sceneID: id).difficulty == difficulty.rawValue)
      }
    }
    // 例: かんたん＝リンゴが落ちる公園、ふつう＝スーパーのレジ、むずかしい＝朝の駅のホーム
    #expect(try await client.layout(sceneID: pool.example(of: .easy) ?? "").name == "リンゴが落ちる公園")
    #expect(try await client.layout(sceneID: pool.example(of: .normal) ?? "").name == "スーパーのレジ")
    #expect(try await client.layout(sceneID: pool.example(of: .hard) ?? "").name == "朝の駅のホーム")
  }

  /// Mock のホストが難易度でスタートすると、その難易度の作り置きの場面（例でないもの）でラウンドが始まる
  @Test func mockStartsWithDifficulty() async throws {
    let client = MockGameClient(options: .init(otherPlayers: 0), pool: .bundled)
    _ = try await client.createRoom(as: PlayerProfile(name: "たろう", color: 0x5B5BE6))
    try await client.startRound(difficulty: .hard)
    var sceneID: String?
    for await event in client.events {
      if case .roundStarted(let info) = event {
        sceneID = info.sceneID
        break
      }
    }
    client.leaveRoom()
    #expect(ScenePool.bundled.candidates(of: .hard).contains(sceneID ?? ""))
    #expect(sceneID != ScenePool.bundled.example(of: .hard))
  }
}
