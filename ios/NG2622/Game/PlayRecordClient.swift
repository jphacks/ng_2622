import BackendAPI
import Foundation

/// きろくの 1 ラウンド分。遊んだ本人が、点数と話した量の推移と、過去の振り返りを見返すのに使う
struct PlayRecord: Identifiable, Sendable, Equatable {
  let id: Int
  /// 採点できた日時
  let playedAt: Date
  let sceneID: String
  /// 文字起こしの語数
  let words: Int
  /// 遊んだときの場面の配置（名前・級・見本の答え・チェックリスト）。読めなければ nil
  let layout: SceneLayout?
  /// 自分の点数・文字起こし・内容の内訳
  let me: PlayerResult
  let review: RoundResults.Review

  var sceneName: String { layout?.name ?? sceneID }
  var difficulty: SceneDifficulty? { layout?.difficulty }

  /// 振り返りの画面に渡す形。自分 1 人だけの結果にする（順位は出さない）
  var results: RoundResults {
    RoundResults(sceneID: sceneID, sceneName: sceneName, players: [me], myReview: review)
  }
}

/// 自分のきろくを取る口。新しい順に返す
protocol PlayRecordClient: AnyObject {
  func myRecords() async throws -> [PlayRecord]
}

enum PlayRecords {
  /// アプリ全体で使う口。Live で URL があればバックエンドから、それ以外は仮のデータ
  static let client: any PlayRecordClient = {
    let config = AppConfig.current
    if config.mode == .live, let url = config.backendURL {
      return HTTPPlayRecordClient(baseURL: url)
    }
    return MockPlayRecordClient.shared
  }()
}

/// 本物のバックエンドにつなぐ（GET /records/mine）。端末の ID は場面の評価と同じもの
final class HTTPPlayRecordClient: PlayRecordClient {
  private let baseURL: URL

  init(baseURL: URL) {
    self.baseURL = baseURL
  }

  func myRecords() async throws -> [PlayRecord] {
    let output = try await APIClient.make(url: baseURL).listMyRecords(
      headers: .init(xDeviceId: SceneReviews.reviewerID))
    guard case .ok(let ok) = output else { throw GameError.connectionFailed }
    return try ok.body.json.records.map(PlayRecord.init)
  }
}

extension PlayRecord {
  init(_ record: Components.Schemas.PlayRecord) {
    // 配置は振り返りの画面と同じ読み方（SceneLayout.decode）で読むため、JSON に戻してから読む
    let layout = (try? JSONEncoder().encode(record.layout)).flatMap { try? SceneLayout.decode($0) }
    let score = record.score
    self.init(
      id: record.id, playedAt: record.playedAt, sceneID: record.sceneId, words: record.words, layout: layout,
      me: PlayerResult(
        id: "me", name: "", color: 0, isSelf: true,
        score: PlayerResult.Score(
          content: score.content, expression: score.expression, speaking: score.speech, total: score.total),
        transcript: record.transcript, content: ContentBreakdown(record.content)),
      review: RoundResults.Review(record.feedback))
  }
}

/// きろくの推移の数え方（グラフの見出しの「最初 → 最近」と、遊んだ日数）
enum RecordTrend {
  /// 最初と最近の平均に使うラウンドの数
  static let window = 3

  /// 古い順の値から、最初の window 回と最近の window 回の平均を出す。
  /// 2 × window 回に満たないときは、重ならないよう半分ずつにする。1 回だけなら最近は nil
  static func firstAndRecent(_ values: [Double], window: Int = window) -> (first: Double, recent: Double?)? {
    guard !values.isEmpty else { return nil }
    let n = values.count < 2 * window ? values.count / 2 : window
    guard n > 0 else { return (values[0], nil) }
    let mean = { (slice: ArraySlice<Double>) in slice.reduce(0, +) / Double(slice.count) }
    return (mean(values.prefix(n)), mean(values.suffix(n)))
  }

  /// 遊んだ日の数（端末の暦で数える）
  static func days(_ records: [PlayRecord], calendar: Calendar = .current) -> Int {
    Set(records.map { calendar.startOfDay(for: $0.playedAt) }).count
  }
}

/// 仮のデータ。2 週間分ほどの例のきろくを初めから持ち、Mock で遊んだ回を足していく（アプリを閉じると消える）
final class MockPlayRecordClient: PlayRecordClient {
  static let shared = MockPlayRecordClient()

  private var played: [PlayRecord] = []
  private lazy var samples: [PlayRecord] = Self.makeSamples()

  func myRecords() async throws -> [PlayRecord] {
    played + samples
  }

  /// Mock のラウンドが終わったら、自分が採点できていれば足す
  func append(_ results: RoundResults, layout: SceneLayout?) {
    guard let me = results.me, me.score != nil, let review = results.myReview else { return }
    let record = PlayRecord(
      id: 10_000 + played.count, playedAt: .now, sceneID: results.sceneID,
      words: me.transcript.split(whereSeparator: \.isWhitespace).count, layout: layout, me: me, review: review)
    played.insert(record, at: 0)
  }

  /// 例のきろく。12 日間で 14 ラウンド、合計点と語数が少しずつ上がる
  private static func makeSamples(now: Date = .now) -> [PlayRecord] {
    let totals = [52, 55, 50, 58, 61, 60, 64, 63, 68, 70, 67, 74, 71, 78]
    let words = [8, 10, 9, 11, 12, 11, 13, 14, 13, 15, 16, 15, 17, 19]
    let dayOffsets = [12, 12, 11, 10, 9, 9, 8, 6, 5, 4, 3, 2, 1, 0]
    let sceneIDs = SceneDifficulty.allCases.flatMap { ScenePool.bundled.scenes[$0] ?? [] }
    guard !sceneIDs.isEmpty else { return [] }
    let calendar = Calendar.current
    let records = totals.indices.compactMap { i -> PlayRecord? in
      let sceneID = sceneIDs[i % sceneIDs.count]
      let layout = try? MockSceneLayoutClient.read(sceneID)
      let results = RoundResults.mock(
        sceneID: sceneID, players: [(id: "me", name: "", color: 0, isSelf: true, graded: true)], layout: layout)
      guard let sample = results.me, let review = results.myReview else { return nil }
      let total = totals[i]
      let me = PlayerResult(
        id: "me", name: "", color: 0, isSelf: true,
        score: PlayerResult.Score(
          content: min(100, total + 4), expression: max(0, total - 6), speaking: total, total: total),
        transcript: sample.transcript, content: sample.content)
      let day = calendar.date(byAdding: .day, value: -dayOffsets[i], to: now) ?? now
      return PlayRecord(
        id: i + 1, playedAt: day.addingTimeInterval(Double(i % 2) * -1800), sceneID: sceneID, words: words[i],
        layout: layout, me: me, review: review)
    }
    return records.reversed()
  }
}
