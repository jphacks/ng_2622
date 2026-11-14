import Foundation

/// 場面の配置の JSON を取る口。作り置きの場面は同梱の pool/<sceneId>.json を読み、
/// 部屋がその場で AI で作った場面だけ GET /scenes/{sceneId}/layout で取る（BundledFirstSceneLayoutClient）。
/// docs/design/scene-protocol.md の「API」。場面は部屋が作る（作り置きか、スタートのときに AI で作る）ので、
/// アプリは作る口（POST /scenes/generate）を呼ばない
protocol SceneLayoutClient: AnyObject {
  /// 配置の JSON（届いたままの中身と、読んだ配置）。room は部屋のコードで、部屋がその場で作った場面（作り置きに無い）を取るときに要る
  func document(sceneID: String, room: String?) async throws -> SceneDocument
}

extension SceneLayoutClient {
  /// 配置の JSON を読んだもの
  func layout(sceneID: String, room: String? = nil) async throws -> SceneLayout {
    try await document(sceneID: sceneID, room: room).layout
  }
}

/// 配置の JSON の、届いたままの中身と、アプリが読んだ配置。
/// SceneLayout はアプリが使う項目しか読まない（place・facing などを落とす）ので、遊んだ記録に場面をまるごと残すときは data を使う
nonisolated struct SceneDocument: Sendable, Equatable {
  /// 届いたままの JSON（scenenglish.scene/2）
  let data: Data
  let layout: SceneLayout

  /// 知らない版の形・読めない JSON なら throw する
  init(data: Data) throws {
    self.data = data
    layout = try SceneLayout.decode(data)
  }
}

enum SceneLayoutError: Error, Equatable {
  /// その場面が無い
  case notFound
  /// バックエンドにつながらない・返事が読めない
  case connectionFailed
}

enum SceneLayouts {
  /// アプリ全体で使う口。Live で URL があれば、同梱の作り置きの場面を先に見て、無いものだけバックエンドに取りに行く
  /// （作り置きは同梱と同じ backend/src/scenes/pool から選ぶので通信しない。部屋がその場で AI で作った場面だけ取りに行く）。
  /// それ以外は同梱だけ
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
  private var loads: [String: Task<SceneDocument, any Error>] = [:]
  private var names: [String: String] = [:]
  private var descriptions: [String: String] = [:]
  /// 取り終えた（か、手元から覚えた）配置
  private var layouts: [String: SceneLayout] = [:]

  init(client: any SceneLayoutClient) {
    self.client = client
  }

  /// room は部屋のコード（部屋がその場で作った場面を取るときに要る）。ID は場面ごとに違うので、覚えるのは ID ごと
  func layout(of sceneID: String, room: String? = nil) async throws -> SceneLayout {
    try await document(of: sceneID, room: room).layout
  }

  /// 届いたままの JSON も要るとき（遊んだ記録に場面をまるごと残す）
  func document(of sceneID: String, room: String? = nil) async throws -> SceneDocument {
    let task: Task<SceneDocument, any Error>
    if let existing = loads[sceneID] {
      task = existing
    } else {
      let client = client
      task = Task { try await client.document(sceneID: sceneID, room: room) }
      loads[sceneID] = task
    }
    do {
      let document = try await task.value
      names[sceneID] = document.layout.name
      descriptions[sceneID] = document.layout.description
      layouts[sceneID] = document.layout
      return document
    } catch {
      // 取れなかったものは覚えず、次にまた取りに行く
      if loads[sceneID] == task { loads[sceneID] = nil }
      throw error
    }
  }

  /// 手元にある配置を覚える。苦手の場面は POST /weak-scenes で配置まで受け取っているので、取りに行かない
  /// （部屋で遊ぶ・3D を組む・記録に残すときに、この配置を使う）
  func remember(_ document: SceneDocument, for sceneID: String) {
    loads[sceneID] = Task<SceneDocument, any Error> { document }
    names[sceneID] = document.layout.name
    descriptions[sceneID] = document.layout.description
    layouts[sceneID] = document.layout
  }

  /// 取り終えた（か、覚えた）配置。待たない
  func remembered(_ sceneID: String) -> SceneLayout? {
    layouts[sceneID]
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

  /// 部屋がその場で作った場面は、部屋のコードを ?room= に付けて取る。作り置きの場面は付けなくても取れる
  func document(sceneID: String, room: String?) async throws -> SceneDocument {
    var url = baseURL.appending(path: "scenes/\(sceneID)/layout")
    if let room { url.append(queryItems: [URLQueryItem(name: "room", value: room)]) }
    let request = URLRequest(url: url)
    let (data, status) = try await send(request)
    guard (200..<300).contains(status) else {
      throw status == 404 ? SceneLayoutError.notFound : SceneLayoutError.connectionFailed
    }
    do {
      return try SceneDocument(data: data)
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

  func document(sceneID: String, room: String?) async throws -> SceneDocument {
    if let document = try? await bundled.document(sceneID: sceneID, room: room) { return document }
    return try await remote.document(sceneID: sceneID, room: room)
  }
}

/// 仮のデータ。通信せず、同梱の作り置きの場面（pool/<sceneId>.json。元は backend/src/scenes/pool）を返す。room は見ない
final class MockSceneLayoutClient: SceneLayoutClient {
  private let bundle: Bundle

  init(bundle: Bundle = .main) {
    self.bundle = bundle
  }

  func document(sceneID: String, room: String?) async throws -> SceneDocument {
    try Self.readDocument(sceneID, bundle: bundle)
  }

  /// 同梱の配置をその場で読む（Mock の結果を作るときに使う）
  static func read(_ sceneID: String, bundle: Bundle = .main) throws -> SceneLayout {
    try readDocument(sceneID, bundle: bundle).layout
  }

  static func readDocument(_ sceneID: String, bundle: Bundle = .main) throws -> SceneDocument {
    guard let url = bundle.url(forResource: sceneID, withExtension: "json", subdirectory: ScenePool.directory) else {
      throw SceneLayoutError.notFound
    }
    return try SceneDocument(data: Data(contentsOf: url))
  }
}
