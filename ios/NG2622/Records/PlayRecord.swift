import Foundation

/// 遊んだ 1 ラウンドの記録（scenenglish.record/1）。docs/design/play-record.md。
/// 遊んだ本人が前のラウンドを場面ごと見返すために、端末の中だけに 1 ラウンド 1 ファイルで残す（PlayRecordStore）。
/// 順位と、ほかの人の結果は入れない
nonisolated struct PlayRecord: Codable, Sendable, Equatable, Identifiable {
  static let protocolName = "scenenglish.record/1"

  /// 形の版。`scenenglish.record/1` 以外は読まない
  let `protocol`: String
  /// 記録の ID。ファイルの名前（<id>.json と <id>.wav）と同じ
  let id: String
  /// 遊んだ日時（ラウンドの回転が始まった時刻）
  let playedAt: Date
  /// 級（eiken-3・eiken-pre2・eiken-2）。場面の配置の difficulty と同じ値。場面に書かれていなければ nil
  let difficulty: String?
  /// 遊んだ場面の配置の JSON（scenenglish.scene/2）をまるごと。作り置きの一覧を入れ替えた後や、
  /// 部屋がその場で作った場面でも、後から同じ 3D と見本の答えを出せるようにする
  let scene: JSONValue
  /// 自分の結果
  let result: Result

  init(id: String, playedAt: Date, difficulty: String?, scene: JSONValue, result: Result) {
    self.protocol = Self.protocolName
    self.id = id
    // ファイルには秒までしか書かないので、読み戻したものと同じになるよう秒にそろえる
    self.playedAt = Date(timeIntervalSince1970: playedAt.timeIntervalSince1970.rounded(.down))
    self.difficulty = difficulty
    self.scene = scene
    self.result = result
  }

  func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(self.protocol, forKey: .protocol)
    try c.encode(id, forKey: .id)
    try c.encode(playedAt, forKey: .playedAt)
    try c.encode(difficulty, forKey: .difficulty)
    try c.encode(scene, forKey: .scene)
    try c.encode(result, forKey: .result)
  }

  /// 自分の結果。バックエンドの results の PlayerResult から、誰か（id・name・color）と順位（rank）を除いた形のまま持つ。
  /// 欄の名前と値は backend/openapi.json の PlayerResult と同じ（null の欄も null のまま書く）。
  /// 種類の値（verdict・level・kind・aspect）は文字のまま持ち、知らない値が増えても記録ごと読めなくならないようにする
  nonisolated struct Result: Codable, Sendable, Equatable {
    /// 文字起こし
    let transcript: String
    let score: Score
    /// 内容の点の内訳。届かなかったときは nil
    let content: Content?
    /// 講評（次の一つ・言い直しの例・話し方のコツ）。届かなかったときは nil
    let feedback: Feedback?

    func encode(to encoder: any Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(transcript, forKey: .transcript)
      try c.encode(score, forKey: .score)
      try c.encode(content, forKey: .content)
      try c.encode(feedback, forKey: .feedback)
    }
  }

  /// 3 つの点（各 0〜100）と、重み付きの合計
  nonisolated struct Score: Codable, Sendable, Equatable {
    let content: Int
    let expression: Int
    /// 話し方
    let speech: Int
    let total: Int
  }

  /// 内容の点の内訳（PlayerContent）
  nonisolated struct Content: Codable, Sendable, Equatable {
    let claims: [Claim]
    let items: [Item]
    let others: Int
    let recall: Recall
    let precision: Precision

    nonisolated struct Claim: Codable, Sendable, Equatable {
      let quote: String
      /// correct・contradiction・absent・offtopic
      let verdict: String
      let item: String?
      /// full・partial
      let level: String?
      let note: String?

      func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(quote, forKey: .quote)
        try c.encode(verdict, forKey: .verdict)
        try c.encode(item, forKey: .item)
        try c.encode(level, forKey: .level)
        try c.encode(note, forKey: .note)
      }
    }

    nonisolated struct Item: Codable, Sendable, Equatable {
      let id: String
      /// center・reason・link・detail
      let kind: String
      let label: String
      /// full・partial・none
      let level: String
    }

    nonisolated struct Recall: Codable, Sendable, Equatable {
      let earned: Double
      let max: Double
    }

    nonisolated struct Precision: Codable, Sendable, Equatable {
      let correct: Int
      let said: Int
    }
  }

  /// 講評（Feedback）
  nonisolated struct Feedback: Codable, Sendable, Equatable {
    let nextStep: NextStep
    /// 言い直しの例。直す所が無ければ nil
    let rewrite: Rewrite?
    let speechTip: SpeechTip

    func encode(to encoder: any Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(nextStep, forKey: .nextStep)
      try c.encode(rewrite, forKey: .rewrite)
      try c.encode(speechTip, forKey: .speechTip)
    }

    nonisolated struct NextStep: Codable, Sendable, Equatable {
      /// content・expression・speech
      let kind: String
      let text: String
      let item: String?
      let gain: Int?

      func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kind, forKey: .kind)
        try c.encode(text, forKey: .text)
        try c.encode(item, forKey: .item)
        try c.encode(gain, forKey: .gain)
      }
    }

    nonisolated struct Rewrite: Codable, Sendable, Equatable {
      let before: String
      let after: String
      let reason: String
    }

    nonisolated struct SpeechTip: Codable, Sendable, Equatable {
      /// accuracy・fluency・prosody
      let aspect: String
      let text: String
    }
  }

  // MARK: - ファイルの中身

  /// 記録の JSON を読む。知らない版の形なら throw する
  static func decode(_ data: Data) throws -> PlayRecord {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let record = try decoder.decode(PlayRecord.self, from: data)
    guard record.protocol == protocolName else {
      throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "知らない形: \(record.protocol)"))
    }
    return record
  }

  /// 記録の JSON にする。日時は ISO 8601（UTC、秒まで）
  func encoded() throws -> Data {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(self)
  }

  // MARK: - 場面

  /// 記録の場面を、アプリが並べる配置として読む（SceneLibrary.instance(composing:) に渡すと同じ 3D を出せる）。
  /// 知らない版の場面なら throw する
  func sceneLayout() throws -> SceneLayout {
    try SceneLayout.decode(JSONEncoder().encode(scene))
  }
}

