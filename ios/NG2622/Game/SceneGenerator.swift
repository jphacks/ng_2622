import Foundation

/// AI の 3D シーン生成サーバー（scripts/scene/ai_generator.py）に文章を送り、できた USDZ を受け取る
enum SceneGenerator {
  enum Failure: Error {
    /// サーバーが応答しない、または失敗を返した
    case server
    /// 返ってきた USDZ の URL が読めない
    case badResponse
  }

  private struct Response: Decodable {
    let name: String
    let usdzUrl: String
  }

  /// 文章から 3D シーンを作らせ、読み込める SceneChoice を返す（数秒〜数十秒かかる）
  static func generate(prompt: String, endpoint: URL) async throws -> SceneChoice {
    var request = URLRequest(url: endpoint.appending(path: "generate-scene"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(["prompt": prompt])
    request.timeoutInterval = 120

    let (data, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Failure.server }
    let decoded = try JSONDecoder().decode(Response.self, from: data)
    guard let url = URL(string: decoded.usdzUrl) else { throw Failure.badResponse }
    return SceneChoice(sceneID: "custom", sceneURL: url, title: decoded.name)
  }
}
