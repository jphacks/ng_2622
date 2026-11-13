import BackendAPI
import Foundation

/// 苦手の分析を頼む本文（POST /weak-points の WeakPointRequest）を、直近の記録から作る。
/// docs/design/weak-point-analysis.md の 3 章。送るのは文字だけ（録音・名前・記録の ID・日時・場面の ID は送らない）
nonisolated enum WeakPointRequestBuilder {
  /// 本文の大きさの上限（バックエンドの WEAK_POINT_MAX_BODY_BYTES）。超えると 413 になる
  static let maxBytes = 64 * 1024

  /// 作った本文
  struct Built: Sendable {
    let request: Components.Schemas.WeakPointRequest
    /// 送った回の記録の ID（古い順。回の番号 n は 1 から）
    let recordIDs: [String]
    /// 整形しない JSON にした大きさ（送る Client と同じ形）
    let bytes: Int
  }

  /// 欄ごとの長さの上限。ふつうはバックエンドの上限（いちばん緩い段）で収まる。
  /// 収まらないときだけ、次の段に詰めて作り直す（最後の段は、どの記録でも 64 KB に収まる）
  struct Caps: Sendable {
    var rounds = 10
    var claims = 30
    var transcript = 2000
    var quote = 2000
    var item = 100
    var note = 500
    var rewrite = 2000
    var reason = 500
    var text = 500
    var basis = 1000
    var description = 1000
    var missed = 12
    var label = 200
    var accept = 500

    static let levels: [Caps] = [
      Caps(),
      Caps(claims: 15, transcript: 1500, quote: 500, note: 300, rewrite: 800, reason: 300, description: 800, missed: 8),
      Caps(
        claims: 8, transcript: 1000, quote: 300, note: 150, rewrite: 400, reason: 150, text: 300, basis: 500,
        description: 600, missed: 6, label: 100, accept: 300),
      Caps(
        rounds: WeakPointCounts.minimumRecords, claims: 4, transcript: 600, quote: 200, item: 60, note: 0, rewrite: 0,
        reason: 0, text: 150, basis: 300, description: 400, missed: 4, label: 60, accept: 200),
    ]
  }

  /// 本文を作る。recent は直近の回（WeakPointCounts.recent。新しい順）。5 件に満たなければ nil
  static func build(recent: [PlayRecord]) -> Built? {
    guard recent.count >= WeakPointCounts.minimumRecords else { return nil }
    var last: Built?
    for caps in Caps.levels {
      guard let built = try? build(recent: recent, caps: caps) else { continue }
      if built.bytes <= maxBytes { return built }
      last = built
    }
    return last
  }

  /// 送る Client と同じ、整形しない JSON（キーは並べる）
  static func encode(_ request: Components.Schemas.WeakPointRequest) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(request)
  }

  static func build(recent: [PlayRecord], caps: Caps) throws -> Built {
    // 送るのは新しいほうから caps.rounds 件を、古い順に
    let rounds = Array(recent.prefix(caps.rounds).reversed())
    let payload = rounds.enumerated().map { index, record in round(record, n: index + 1, caps: caps) }
    let request = Components.Schemas.WeakPointRequest(rounds: payload, counts: counts(rounds))
    return Built(request: request, recordIDs: rounds.map(\.id), bytes: try encode(request).count)
  }

  // MARK: - 回

  typealias Round = Components.Schemas.WeakPointRequest.RoundsPayloadPayload

  static func round(_ record: PlayRecord, n: Int, caps: Caps) -> Round {
    let result = record.result
    let claims = (result.content?.claims ?? []).prefix(caps.claims).compactMap { c -> Round.ClaimsPayloadPayload? in
      guard let verdict = Round.ClaimsPayloadPayload.VerdictPayload(rawValue: c.verdict) else { return nil }
      return .init(
        quote: clip(c.quote, caps.quote), verdict: verdict, item: c.item.map { clip($0, caps.item) },
        note: caps.note > 0 ? c.note.map { clip($0, caps.note) } : nil)
    }
    let feedback = result.feedback
    let rewrite = caps.rewrite > 0 ? feedback?.rewrite.map {
      Round.RewritePayload(
        before: clip($0.before, caps.rewrite), after: clip($0.after, caps.rewrite), reason: clip($0.reason, caps.reason))
    } : nil
    let nextStep = feedback.flatMap { f in
      Round.NextStepPayload.KindPayload(rawValue: f.nextStep.kind).map {
        Round.NextStepPayload(kind: $0, text: clip(f.nextStep.text, caps.text), item: f.nextStep.item.map { clip($0, caps.item) })
      }
    }
    let basis = feedback?.expressionBasis?.trimmingCharacters(in: .whitespacesAndNewlines)
    // 文字起こしは 1 文字以上と決まっている（空だと 400）。何も言えなかった回は "-" を送る
    let transcript = clip(result.transcript.trimmingCharacters(in: .whitespacesAndNewlines), caps.transcript)
    return Round(
      n: n,
      grade: record.difficulty.flatMap(Round.GradePayload.init(rawValue:)),
      transcript: transcript.isEmpty ? "-" : transcript,
      claims: claims,
      rewrite: rewrite,
      nextStep: nextStep,
      expressionBasis: basis.flatMap { $0.isEmpty ? nil : clip($0, caps.basis) },
      scene: scene(record, caps: caps))
  }

  /// 場面の見本の答えと、言えなかった・一部だけ言えた項目（記録の中の場面の JSON の checklist から accept を引く）
  static func scene(_ record: PlayRecord, caps: Caps) -> Round.ScenePayload {
    let checklist = record.scene["checklist"]?.arrayValue ?? []
    let accepts = Dictionary(
      checklist.compactMap { item in item["id"]?.stringValue.map { ($0, item["accept"]?.stringValue ?? "") } },
      uniquingKeysWith: { first, _ in first })
    let missed = (record.result.content?.items ?? []).compactMap { item -> Round.ScenePayload.MissedItemsPayloadPayload? in
      guard let level = Round.ScenePayload.MissedItemsPayloadPayload.LevelPayload(rawValue: item.level),
        let kind = Components.Schemas.ChecklistKind(rawValue: item.kind)
      else { return nil }
      return .init(
        id: clip(item.id, caps.item), kind: kind, label: clip(item.label, caps.label),
        accept: clip(accepts[item.id] ?? "", caps.accept), level: level)
    }
    return .init(
      description: clip(record.scene["description"]?.stringValue ?? "", caps.description),
      missedItems: Array(missed.prefix(caps.missed)))
  }

  // MARK: - 数えた値

  typealias Counts = Components.Schemas.WeakPointRequest.CountsPayload

  /// 送る回と同じ回で数えた値（4 章。種類の分母が 0 のものは入れない）
  static func counts(_ rounds: [PlayRecord]) -> Counts {
    let counted = WeakPointCounts(records: rounds)
    let kinds = counted.coverage.compactMap { c -> Counts.KindsPayloadPayload? in
      guard c.count > 0, let kind = Components.Schemas.ChecklistKind(rawValue: c.kind.rawValue) else { return nil }
      return .init(kind: kind, earned: c.said, total: c.count)
    }
    let v = counted.verdicts
    let h = counted.halves
    let half = rounds.count / 2
    return Counts(
      rounds: rounds.count, kinds: kinds,
      verdicts: .init(correct: v.correct, contradiction: v.contradiction, absent: v.absent, offtopic: v.offtopic),
      halves: .init(
        first: .init(rounds: half, content: h?.front.content ?? 0, expression: h?.front.expression ?? 0),
        second: .init(rounds: half, content: h?.back.content ?? 0, expression: h?.back.expression ?? 0)))
  }

  /// 長さの上限で切る。長さはバックエンド（zod の max）と同じ UTF-16 の数で数え、文字の途中では切らない
  static func clip(_ text: String, _ limit: Int) -> String {
    guard text.utf16.count > limit else { return text }
    var length = 0
    var end = text.startIndex
    for character in text {
      length += character.utf16.count
      if length > limit { break }
      end = text.index(after: end)
    }
    return String(text[..<end])
  }
}

extension JSONValue {
  nonisolated subscript(key: String) -> JSONValue? {
    if case .object(let object) = self { return object[key] }
    return nil
  }

  nonisolated var stringValue: String? {
    if case .string(let value) = self { return value }
    return nil
  }

  nonisolated var arrayValue: [JSONValue]? {
    if case .array(let value) = self { return value }
    return nil
  }
}
