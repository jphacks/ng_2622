import BackendAPI
import Foundation

/// 端末に覚える AI の苦手の分析（scenenglish.weakpoints/1）。docs/design/weak-point-analysis.md の 7 章。
/// 覚えるのは記録から作り直せる AI の結果の控えだけで、数える分析は覚えない（毎回記録から数える）。
/// 実例と良くなった点の回の番号（n）は、覚えるときに記録の ID に置き換える
nonisolated struct WeakPointAnalysis: Codable, Sendable, Equatable {
  static let protocolName = "scenenglish.weakpoints/1"

  /// 形の版。知らない版のファイルは読まずに作り直す
  let `protocol`: String
  /// 作った日時
  let createdAt: Date
  /// 分析の元にした記録の ID（古い順）
  let basedOn: [String]
  let result: Result

  nonisolated struct Result: Codable, Sendable, Equatable {
    /// くり返す癖（0〜3 件）
    let habits: [Habit]
    /// 前より良くなった点。無ければ nil（欄を出さない）
    let improvement: Improvement?
    /// 次の 1 回で試すこと。無ければ nil（数える分析の代わりを出す）
    let nextTry: NextTry?
  }

  nonisolated struct Habit: Codable, Sendable, Equatable {
    /// content（内容）・expression（表現）
    let viewpoint: String
    let title: String
    let what: String
    let examples: [Quote]
    let fix: String
  }

  nonisolated struct Improvement: Codable, Sendable, Equatable {
    let viewpoint: String
    let text: String
    let example: Quote
  }

  nonisolated struct NextTry: Codable, Sendable, Equatable {
    let viewpoint: String
    let text: String
  }

  /// 自分の文の引用。record は記録の ID
  nonisolated struct Quote: Codable, Sendable, Equatable {
    let record: String
    let quote: String
  }

  init(createdAt: Date, basedOn: [String], result: Result) {
    self.protocol = Self.protocolName
    // ファイルには秒までしか書かないので、読み戻したものと同じになるよう秒にそろえる
    self.createdAt = Date(timeIntervalSince1970: createdAt.timeIntervalSince1970.rounded(.down))
    self.basedOn = basedOn
    self.result = result
  }

  /// 返った分析から作る。basedOn は送った回の記録の ID（古い順。回の番号 n は 1 から）。
  /// 番号が範囲の外の実例は捨て、実例が無くなった癖と良くなった点は出さない
  init(_ response: Components.Schemas.WeakPointResponse, basedOn: [String], createdAt: Date) {
    func quote(_ q: Components.Schemas.WeakPointQuote) -> Quote? {
      basedOn.indices.contains(q.n - 1) ? Quote(record: basedOn[q.n - 1], quote: q.quote) : nil
    }
    let habits = response.habits.compactMap { h -> Habit? in
      let examples = h.examples.compactMap(quote)
      guard !examples.isEmpty else { return nil }
      return Habit(viewpoint: h.viewpoint.rawValue, title: h.title, what: h.what, examples: examples, fix: h.fix)
    }
    let improvement = response.improvement.flatMap { i in
      quote(i.value1.example).map { Improvement(viewpoint: i.value1.viewpoint.rawValue, text: i.value1.text, example: $0) }
    }
    let nextTry = response.nextTry.map { NextTry(viewpoint: $0.value1.viewpoint.rawValue, text: $0.value1.text) }
    self.init(
      createdAt: createdAt, basedOn: basedOn,
      result: Result(habits: habits, improvement: improvement, nextTry: nextTry))
  }

  /// 元にした記録が全部残っているか（引用の元が無い分析は出さない）
  func isUsable(existing: Set<String>) -> Bool {
    `protocol` == Self.protocolName && !basedOn.isEmpty && basedOn.allSatisfy(existing.contains)
  }

  /// 作り直すか。直近の回（R）に basedOn に無い記録がある（記録が増えた）、または basedOn の記録が 1 つでも消えた
  func needsRebuild(recent: [PlayRecord], existing: Set<String>) -> Bool {
    let based = Set(basedOn)
    return recent.contains { !based.contains($0.id) } || !isUsable(existing: existing)
  }

  // MARK: - ファイルの中身

  func encoded() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    encoder.dateEncodingStrategy = .iso8601
    return try encoder.encode(self)
  }

  /// 読む。知らない版（protocol）は読まない
  static func decode(_ data: Data) throws -> WeakPointAnalysis {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let analysis = try decoder.decode(WeakPointAnalysis.self, from: data)
    guard analysis.protocol == protocolName else {
      throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "知らない形: \(analysis.protocol)"))
    }
    return analysis
  }
}

/// 分析を 1 つだけ覚える所。アプリ用の領域（Application Support）の下の analysis/weak-points.json。
/// 記録の records/ とは分ける。端末のバックアップには入れない（記録と同じ）
nonisolated struct WeakPointStore: Sendable {
  /// 分析を置くフォルダ
  let directory: URL

  static let shared = WeakPointStore(
    directory: URL.applicationSupportDirectory.appending(path: "analysis", directoryHint: .isDirectory))

  /// アプリが使う所。Mock で端末に保存した記録を読まないとき（UI テスト。-MockIgnoresSavedRecords）は、
  /// 記録と同じく、端末に覚えた分析にも触れない別のフォルダにする
  @MainActor static let app =
    AppConfig.current.mockIgnoresSavedRecords
    ? WeakPointStore(directory: URL.temporaryDirectory.appending(path: "analysis-ignored", directoryHint: .isDirectory))
    : shared

  /// テスト用。一時フォルダの下に置く
  static func temporary() -> WeakPointStore {
    WeakPointStore(directory: FileManager.default.temporaryDirectory.appending(path: "analysis-\(UUID().uuidString)"))
  }

  var fileURL: URL { directory.appending(path: "weak-points.json", directoryHint: .notDirectory) }

  /// 覚えている分析。無い・読めない・知らない版なら nil
  func load() -> WeakPointAnalysis? {
    guard let data = try? Data(contentsOf: fileURL) else { return nil }
    do {
      return try WeakPointAnalysis.decode(data)
    } catch {
      recordLog.notice("苦手の分析を読めませんでした: \(error, privacy: .public)")
      return nil
    }
  }

  /// 覚えるか、入れ替える。一時のファイルに書いてから置き換えるので、途中で止まっても前の分析は壊れない
  func save(_ analysis: WeakPointAnalysis) throws {
    var directory = directory
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
    try analysis.encoded().write(to: fileURL, options: .atomic)
  }

  /// 分析のファイルがあるか
  func exists() -> Bool {
    FileManager.default.fileExists(atPath: fileURL.path)
  }

  /// 忘れる（フォルダごと消す）
  func delete() throws {
    guard FileManager.default.fileExists(atPath: directory.path) else { return }
    try FileManager.default.removeItem(at: directory)
  }
}