// MARK: - 結果の画面の形との行き来

extension PlayRecord {
  /// ラウンドの結果から、自分の記録を作る。自分が採点できなかった（点が無い）ときは nil（記録を残さない）
  @MainActor
  init?(id: String, playedAt: Date, scene: SceneDocument, results: RoundResults) throws {
    guard let me = results.me, let result = Result(me, review: results.myReview) else { return nil }
    self.init(
      id: id, playedAt: playedAt, difficulty: scene.layout.difficulty?.rawValue, scene: try JSONValue(data: scene.data),
      result: result)
  }

  /// 振り返りの画面に渡す形。自分 1 人だけの結果にする（順位は出せない）。
  /// 場面の名前は記録の場面から取る。知らない種類の値は、届いたときと同じ読み替えをする（LiveRoomTracker）
  @MainActor
  var results: RoundResults {
    let layout = try? sceneLayout()
    let me = PlayerResult(
      id: id, name: "", color: 0, isSelf: true,
      score: PlayerResult.Score(
        content: result.score.content, expression: result.score.expression, speaking: result.score.speech,
        total: result.score.total),
      transcript: result.transcript, content: result.content.map(ContentBreakdown.init))
    return RoundResults(
      sceneID: layout?.id ?? id, sceneName: layout?.name ?? "", players: [me],
      myReview: result.feedback.map(RoundResults.Review.init))
  }
}

extension PlayRecord.Result {
  /// 採点できなかった人（点が無い）は nil
  @MainActor
  init?(_ player: PlayerResult, review: RoundResults.Review?) {
    guard let score = player.score else { return nil }
    self.init(
      transcript: player.transcript,
      score: .init(content: score.content, expression: score.expression, speech: score.speaking, total: score.total),
      content: player.content.map(PlayRecord.Content.init),
      feedback: review.map(PlayRecord.Feedback.init))
  }
}

extension PlayRecord.Content {
  @MainActor
  init(_ content: ContentBreakdown) {
    self.init(
      claims: content.claims.map {
        .init(quote: $0.quote, verdict: $0.verdict.rawValue, item: $0.item, level: $0.level?.rawValue, note: $0.note)
      },
      items: content.items.map { .init(id: $0.id, kind: $0.kind.rawValue, label: $0.label, level: $0.level.rawValue) },
      others: content.others,
      recall: .init(earned: content.recall.earned, max: content.recall.max),
      precision: .init(correct: content.precision.correct, said: content.precision.said))
  }
}

extension PlayRecord.Feedback {
  @MainActor
  init(_ review: RoundResults.Review) {
    self.init(
      nextStep: .init(
        kind: review.nextStep.kind.rawValue, text: review.nextStep.text, item: review.nextStep.item,
        gain: review.nextStep.gain),
      rewrite: review.rewrite.map { .init(before: $0.before, after: $0.after, reason: $0.reason) },
      speechTip: .init(aspect: review.speechTip.aspect.rawValue, text: review.speechTip.text))
  }
}

extension ContentBreakdown {
  /// 記録の内訳から。読み替えられない描写や項目は飛ばす（届いたときと同じ）
  init(_ content: PlayRecord.Content) {
    self.init(
      claims: content.claims.compactMap { c in
        guard let verdict = Claim.Verdict(rawValue: c.verdict) else { return nil }
        return Claim(
          quote: c.quote, verdict: verdict, item: c.item, level: c.level.flatMap(Level.init), note: c.note)
      },
      items: content.items.compactMap { i in
        guard let kind = ChecklistKind(rawValue: i.kind), let level = Level(rawValue: i.level) else { return nil }
        return Item(id: i.id, kind: kind, label: i.label, level: level)
      },
      others: content.others,
      recall: Recall(earned: content.recall.earned, max: content.recall.max),
      precision: Precision(correct: content.precision.correct, said: content.precision.said))
  }
}

extension RoundResults.Review {
  init(_ feedback: PlayRecord.Feedback) {
    self.init(
      nextStep: NextStep(
        kind: NextStep.Kind(rawValue: feedback.nextStep.kind) ?? .content, text: feedback.nextStep.text,
        item: feedback.nextStep.item, gain: feedback.nextStep.gain),
      rewrite: feedback.rewrite.map { Rewrite(before: $0.before, after: $0.after, reason: $0.reason) },
      speechTip: SpeechTip(
        aspect: SpeechTip.Aspect(rawValue: feedback.speechTip.aspect) ?? .fluency, text: feedback.speechTip.text))
  }
}
