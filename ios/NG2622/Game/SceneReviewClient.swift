import Foundation

/// シーンの評価（★とコメント）をやりとりする口。バックエンドの /scenes に合わせる。
/// 部屋とは関係なく、シーンごとに全員の評価がたまる
protocol SceneReviewClient: AnyObject {
  /// シーンごとの★の平均と人数（GET /scenes）。キーはシーンの ID
  func ratings() async throws -> [String: SceneRating]
  /// 評価の一覧。新しい順（GET /scenes/:id/reviews）
  func reviews(sceneID: String) async throws -> [SceneReview]
  /// 評価する。同じ端末から送り直すと上書きになる（PUT /scenes/:id/reviews）。新しい平均と人数を返す
  func submit(sceneID: String, name: String, rating: Int, comment: String?) async throws -> SceneRating
}

struct SceneRating: Sendable, Equatable, Decodable {
  /// ★の平均（小数第 1 位まで）。評価が無ければ nil
  let average: Double?
  let count: Int
}

struct SceneReview: Sendable, Equatable, Decodable {
  let name: String
  /// ★の数（1〜5）
  let rating: Int
  let comment: String?
  let updatedAt: String
}

enum SceneReviews {
  /// ★の数の範囲
  static let ratings = 1...5
  /// コメントの長さの上限
  static let maxCommentLength = 200

  /// アプリ全体で使う口。Live で URL があればバックエンドに、それ以外は仮のデータにつなぐ
  static let client: any SceneReviewClient = {
    let config = AppConfig.current
    if config.mode == .live, let url = config.backendURL {
      return HTTPSceneReviewClient(baseURL: url)
    }
    return MockSceneReviewClient()
  }()

  /// 評価した人の ID。端末ごとに 1 つ作って覚えておく
  static var reviewerID: String {
    let key = "sceneReviews.reviewerID"
    if let id = UserDefaults.standard.string(forKey: key) { return id }
    let id = UUID().uuidString.lowercased()
    UserDefaults.standard.set(id, forKey: key)
    return id
  }
}

/// 本物のバックエンドにつなぐ
final class HTTPSceneReviewClient: SceneReviewClient {
  private let baseURL: URL

  init(baseURL: URL) {
    self.baseURL = baseURL
  }

  func ratings() async throws -> [String: SceneRating] {
    struct Scene: Decodable {
      let id: String
      let rating: SceneRating
    }
    struct Response: Decodable { let scenes: [Scene] }
    let response: Response = try await send(URLRequest(url: baseURL.appending(path: "scenes")))
    return Dictionary(uniqueKeysWithValues: response.scenes.map { ($0.id, $0.rating) })
  }

  func reviews(sceneID: String) async throws -> [SceneReview] {
    struct Response: Decodable { let reviews: [SceneReview] }
    let url = baseURL.appending(path: "scenes/\(sceneID)/reviews")
    let response: Response = try await send(URLRequest(url: url))
    return response.reviews
  }

  func submit(sceneID: String, name: String, rating: Int, comment: String?) async throws -> SceneRating {
    struct Body: Encodable {
      let reviewerId: String
      let name: String
      let rating: Int
      let comment: String?
    }
    var request = URLRequest(url: baseURL.appending(path: "scenes/\(sceneID)/reviews"))
    request.httpMethod = "PUT"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(
      Body(reviewerId: SceneReviews.reviewerID, name: name, rating: rating, comment: comment))
    return try await send(request)
  }

  private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw URLError(.badServerResponse)
    }
    return try JSONDecoder().decode(T.self, from: data)
  }
}

/// 仮のデータ。通信せず、アプリを閉じるまで覚えておく
final class MockSceneReviewClient: SceneReviewClient {
  private var stored: [String: [SceneReview]] = [
    "park": [
      SceneReview(name: "けんた", rating: 5, comment: "犬とボールが言いやすい", updatedAt: "2026-10-24T10:00:00Z"),
      SceneReview(name: "みさき", rating: 4, comment: nil, updatedAt: "2026-10-24T09:00:00Z"),
    ],
    "classroom": [
      SceneReview(name: "ゆうと", rating: 3, comment: "黒板の言い方が分からなかった", updatedAt: "2026-10-24T09:30:00Z")
    ],
  ]
  /// 自分の評価（上書きするため分けて持つ）
  private var mine: [String: SceneReview] = [:]

  func ratings() async throws -> [String: SceneRating] {
    var result: [String: SceneRating] = [:]
    for id in Set(stored.keys).union(mine.keys) {
      result[id] = rating(of: id)
    }
    return result
  }

  func reviews(sceneID: String) async throws -> [SceneReview] {
    ([mine[sceneID]].compactMap { $0 } + (stored[sceneID] ?? [])).sorted { $0.updatedAt > $1.updatedAt }
  }

  func submit(sceneID: String, name: String, rating: Int, comment: String?) async throws -> SceneRating {
    mine[sceneID] = SceneReview(
      name: name, rating: rating, comment: comment, updatedAt: ISO8601DateFormatter().string(from: .now))
    return self.rating(of: sceneID)
  }

  private func rating(of sceneID: String) -> SceneRating {
    let all = [mine[sceneID]].compactMap { $0 } + (stored[sceneID] ?? [])
    guard !all.isEmpty else { return SceneRating(average: nil, count: 0) }
    let average = Double(all.map(\.rating).reduce(0, +)) / Double(all.count)
    return SceneRating(average: (average * 10).rounded() / 10, count: all.count)
  }
}
