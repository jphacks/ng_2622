import BackendAPI
import Foundation

/// 苦手の場面（POST /weak-scenes で作った、その人の苦手を練習する場面）。docs/design/part-generation.md。
/// 端末には、元にした AI の分析と一緒に覚える（WeakSceneStore）。部屋の start の sceneId に sceneId を送ると、この場面で遊べる
nonisolated struct WeakScene: Codable, Sendable, Equatable {
  /// 場面の ID（weak- ＋ uuid）
  let sceneId: String
  /// 場面の名前（日本語）
  let name: String
  /// 級（eiken-3・eiken-pre2・eiken-2）
  let difficulty: String
  /// 実際に狙った項目の種類（center・reason・link・detail）
  let focus: String
  /// 場面の一言（日本語。例: because で理由を言いやすい場面です）
  let pitch: String
  /// 配置の JSON（scenenglish.scene/2）をまるごと。その場で作った部品は part が id@版
  let layout: JSONValue
  /// その場で作った部品の id@版
  let createdParts: [String]

  /// 配置の JSON（届いたままの中身と、読んだ配置）。知らない版の形なら throw する
  func document() throws -> SceneDocument {
    try SceneDocument(data: JSONEncoder().encode(layout))
  }
}

/// 端末に覚える苦手の場面（scenenglish.weakscene/1）。作ったときの区切り（stage）と、返った場面（scene）を持つ。
/// 場面は区切り（内容の内訳のある記録の数 ÷ 5 の商）ごとに 1 つだけ作る（2026-11-14 指揮役が決めた）
nonisolated struct SavedWeakScene: Codable, Sendable, Equatable {
  static let protocolName = "scenenglish.weakscene/1"

  /// 形の版。知らない版のファイルは読まずに作り直す
  let `protocol`: String
  /// 場面を受け取った日時
  let createdAt: Date
  /// 作ったときの区切り（内容の内訳のある記録の数 ÷ 5 の商。WeakSceneMaker.stage）
  let stage: Int
  /// 返った場面
  let scene: WeakScene

  init(createdAt: Date, stage: Int, scene: WeakScene) {
    self.protocol = Self.protocolName
    // ファイルには秒までしか書かないので、読み戻したものと同じになるよう秒にそろえる
    self.createdAt = Date(timeIntervalSince1970: createdAt.timeIntervalSince1970.rounded(.down))
    self.stage = stage
    self.scene = scene
  }

  func encoded() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    encoder.dateEncodingStrategy = .iso8601
    return try encoder.encode(self)
  }

  /// 読む。知らない版（protocol）は読まない
  static func decode(_ data: Data) throws -> SavedWeakScene {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let saved = try decoder.decode(SavedWeakScene.self, from: data)
    guard saved.protocol == protocolName else {
      throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "知らない形: \(saved.protocol)"))
    }
    return saved
  }
}

/// 苦手の場面を 1 つだけ覚える所。分析と同じフォルダ（Application Support の analysis/）の weak-scene.json。
/// 分析を忘れる（WeakPointStore.delete はフォルダごと消す）と、場面も一緒に消える
nonisolated struct WeakSceneStore: Sendable {
  let directory: URL

  /// アプリが使う所（分析と同じフォルダ）
  @MainActor static let app = WeakSceneStore(directory: WeakPointStore.app.directory)

  var fileURL: URL { directory.appending(path: "weak-scene.json", directoryHint: .notDirectory) }

  /// 覚えている場面。無い・読めない・知らない版なら nil
  func load() -> SavedWeakScene? {
    guard let data = try? Data(contentsOf: fileURL) else { return nil }
    do {
      return try SavedWeakScene.decode(data)
    } catch {
      recordLog.notice("苦手の場面を読めませんでした: \(error, privacy: .public)")
      return nil
    }
  }

  /// 覚えるか、入れ替える。一時のファイルに書いてから置き換える。端末のバックアップには入れない
  func save(_ saved: SavedWeakScene) throws {
    var directory = directory
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
    try saved.encoded().write(to: fileURL, options: .atomic)
  }

  /// 忘れる（このファイルだけ消す）
  func delete() throws {
    guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
    try FileManager.default.removeItem(at: fileURL)
  }
}

/// 苦手の場面を頼む本文（POST /weak-scenes の WeakSceneRequest）を、AI の分析と直近の記録から作る。
/// 送るのは、級・苦手の種類・癖の題と直し方・次に試すことだけ（自分の文の引用・癖の説明・録音・名前は送らない）。
/// AI の分析を作れなかったときは、級と種類だけを送る
nonisolated enum WeakSceneRequestBuilder {
  /// 欄の長さの上限（バックエンドの zod の max。超えると 400）
  static let titleLimit = 80
  static let fixLimit = 200
  static let nextTryLimit = 200
  /// 送る癖の数の上限
  static let maxHabits = 3

  /// 本文を作る。recent は直近の回（WeakPointCounts.recent。新しい順）。analysis が nil（分析を作れなかった）なら、
  /// 癖と次に試すことは付けない。数えられる種類が無ければ nil
  static func build(analysis: WeakPointAnalysis?, recent: [PlayRecord]) -> Components.Schemas.WeakSceneRequest? {
    let kinds = kinds(WeakPointCounts(records: recent).coverage)
      .compactMap { Components.Schemas.ChecklistKind(rawValue: $0.rawValue) }
    guard !kinds.isEmpty else { return nil }
    let habits = (analysis?.result.habits ?? []).compactMap { h -> Components.Schemas.WeakSceneHabit? in
      guard let viewpoint = Components.Schemas.WeakPointViewpoint(rawValue: h.viewpoint),
        let title = text(h.title, titleLimit), let fix = text(h.fix, fixLimit)
      else { return nil }
      return .init(viewpoint: viewpoint, title: title, fix: fix)
    }
    let nextTry = analysis?.result.nextTry.flatMap { n -> Components.Schemas.WeakSceneNextTry? in
      guard let viewpoint = Components.Schemas.WeakPointViewpoint(rawValue: n.viewpoint),
        let text = text(n.text, nextTryLimit)
      else { return nil }
      return .init(viewpoint: viewpoint, text: text)
    }
    let grade = Components.Schemas.Difficulty(rawValue: difficulty(recent).rawValue) ?? .eiken3
    return .init(
      difficulty: grade, kinds: kinds, habits: habits.isEmpty ? nil : Array(habits.prefix(maxHabits)), nextTry: nextTry)
  }

  /// 項目の種類を、言えた割合の低い順に（分母 0 の種類は除く。同じ割合なら 中心 → 理由 → つながり → 細部 の順）
  static func kinds(_ coverage: [KindCoverage]) -> [ChecklistKind] {
    coverage.enumerated()
      .compactMap { index, c in c.rate.map { (rate: $0, index: index, kind: c.kind) } }
      .sorted { ($0.rate, $0.index) < ($1.rate, $1.index) }
      .map(\.kind)
  }

  /// その人の直近の記録の級。級の分かる記録が無ければ 3 級（かんたん）
  static func difficulty(_ recent: [PlayRecord]) -> SceneDifficulty {
    recent.sorted { WeakPointCounts.olderFirst($1, $0) }.lazy.compactMap { $0.difficulty.flatMap(SceneDifficulty.init) }
      .first ?? .eiken3
  }

  /// 前後の空白を除き、上限で切る。空なら nil（1 文字以上と決まっている）
  static func text(_ value: String, _ limit: Int) -> String? {
    let trimmed = WeakPointRequestBuilder.clip(value.trimmingCharacters(in: .whitespacesAndNewlines), limit)
    return trimmed.isEmpty ? nil : trimmed
  }
}
