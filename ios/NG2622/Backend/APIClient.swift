import BackendAPI
import Foundation

/// バックエンドの API を呼ぶ Client を作る。Client と型は backend/openapi.json から
/// ビルドのときに作られる（ios/Packages/BackendAPI）。WebSocket のメッセージの型も Components.Schemas にある
enum APIClient {
  /// BACKEND_URL（Config/*.xcconfig）につなぐ Client。URL が無いときは nil
  static func make(config: AppConfig = .current) -> Client? {
    guard let url = config.backendURL else { return nil }
    return Client(serverURL: url, transport: URLSessionTransport())
  }

  /// バックエンドが動いているか（GET /health が 200 を返すか）
  nonisolated static func isHealthy(_ client: Client) async -> Bool {
    guard let output = try? await client.getHealth() else { return false }
    if case .ok = output { return true }
    return false
  }
}
