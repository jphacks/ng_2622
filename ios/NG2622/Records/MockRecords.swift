import Foundation

extension PlayRecord {
  /// 例の記録（Mock で、きろくの画面を遊ばずに確かめるためのもの）。同梱の作り置きの場面から 5 つを使い、
  /// 同じ場面を何回か遊んだ形にする。新しい回ほど点が高い。端末には書かず、録音も無い
  static func samples(count: Int, now: Date = Date(), pool: ScenePool = .bundled) -> [PlayRecord] {
    let sceneIDs = Array(SceneDifficulty.allCases.flatMap { pool.candidates(of: $0).prefix(2) }.prefix(5))
    guard count > 0, !sceneIDs.isEmpty else { return [] }
    // どの場面を遊んだか（新しい順）。1 つ目の場面を多めにする
    let pattern = [0, 1, 0, 2, 1, 0, 3, 2, 4, 0, 1, 3]
    return (0..<count).compactMap { i -> PlayRecord? in
      let sceneID = sceneIDs[pattern[i % pattern.count] % sceneIDs.count]
      guard let scene = try? MockSceneLayoutClient.readDocument(sceneID),
        let me = RoundResults.mock(
          sceneID: sceneID, players: [(id: "me", name: "", color: 0, isSelf: true, graded: true)], layout: scene.layout
        ).me.flatMap({ PlayRecord.Result($0, review: nil) }),
        let sceneJSON = try? JSONValue(data: scene.data)
      else { return nil }
      let review = RoundResults.mock(
        sceneID: sceneID, players: [(id: "me", name: "", color: 0, isSelf: true, graded: true)], layout: scene.layout
      ).myReview
      // 古い回ほど、表現と話し方の点を少し下げる（内容の点は内訳と合わせたままにする）
      let drop = min(30, i * 3)
      let expression = max(0, me.score.expression - drop)
      let speech = max(0, me.score.speech - drop)
      let weights = RoundResults.Weights.self
      let total =
        (me.score.content * weights.content + expression * weights.expression + speech * weights.speech) / 100
      let result = PlayRecord.Result(
        transcript: me.transcript,
        score: .init(content: me.score.content, expression: expression, speech: speech, total: total),
        content: me.content, feedback: review.map(PlayRecord.Feedback.init))
      return PlayRecord(
        id: "sample-\(i)", playedAt: now.addingTimeInterval(-Double(i) * 20 * 3600 - 1800),
        difficulty: scene.layout.difficulty?.rawValue, scene: sceneJSON, result: result)
    }
  }
}
