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
          score: sample.score, transcript: sample.transcript, comment: sample.review.strength))
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
}

/// 講評を短く書くための入れ物
private func mockReview(
  _ quote: String, _ strength: String,
  next: String, gain: Int? = nil,
  rewrite: (String, String, String)? = nil,
  speech: String
) -> RoundResults.Review {
  RoundResults.Review(
    strengthQuote: quote, strength: strength,
    nextStep: next, nextStepGain: gain,
    rewrite: rewrite.map { RoundResults.Review.Rewrite(before: $0.0, after: $0.1, reason: $0.2) },
    speechTip: speech)
}

private let tipSteady = "発音・なめらかさ・抑揚ともに安定しています。この調子です。"
private let tipFluency = "言葉の間を短くして、ひと続きで言ってみよう。"
private let tipProsody = "文の終わりを少し下げると、抑揚が伝わりやすくなります。"

extension MockSample {
  static let park: [MockSample] = [
    MockSample(
      content: 76, expression: 70, speaking: 88,
      transcript: "There is a bench in the park. There is a tree. A dog is near the bench.",
      review: mockReview(
        "A dog is near the bench", "犬の位置を、ベンチとの関係で言えています。",
        next: "次は男の子がボールを投げているところを足してみよう。\"A boy is throwing a ball.\"", gain: 10,
        speech: tipSteady)),
    MockSample(
      content: 92, expression: 88, speaking: 85,
      transcript:
        "A little boy is throwing a red ball, and a brown dog is running after it. Behind them, there is a wooden bench under a big tree.",
      review: mockReview(
        "a brown dog is running after it", "犬の動きまで、文でいきいきと伝えられています。",
        next: "文をつなぐ言葉を変えてみよう。\"while\" を使うと、二つの動きを一文で言えます。",
        speech: tipSteady)),
    MockSample(
      content: 84, expression: 78, speaking: 80,
      transcript: "There is a wooden bench under a big tree. A dog is next to the bench, and a boy is playing with a ball.",
      review: mockReview(
        "a wooden bench under a big tree", "ベンチと木の位置関係を一度に言えています。",
        next: "次はボールの色を足してみよう。\"a red ball\"", gain: 5,
        rewrite: ("a boy is playing with a ball", "a boy is about to throw a red ball", "動きを具体的にすると、場面がもっと伝わります。"),
        speech: tipProsody)),
    MockSample(
      content: 65, expression: 72, speaking: 79,
      transcript: "Bench, tree, and, um, dog. A boy... red ball.",
      review: mockReview(
        "red ball", "ボールの色まで見て言えています。",
        next: "次は男の子が何をしているかを文で言ってみよう。\"A boy is throwing a red ball.\"", gain: 10,
        rewrite: ("A boy... red ball.", "A boy has a red ball.", "動詞を入れると文になります。"),
        speech: tipFluency)),
    MockSample(
      content: 88, expression: 82, speaking: 74,
      transcript: "In the park, a boy and his dog are playing with a red ball. An empty bench is under the tree.",
      review: mockReview(
        "a boy and his dog are playing with a red ball", "男の子と犬の関係を一文で言えています。",
        next: "次は犬の色を足してみよう。\"a brown dog\"", gain: 5,
        speech: "“empty” を一音ずつはっきり発音してみよう。")),
    MockSample(
      content: 58, expression: 60, speaking: 66,
      transcript: "A dog. The dog is play. Ball is red.",
      review: mockReview(
        "Ball is red", "ボールの色を文で言えています。",
        next: "次はベンチと木を足してみよう。\"There is a bench under a tree.\"", gain: 10,
        rewrite: ("The dog is play", "The dog is playing", "「is」のあとは -ing の形にします。"),
        speech: tipFluency)),
    MockSample(
      content: 80, expression: 86, speaking: 90,
      transcript: "It's a sunny day. A boy is playing catch with his dog, and the dog looks really happy.",
      review: mockReview(
        "the dog looks really happy", "犬の様子まで、自然な表現で言えています。",
        next: "次は背景のベンチと木を足してみよう。\"near a bench under a tree\"", gain: 10,
        speech: tipSteady)),
    MockSample(
      content: 70, expression: 64, speaking: 72,
      transcript: "I can see a tree and a bench. There is a boy. He has a ball.",
      review: mockReview(
        "I can see a tree and a bench", "見えるものを順に、文で言えています。",
        next: "次は犬を足してみよう。\"A dog is next to the boy.\"", gain: 10,
        rewrite: ("There is a boy. He has a ball.", "There is a boy with a ball.", "二文を一文にまとめると、なめらかになります。"),
        speech: tipProsody)),
  ]

