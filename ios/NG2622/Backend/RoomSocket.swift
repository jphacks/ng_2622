import BackendAPI
import Foundation
import os

/// 部屋の WebSocket（GET /rooms/{roomId}/ws）の 1 本の接続。作った Client には WebSocket が無いので、
/// URLSessionWebSocketTask でつなぐ。メッセージは JSON のテキストで、ClientMessage を送り ServerMessage を受け取る。
/// つなぎ直すときは、新しい RoomSocket を作る
final class RoomSocket {
  /// 部屋が「ほかの接続に置き換えた」ときに閉じるコード（backend の CLOSE_REPLACED）
  static let replacedCloseCode = 4000

  private let task: URLSessionWebSocketTask

  init(baseURL: URL, roomID: String, session: URLSession = .shared) {
    task = session.webSocketTask(with: Self.url(baseURL: baseURL, roomID: roomID))
    task.resume()
  }

  deinit {
    task.cancel(with: .goingAway, reason: nil)
  }

  /// BACKEND_URL（http か https）を ws か wss にして、/rooms/{roomId}/ws を足す
  static func url(baseURL: URL, roomID: String) -> URL {
    var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
    components.scheme = components.scheme?.lowercased() == "https" ? "wss" : "ws"
    let base = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
    components.path = base + "/rooms/\(roomID)/ws"
    components.query = nil
    return components.url ?? baseURL
  }

  func send(_ message: Components.Schemas.ClientMessage) async throws {
    let data = try JSONEncoder().encode(message)
    try await task.send(.string(String(decoding: data, as: UTF8.self)))
  }

  /// 次のメッセージを待つ。読めないもの（知らない type・形の違うもの）はログに出して nil を返す。
  /// 作った型の enum は知らない値で decode に失敗するので、1 通ずつ捨てて受け続けられるようにする。
  /// 切断したら throw する
  func receive() async throws -> Components.Schemas.ServerMessage? {
    let data: Data
    switch try await task.receive() {
    case .string(let text): data = Data(text.utf8)
    case .data(let bytes): data = bytes
    @unknown default: return nil
    }
    return Self.decode(data)
  }

  /// 部屋からのメッセージを読む。読めないときはログに出して nil
  static func decode(_ data: Data) -> Components.Schemas.ServerMessage? {
    do {
      return try JSONDecoder().decode(Components.Schemas.ServerMessage.self, from: data)
    } catch {
      let text = String(decoding: data.prefix(200), as: UTF8.self)
      liveLog.error("読めないメッセージを捨てました: \(text, privacy: .private) \(error, privacy: .public)")
      return nil
    }
  }

  /// 閉じたときのコード。まだ閉じていなければ 0（.invalid）
  var closeCode: Int { task.closeCode.rawValue }

  func close() {
    task.cancel(with: .normalClosure, reason: nil)
  }
}

/// Live（本物のバックエンド）の通信のログ。Console.app か Xcode のコンソールで subsystem を絞って見る
let liveLog = Logger(subsystem: "jp.jphacks.ng2622", category: "Live")
