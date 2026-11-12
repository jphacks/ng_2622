import Foundation

extension RoundResults {
  /// 仮の結果。シーンと、参加者の名前・色・自分かどうか・採点できたかを受け取り、
  /// 場面のチェックリストと見本の答え（同梱の配置の JSON）から、描写・項目の達成・点数・講評を作る。
  /// 自分は振り返りの部品（下線・チップ・見本の印・合わない描写・次の一つ・言い直し・話し方の一言）が全部出る例にし、
  /// ほかの人は並び順で、項目が少ない例・3 語未満の例・合わない描写の無い例を順に割り当てる
  static func mock(
    sceneID: String,
    players: [(id: String, name: String, color: UInt32, isSelf: Bool, graded: Bool)],
    layout: SceneLayout? = nil
  ) -> RoundResults {
    let layout = layout ?? (try? MockSceneLayoutClient.read(sceneID))
    let checklist = layout?.checklist ?? []
    var graded: [PlayerResult] = []
    var ungraded: [PlayerResult] = []
    var myReview: Review?
    var otherIndex = 0

    for p in players {
      guard p.graded else {
        ungraded.append(
          PlayerResult(id: p.id, name: p.name, color: p.color, isSelf: p.isSelf, score: nil, transcript: "", content: nil))
        continue
      }
      let variant: MockVariant
      if p.isSelf {
        variant = .rich
      } else {
        variant = MockVariant.others[otherIndex % MockVariant.others.count]
        otherIndex += 1
      }
      let sample = MockSample(variant: variant, checklist: checklist)
      graded.append(
        PlayerResult(
          id: p.id, name: p.name, color: p.color, isSelf: p.isSelf, score: sample.score, transcript: sample.transcript,
          content: sample.content))
      if p.isSelf { myReview = sample.review }
    }

    // 点数の高い順。採点できなかった人は最後
    graded.sort { ($0.score?.total ?? 0) > ($1.score?.total ?? 0) }
    return RoundResults(
      sceneID: sceneID, sceneName: layout?.name ?? SceneLayouts.store.name(of: sceneID) ?? sceneID,
      players: graded + ungraded, myReview: myReview)
  }
}

/// 仮の結果の作り方
private enum MockVariant {
  /// ほとんど言えた。一部・言えていない項目、おまけ、場面に無い物が 1 つずつ
  case rich
  /// 半分ほど言えた。場面と矛盾する描写が 1 つ
  case half
  /// 3 語未満
  case short
  /// 合わない描写なし。理由が一部だけ
  case clean

  static let others: [MockVariant] = [.half, .short, .clean]
}

private struct MockSample {
  let transcript: String
  let content: ContentBreakdown
  let score: PlayerResult.Score
  let review: RoundResults.Review