  static let classroom: [MockSample] = [
    MockSample(
      content: 90, expression: 86, speaking: 84,
      transcript:
        "A teacher is pointing at the blackboard, and a boy in a yellow shirt is raising his hand. The other students are writing in their notebooks.",
      review: mockReview(
        "a boy in a yellow shirt is raising his hand", "服の色と動きまで、一文で言えています。",
        next: "次は先生の机の上にある物を足してみよう。\"There is an apple on the desk.\"", gain: 5,
        speech: tipSteady)),
    MockSample(
      content: 74, expression: 70, speaking: 82,
      transcript: "There is a classroom. There are many desks. There is a clock on the wall.",
      review: mockReview(
        "There is a clock on the wall", "時計の場所まで言えています。",
        next: "次は先生が何をしているかを足してみよう。\"A teacher is pointing at the blackboard.\"", gain: 10,
        speech: tipSteady)),
    MockSample(
      content: 62, expression: 64, speaking: 70,
      transcript: "Teacher, blackboard. A boy... hand up. Apple.",
      review: mockReview(
        "hand up", "手を挙げている様子に気づけています。",
        next: "次は先生の動きを文で言ってみよう。\"A teacher is pointing at the blackboard.\"", gain: 10,
        rewrite: ("A boy... hand up.", "A boy is raising his hand.", "動詞を入れると文になります。"),
        speech: tipFluency)),
    MockSample(
      content: 82, expression: 80, speaking: 76,
      transcript: "In the classroom, the teacher is standing by the blackboard. I can see two windows with yellow curtains and a bookshelf.",
      review: mockReview(
        "two windows with yellow curtains", "数と色まで細かく言えています。",
        next: "次は生徒の動きを足してみよう。\"A boy is raising his hand.\"", gain: 10,
        speech: tipProsody)),
  ]

  static let station: [MockSample] = [
    MockSample(
      content: 88, expression: 84, speaking: 86,
      transcript:
        "A woman is walking out of the station with a pink suitcase. A man in a suit is looking at his phone at the bus stop.",
      review: mockReview(
        "A man in a suit is looking at his phone", "男性の服装と動きを一文で言えています。",
        next: "次は黄色いタクシーを足してみよう。\"A yellow taxi is waiting.\"", gain: 8,
        speech: tipSteady)),
    MockSample(
      content: 72, expression: 68, speaking: 80,
      transcript: "There is a station. There is a clock. There is a yellow taxi.",
      review: mockReview(
        "There is a yellow taxi", "タクシーの色まで言えています。",
        next: "次は女性がスーツケースを引いているところを足してみよう。\"A woman is pulling a suitcase.\"", gain: 10,
        rewrite: ("There is a station. There is a clock.", "There is a big clock on the station.", "同じ形が続くときは一文にまとめると自然です。"),
        speech: tipSteady)),
    MockSample(
      content: 60, expression: 62, speaking: 68,
      transcript: "Station, big clock. Taxi is yellow. Man phone.",
      review: mockReview(
        "Taxi is yellow", "タクシーの色を文で言えています。",
        next: "次は女性がスーツケースを引いているところを足してみよう。\"A woman is pulling a suitcase.\"", gain: 10,
        rewrite: ("Man phone.", "A man is looking at his phone.", "誰が何をしているかを文にすると伝わります。"),
        speech: tipFluency)),
    MockSample(
      content: 80, expression: 82, speaking: 74,
      transcript: "In front of the station, there is a red vending machine and a blue bicycle. A taxi is next to the crosswalk.",
      review: mockReview(
        "A taxi is next to the crosswalk", "物の位置の関係を言えています。",
        next: "次はスマホを見ている男性を足してみよう。\"A man is looking at his phone.\"", gain: 10,
        speech: "“vending” を一音ずつはっきり発音してみよう。")),
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
