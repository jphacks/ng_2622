import Foundation

/// AI で作った場面（sceneId が gen- で始まる）の配置の JSON を取る口（GET /scenes/{sceneId}/layout）。
/// docs/design/scene-protocol.md の「API」。場面は遊ぶ前に作り置くので、アプリは作る口（POST /scenes/generate）を呼ばない
protocol SceneLayoutClient: AnyObject {
  /// 配置の JSON
  func layout(sceneID: String) async throws -> SceneLayout
}

enum SceneLayoutError: Error, Equatable {
  /// その場面が無い
  case notFound
  /// バックエンドにつながらない・返事が読めない
  case connectionFailed
}

enum SceneLayouts {
  /// アプリ全体で使う口。Live で URL があれば、同梱の作り置きの場面を先に見て、無いものだけバックエンドに取りに行く
  /// （部屋は同梱と同じ backend/src/scenes/pool から選ぶので、たいていは通信しない）。それ以外は同梱だけ
  static let client: any SceneLayoutClient = {
    let config = AppConfig.current
    if config.mode == .live, let url = config.backendURL {
      return BundledFirstSceneLayoutClient(bundled: MockSceneLayoutClient(), remote: HTTPSceneLayoutClient(baseURL: url))
    }
    return MockSceneLayoutClient()
  }()

  static let store = SceneLayoutStore(client: client)
}

/// 配置の JSON を覚えておく所。同じ場面は 1 度だけ取りに行く。名前は結果の画面で、説明は待機の画面で使う
final class SceneLayoutStore {
  private let client: any SceneLayoutClient
  private var loads: [String: Task<SceneLayout, any Error>] = [:]
  private var names: [String: String] = [:]
  private var descriptions: [String: String] = [:]

  init(client: any SceneLayoutClient) {
    self.client = client
  }

  func layout(of sceneID: String) async throws -> SceneLayout {
    let task: Task<SceneLayout, any Error>
    if let existing = loads[sceneID] {
      task = existing
    } else {
      let client = client
      task = Task { try await client.layout(sceneID: sceneID) }
      loads[sceneID] = task
    }
    do {
      let layout = try await task.value
      names[sceneID] = layout.name
      descriptions[sceneID] = layout.description
      return layout
    } catch {
      // 取れなかったものは覚えず、次にまた取りに行く
      if loads[sceneID] == task { loads[sceneID] = nil }
      throw error
    }
  }

  /// 取ったことのある場面の名前
  func name(of sceneID: String) -> String? {
    names[sceneID]
  }

  /// 取ったことのある場面の英語の説明
  func description(of sceneID: String) -> String? {
    descriptions[sceneID]
  }
}

/// 本物のバックエンドにつなぐ。API の型がまだ openapi.json に無いので、URLSession で直接呼ぶ
final class HTTPSceneLayoutClient: SceneLayoutClient {
  private let baseURL: URL
  private let session: URLSession

  init(baseURL: URL, session: URLSession = .shared) {
    self.baseURL = baseURL
    self.session = session
  }

  func layout(sceneID: String) async throws -> SceneLayout {
    let request = URLRequest(url: baseURL.appending(path: "scenes/\(sceneID)/layout"))
    let (data, status) = try await send(request)
    guard (200..<300).contains(status) else {
      throw status == 404 ? SceneLayoutError.notFound : SceneLayoutError.connectionFailed
    }
    do {
      return try SceneLayout.decode(data)
    } catch {
      sceneLog.error("配置の JSON を読めませんでした（\(sceneID, privacy: .public)）: \(error, privacy: .public)")
      throw SceneLayoutError.connectionFailed
    }
  }

  /// 本文と状態コード。つながらない・時間切れは throw する
  private func send(_ request: URLRequest) async throws -> (Data, Int) {
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch let error as URLError where error.code == .cancelled {
      throw CancellationError()
    } catch {
      throw SceneLayoutError.connectionFailed
    }
    guard let http = response as? HTTPURLResponse else { throw SceneLayoutError.connectionFailed }
    if !(200..<300).contains(http.statusCode) {
      sceneLog.notice("\(request.url?.path() ?? "", privacy: .public) が \(http.statusCode) を返しました")
    }
    return (data, http.statusCode)
  }
}

/// 同梱の配置を先に見て、無ければ remote に取りに行く。同梱が壊れていたときも remote に頼る
final class BundledFirstSceneLayoutClient: SceneLayoutClient {
  private let bundled: any SceneLayoutClient
  private let remote: any SceneLayoutClient

  init(bundled: any SceneLayoutClient, remote: any SceneLayoutClient) {
    self.bundled = bundled
    self.remote = remote
  }

  func layout(sceneID: String) async throws -> SceneLayout {
    if let layout = try? await bundled.layout(sceneID: sceneID) { return layout }
    return try await remote.layout(sceneID: sceneID)
  }
}

/// 仮のデータ。通信せず、同梱の作り置きの場面（pool/<sceneId>.json。元は backend/src/scenes/pool）を返す
final class MockSceneLayoutClient: SceneLayoutClient {
  private let bundle: Bundle

  init(bundle: Bundle = .main) {
    self.bundle = bundle
  }

  func layout(sceneID: String) async throws -> SceneLayout {
    guard let url = bundle.url(forResource: sceneID, withExtension: "json", subdirectory: ScenePool.directory) else {
      throw SceneLayoutError.notFound
    }
    return try SceneLayout.decode(Data(contentsOf: url))
  }
}