  init(variant: MockVariant, checklist: [SceneLayout.ChecklistItem]) {
    var levels: [String: ContentBreakdown.Level] = [:]
    var claims: [ContentBreakdown.Claim] = []
    let n = checklist.count
    // 一部にする項目（理由・つながりがあればそれ）と、言えていない項目（最後の中心か、最後の項目）
    let partialID = (checklist.first { $0.kind == .reason || $0.kind == .link } ?? checklist.dropFirst().first)?.id
    let missingID = checklist.last { $0.kind == .center && $0.id != partialID }?.id ?? checklist.last?.id

    func say(_ item: SceneLayout.ChecklistItem, _ level: ContentBreakdown.Level) {
      levels[item.id] = level
      let quote = level == .partial ? Self.partialQuote(item.firstAccept) : Self.sentence(item.firstAccept)
      claims.append(.init(quote: quote, verdict: .correct, item: item.id, level: level, note: nil))
    }
    let bonus = ContentBreakdown.Claim(
      quote: "There are some people here.", verdict: .correct, item: nil, level: nil, note: nil)
    let absent = ContentBreakdown.Claim(
      quote: "A cat is under the bench.", verdict: .absent, item: nil, level: nil, note: "場面に猫はいません。")
    let contradiction = ContentBreakdown.Claim(
      quote: "It is night.", verdict: .contradiction, item: nil, level: nil, note: "場面は昼です。")

    var expression = 78
    var speaking = 80
    var nextStep: RoundResults.Review.NextStep
    var rewrite: RoundResults.Review.Rewrite?
    var tip: RoundResults.Review.SpeechTip
    var shortText: String?
    // 表現の点の根拠（バックエンドでは採点の Claude が書く英語 1 文）
    var basis: String

    switch variant {
    case .rich:
      claims.append(bonus)
      for item in checklist where item.id != missingID {
        say(item, item.id == partialID ? .partial : .full)
        // 2 つ目の描写のあとに、場面に無い物を言う
        if claims.count == 3 { claims.append(absent) }
      }
      if let partial = checklist.first(where: { $0.id == partialID }) {
        rewrite = .init(
          before: Self.partialQuote(partial.firstAccept), after: Self.sentence(partial.firstAccept),
          reason: partial.firstAccept.contains("because") ? "because の後ろに、場面で見える理由を言おう。" : "動きをくわしく言うと、場面がもっと伝わります。")
      }
      nextStep = Self.contentStep(checklist.first { $0.id == missingID }, gain: 6)
      tip = .init(aspect: .fluency, text: "文と文の間で止まりすぎないように、続けて言ってみよう。")
      basis = "Uses the present continuous correctly, but one sentence is unfinished."
    case .half:
      for (i, item) in checklist.enumerated() where i < max(1, n / 2) { say(item, .full) }
      claims.insert(contradiction, at: min(1, claims.count))
      expression = 70
      speaking = 86
      nextStep = Self.contentStep(checklist.dropFirst(max(1, n / 2)).first, gain: 9)
      tip = .init(aspect: .prosody, text: "文の終わりを少し下げると、抑揚が伝わりやすくなります。")
      basis = "Uses short present continuous sentences correctly."
    case .short:
      // 3 語未満はバックエンドが Claude を呼ばず、内容・表現を 0 点にする（docs/design/usecase.md）
      shortText = "A girl."
      expression = 0
      speaking = 55
      nextStep = .init(kind: .content, text: "もう少し長く、文にして話してみよう。", item: nil, gain: nil)
      tip = .init(aspect: .accuracy, text: "一語ずつ、はっきり発音してみよう。")
      // 3 語未満はバックエンドが Claude を呼ばないので、根拠は空
      basis = ""
    case .clean:
      for item in checklist { say(item, item.id == partialID ? .partial : .full) }
      expression = 64
      speaking = 74
      rewrite = .init(
        before: "There is a boy. He is running.", after: "A boy is running.", reason: "二文を一文にまとめると、なめらかになります。")
      nextStep = .init(kind: .expression, text: "二つの文を and や because でつないでみよう。", item: nil, gain: nil)
      tip = .init(aspect: .accuracy, text: "“th” の音を、舌を歯にあてて言ってみよう。")
      basis = "Uses there is and the present continuous correctly, but repeats short sentences."
    }

    let items = checklist.map { ContentBreakdown.Item(id: $0.id, kind: $0.kind, label: $0.label, level: levels[$0.id] ?? .none) }
    // 言えた重み: 中心・理由・つながり 2、細部 1、一部は半分、おまけ 1 件 0.5（満点で頭打ち）
    let weight: (SceneLayout.ChecklistItem) -> Double = { $0.kind == .detail ? 1 : 2 }
    let maxWeight = checklist.map(weight).reduce(0, +)
    let others = claims.filter { $0.verdict == .correct && $0.item == nil }.count
    let earned = Swift.min(
      maxWeight,
      checklist.map { item -> Double in
        switch levels[item.id] ?? .none {
        case .full: weight(item)
        case .partial: weight(item) / 2
        case .none: 0
        }
      }.reduce(0, +) + Double(others) * 0.5)
    let correct = claims.filter { $0.verdict == .correct }.count
    content = ContentBreakdown(
      claims: claims, items: items, others: others, recall: .init(earned: earned, max: maxWeight),
      precision: .init(correct: correct, said: claims.count))
    let r = maxWeight > 0 ? earned / maxWeight : 0
    let p = claims.isEmpty ? 0 : Double(correct) / Double(claims.count)
    let contentScore = p + r > 0 ? Int((100 * 2 * p * r / (p + r)).rounded()) : 0
    let total =
      (Double(contentScore * RoundResults.Weights.content + expression * RoundResults.Weights.expression
        + speaking * RoundResults.Weights.speech) / 100).rounded()
    score = .init(content: contentScore, expression: expression, speaking: speaking, total: Int(total))
    transcript = shortText ?? claims.map(\.quote).joined(separator: " ")
    review = .init(nextStep: nextStep, rewrite: rewrite, speechTip: tip, expressionBasis: basis)
  }

  static func contentStep(_ item: SceneLayout.ChecklistItem?, gain: Int) -> RoundResults.Review.NextStep {
    guard let item else {
      return .init(kind: .expression, text: "文をつなぐ言葉を変えてみよう。", item: nil, gain: nil)
    }
    return .init(kind: .content, text: "次は「\(item.label)」を足してみよう。", item: item.id, gain: gain)
  }

  /// 文の頭を大文字にして、終わりに . を付ける
  static func sentence(_ phrase: String) -> String {
    phrase.prefix(1).uppercased() + phrase.dropFirst() + "."
  }

  /// 一部だけ言えた言い方。理由（because のあと）があれば理由をぼかし、無ければ後ろを削る
  static func partialQuote(_ phrase: String) -> String {
    if let r = phrase.range(of: " because ") {
      return sentence(String(phrase[..<r.lowerBound]) + " because he wants to")
    }
    let words = phrase.split(separator: " ")
    return sentence(words.prefix(Swift.max(3, words.count - 2)).joined(separator: " "))
  }
}

extension RoundResults {
  /// プレビュー用の場面（同梱の作り置きの、最初の難易度の出題の候補）
  private static var previewSceneID: String {
    ScenePool.bundled.candidates(of: .eikenPre2).first ?? ScenePool.bundled.randomCandidate() ?? ""
  }

  /// プレビュー用（5 人、全員採点できた）
  static var previewFive: RoundResults {
    .mock(
      sceneID: previewSceneID,
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
      sceneID: previewSceneID,
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
      sceneID: previewSceneID,
      players: [
        ("me", "ゆうき", 0x5B5BE6, true, false),
        ("p0", "たろう", 0xF29A3A, false, true),
        ("p1", "はなこ", 0xB06AD9, false, true),
      ])
  }
}
