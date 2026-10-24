import Foundation

extension RoundResults {
  /// 仮の結果。参加者の名前・色・自分かどうか・採点できたかを受け取り、点数・文字起こし・講評を作る
  static func mock(
    sceneName: String,
    players: [(id: String, name: String, color: UInt32, isSelf: Bool, graded: Bool)]
  ) -> RoundResults {
    var graded: [PlayerResult] = []
    var ungraded: [PlayerResult] = []
    var myReview: Review?

    for (i, p) in players.enumerated() {
      guard p.graded else {
        ungraded.append(
          PlayerResult(id: p.id, name: p.name, color: p.color, isSelf: p.isSelf, score: nil, transcript: "", comment: ""))
        continue
      }
      // 並び順で文例を割り当てる（プレビューで毎回同じになるように）
      let sample = MockSample.all[i % MockSample.all.count]
      graded.append(
        PlayerResult(
          id: p.id, name: p.name, color: p.color, isSelf: p.isSelf,
          score: sample.score, transcript: sample.transcript, comment: sample.comment))
      if p.isSelf { myReview = sample.review }
    }

    // 点数の高い順。採点できなかった人は最後
    graded.sort { ($0.score?.total ?? 0) > ($1.score?.total ?? 0) }
    return RoundResults(sceneName: sceneName, players: graded + ungraded, myReview: myReview)
  }
}

/// 仮の文例（公園のシーン）。上手さに幅を持たせる
private struct MockSample {
  let content: Int
  let expression: Int
  let speaking: Int
  let transcript: String
  let comment: String
  let review: RoundResults.Review

  /// 合計は 内容 50%・表現 25%・話し方 25% で四捨五入（仮の重み。本物はバックエンドが決める）
  var score: PlayerResult.Score {
    let total = (Double(content) * 0.5 + Double(expression) * 0.25 + Double(speaking) * 0.25).rounded()
    return PlayerResult.Score(content: content, expression: expression, speaking: speaking, total: Int(total))
  }

