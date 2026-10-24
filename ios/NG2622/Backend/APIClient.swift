import BackendAPI
import Foundation

/// バックエンドの API を呼ぶ Client を作る。Client と型は backend/openapi.json から
/// ビルドのときに作られる（ios/Packages/BackendAPI）。WebSocket のメッセージの型も Components.Schemas にある
enum APIClient {
  /// BACKEND_URL（Config/*.xcconfig）につなぐ Client。URL が無いときは nil
  static func make(config: AppConfig = .current) -> Client? {
    config.backendURL.map { make(url: $0) }
  }

  /// url につなぐ Client。音声を送るときは middlewares に BearerToken（合言葉）を入れる
  static func make(url: URL, middlewares: [any ClientMiddleware] = []) -> Client {
    Client(serverURL: url, transport: URLSessionTransport(), middlewares: middlewares)
  }

  /// バックエンドが動いているか（GET /health が 200 を返すか）
  nonisolated static func isHealthy(_ client: Client) async -> Bool {
    guard let output = try? await client.getHealth() else { return false }
    if case .ok = output { return true }
    return false
  }
}
