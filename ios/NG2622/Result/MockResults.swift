import Foundation

extension RoundResults {
  /// 仮の結果。シーンと、参加者の名前・色・自分かどうか・採点できたかを受け取り、点数・文字起こし・講評を作る
  static func mock(
    sceneID: String,
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
      let samples = MockSample.samples(for: sceneID)
      let sample = samples[i % samples.count]
      graded.append(
        PlayerResult(
          id: p.id, name: p.name, color: p.color, isSelf: p.isSelf,
          score: sample.score, transcript: sample.transcript, comment: sample.comment))
      if p.isSelf { myReview = sample.review }
    }

    // 点数の高い順。採点できなかった人は最後
    graded.sort { ($0.score?.total ?? 0) > ($1.score?.total ?? 0) }
    return RoundResults(
      sceneID: sceneID, sceneName: SceneCatalog.name(of: sceneID), players: graded + ungraded, myReview: myReview)
  }
}

/// 仮の文例（シーンごと）。上手さに幅を持たせる
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

  static func samples(for sceneID: String) -> [MockSample] {
    switch sceneID {
    case "classroom": classroom
    case "station": station
    default: park
    }
  }

  static let park: [MockSample] = [
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

extension MockSample {
  static let classroom: [MockSample] = [
    MockSample(
      content: 90, expression: 86, speaking: 84,
      transcript:
        "A teacher is pointing at the blackboard, and a boy in a yellow shirt is raising his hand. The other students are writing in their notebooks.",
      comment: "先生と生徒の動きを両方言えている。",
      review: RoundResults.Review(
        comment: "先生・手を挙げた男の子・ノートを書く生徒と、動きをまとめて伝えられています。この調子です。",
        modelSentence: "A boy is raising his hand while the teacher points at the blackboard.",
        modelSentenceJa: "先生が黒板を指していて、男の子が手を挙げています。")),
    MockSample(
      content: 74, expression: 70, speaking: 82,
      transcript: "There is a classroom. There are many desks. There is a clock on the wall.",
      comment: "物は挙がっている。人の動きも言いたい。",
      review: RoundResults.Review(
        comment: "机や時計は押さえています。先生や生徒が何をしているかを足すと、内容の点が上がります。",
        modelSentence: "Students are sitting at their desks, and a clock is on the wall.",
        modelSentenceJa: "生徒たちが机に座っていて、壁に時計があります。")),
    MockSample(
      content: 62, expression: 64, speaking: 70,
      transcript: "Teacher, blackboard. A boy... hand up. Apple.",
      comment: "要素は挙がっているが、文になっていない。",
      review: RoundResults.Review(
        comment: "見えているものは挙げられています。「A boy is raising his hand.」のように文にしてみましょう。",
        modelSentence: "There is an apple and a globe on the teacher's desk.",
        modelSentenceJa: "先生の机の上に、りんごと地球儀があります。")),
    MockSample(
      content: 82, expression: 80, speaking: 76,
      transcript: "In the classroom, the teacher is standing by the blackboard. I can see two windows with yellow curtains and a bookshelf.",
      comment: "教室の様子を広く描けている。",
      review: RoundResults.Review(
        comment: "教室の様子を広く描けています。生徒の動きにも一言触れると、場面がもっと伝わります。",
        modelSentence: "The teacher is standing by the blackboard next to the windows.",
        modelSentenceJa: "先生が、窓のそばの黒板の横に立っています。")),
  ]

  static let station: [MockSample] = [
    MockSample(
      content: 88, expression: 84, speaking: 86,
      transcript:
        "A woman is walking out of the station with a pink suitcase. A man in a suit is looking at his phone at the bus stop.",
      comment: "人の動きと持ち物まで言えている。",
      review: RoundResults.Review(
        comment: "スーツケースの女性とバス停の男性を、動きまで含めて伝えられています。この調子です。",
        modelSentence: "A woman pulling a pink suitcase is walking out of the station.",
        modelSentenceJa: "ピンクのスーツケースを引いた女性が、駅から出てきています。")),
    MockSample(
      content: 72, expression: 68, speaking: 80,
      transcript: "There is a station. There is a clock. There is a yellow taxi.",
      comment: "物は挙がっている。人にも触れたい。",
      review: RoundResults.Review(
        comment: "駅・時計・タクシーは押さえています。人が何をしているかを足すと、内容の点が上がります。",
        modelSentence: "A yellow taxi is waiting on the road in front of the station.",
        modelSentenceJa: "駅の前の道で、黄色いタクシーが待っています。")),
    MockSample(
      content: 60, expression: 62, speaking: 68,
      transcript: "Station, big clock. Taxi is yellow. Man phone.",
      comment: "短い語で言えている。文にしたい。",
      review: RoundResults.Review(
        comment: "見えているものは挙げられています。「A man is looking at his phone.」のように文にしてみましょう。",
        modelSentence: "A man is looking at his phone at the bus stop.",
        modelSentenceJa: "バス停で、男の人がスマホを見ています。")),
    MockSample(
      content: 80, expression: 82, speaking: 74,
      transcript: "In front of the station, there is a red vending machine and a blue bicycle. A taxi is next to the crosswalk.",
      comment: "位置の関係が描けている。発音に少し揺れがある。",
      review: RoundResults.Review(
        comment: "物の位置の関係がよく描けています。ゆっくり区切って話すと、話し方の点が上がります。",
        modelSentence: "A taxi is waiting next to the crosswalk in front of the station.",
        modelSentenceJa: "駅の前の横断歩道のそばで、タクシーが待っています。")),
  ]
}

extension RoundResults {
  /// プレビュー用（5 人、全員採点できた）
  static var previewFive: RoundResults {
    .mock(
      sceneID: "park",
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
      sceneID: "park",
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
      sceneID: "park",
      players: [
        ("me", "ゆうき", 0x5B5BE6, true, false),
        ("p0", "たろう", 0xF29A3A, false, true),
        ("p1", "はなこ", 0xB06AD9, false, true),
      ])
  }
}