  static let all: [MockSample] = [
    MockSample(
      content: 76, expression: 70, speaking: 88,
      transcript: "There is a bench in the park. There is a tree. A dog is near the bench.",
      comment: "話し方は安定している。もう少し具体的に。",
      review: RoundResults.Review(
        comment: "ベンチ・木・犬は押さえています。犬がどこで何をしているかを文で言えると、内容の点が上がります。",
        modelSentence: "A dog is resting on the bench under the big tree.",
        modelSentenceJa: "大きな木の下のベンチで、犬が休んでいます。")),
    MockSample(
      content: 92, expression: 88, speaking: 85,
      transcript:
        "A little boy is throwing a red ball, and a brown dog is running after it. Behind them, there is a wooden bench under a big tree.",
      comment: "動きと位置の関係まで言えている。",
      review: RoundResults.Review(
        comment: "男の子・犬・ボールの動きと、ベンチと木の位置を一度に伝えられています。この調子です。",
        modelSentence: "A boy is throwing a red ball for his dog in front of the bench.",
        modelSentenceJa: "ベンチの前で、男の子が犬にむかって赤いボールを投げています。")),
    MockSample(
      content: 84, expression: 78, speaking: 80,
      transcript: "There is a wooden bench under a big tree. A dog is next to the bench, and a boy is playing with a ball.",
      comment: "場面の要素を幅広く拾えている。",
      review: RoundResults.Review(
        comment: "要素は幅広く拾えています。ボールの色や男の子の動きを足すと、場面がもっと伝わります。",
        modelSentence: "A boy is about to throw a red ball to his dog.",
        modelSentenceJa: "男の子が、犬に赤いボールを投げようとしています。")),
    MockSample(
      content: 65, expression: 72, speaking: 79,
      transcript: "Bench, tree, and, um, dog. A boy... red ball.",
      comment: "要素は挙がっているが、文になっていない。",
      review: RoundResults.Review(
        comment: "見えているものは挙げられています。「There is 〜」「A boy is 〜ing」の形で文にしてみましょう。",
        modelSentence: "There is a boy with a red ball next to a dog.",
        modelSentenceJa: "犬のそばに、赤いボールを持った男の子がいます。")),
    MockSample(
      content: 88, expression: 82, speaking: 74,
      transcript: "In the park, a boy and his dog are playing with a red ball. An empty bench is under the tree.",
      comment: "場面の関係が描けている。発音に少し揺れがある。",
      review: RoundResults.Review(
        comment: "場面の関係がよく描けています。ゆっくり区切って話すと、話し方の点が上がります。",
        modelSentence: "An empty bench stands under the tree while a boy plays with his dog.",
        modelSentenceJa: "男の子が犬と遊んでいるそばで、木の下に誰もいないベンチがあります。")),
    MockSample(
      content: 58, expression: 60, speaking: 66,
      transcript: "A dog. The dog is play. Ball is red.",
      comment: "短い文で言えている。動詞の形に気をつけて。",
      review: RoundResults.Review(
        comment: "短くても文で言えています。「is play」は「is playing」にすると自然です。",
        modelSentence: "The dog is playing with a red ball.",
        modelSentenceJa: "犬が赤いボールで遊んでいます。")),
    MockSample(
      content: 80, expression: 86, speaking: 90,
      transcript: "It's a sunny day. A boy is playing catch with his dog, and the dog looks really happy.",
      comment: "表現が生き生きしている。ベンチと木にも触れたい。",
      review: RoundResults.Review(
        comment: "生き生きとした表現です。ベンチや木など、背景にも一言触れると内容の点が上がります。",
        modelSentence: "A boy and his dog are playing catch near a bench under a tree.",
        modelSentenceJa: "木の下のベンチのそばで、男の子と犬がキャッチボールをしています。")),
    MockSample(
      content: 70, expression: 64, speaking: 72,
      transcript: "I can see a tree and a bench. There is a boy. He has a ball.",
      comment: "順に説明できている。犬が抜けている。",
      review: RoundResults.Review(
        comment: "見えるものを順に説明できています。犬が抜けているので、男の子との関係も足してみましょう。",
        modelSentence: "A boy holding a red ball is standing next to his dog.",
        modelSentenceJa: "赤いボールを持った男の子が、犬の隣に立っています。")),
  ]
}

extension RoundResults {
  /// プレビュー用（5 人、全員採点できた）
  static var previewFive: RoundResults {
    .mock(
      sceneName: "公園",
      players: [
        ("me", "ゆうき", 0x5B5BE6, true, true),
        ("p0", "たろう", 0xF29A3A, false, true),
        ("p1", "はなこ", 0xB06AD9, false, true),
        ("p2", "けん", 0x2FAE9B, false, true),
        ("p3", "みさき", 0xE5568A, false, true),
      ])
  }

  /// プレビュー用（8 人、2 人は採点できなかった）
  static var previewEight: RoundResults {
    .mock(
      sceneName: "公園",
      players: [
        ("me", "ゆうき", 0x5B5BE6, true, true),
        ("p0", "たろう", 0xF29A3A, false, true),
        ("p1", "はなこ", 0xB06AD9, false, true),
        ("p2", "けん", 0x2FAE9B, false, false),
        ("p3", "みさき", 0xE5568A, false, true),
        ("p4", "そうた", 0x3A9BF2, false, true),
        ("p5", "あおい", 0xE0A21B, false, true),
        ("p6", "りく", 0x7A8A99, false, false),
      ])
  }

  /// プレビュー用（自分が採点できなかった）
  static var previewSelfUngraded: RoundResults {
    .mock(
      sceneName: "公園",
      players: [
        ("me", "ゆうき", 0x5B5BE6, true, false),
        ("p0", "たろう", 0xF29A3A, false, true),
        ("p1", "はなこ", 0xB06AD9, false, true),
      ])
  }
}
