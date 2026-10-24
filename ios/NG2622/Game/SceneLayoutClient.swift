import Foundation

/// AI で作った場面（sceneId が gen- で始まる）をやりとりする口。docs/design/scene-protocol.md の「API」。
/// 配置の JSON を取る（GET /scenes/{sceneId}/layout）のと、ホストの一言から作る（POST /scenes/generate）
protocol SceneLayoutClient: AnyObject {
  /// 配置の JSON
  func layout(sceneID: String) async throws -> SceneLayout
  /// 一言と難しさから場面を作り、sceneId を返す。待つのは長くて 20 秒
  func generate(prompt: String, difficulty: SceneDifficulty) async throws -> String
}

/// 作る場面の難しさ。置く部品と描写してほしい要素の数が変わる
enum SceneDifficulty: String, CaseIterable, Identifiable, Sendable {
  case easy
  case normal
  case hard

  var id: String { rawValue }

  var label: String {
    switch self {
    case .easy: "かんたん"
    case .normal: "ふつう"
    case .hard: "むずかしい"
    }
  }
}

enum SceneLayoutError: Error, Equatable {
  /// その場面が無い
  case notFound
  /// 一言を断られた（generation_refused）。言い方を変えれば作れるかもしれない
  case refused
  /// 作る途中で失敗した（generation_failed など）。もう一度試せば作れるかもしれない
  case failed
  /// いまは作れない（generation_unavailable、または生成の口がまだ無い 404）
  case unavailable
  /// 一言の長さや形を受け付けなかった（invalid_message）
  case invalidPrompt
  /// 20 秒を過ぎても返事が無い
  case timedOut
  /// バックエンドにつながらない・返事が読めない
  case connectionFailed

  /// 画面に出す理由。サーバーの message は出さず、ここで決めた文言だけを出す
  var reason: String {
    switch self {
    case .notFound: "作った場面が見つかりませんでした。"
    case .refused: "この一言では作れませんでした。言い方を変えてください。"
    case .failed: "うまく作れませんでした。もう一度作ってみてください。"
    case .unavailable: "いまは作れません。用意された場面から選んでください。"
    case .invalidPrompt: "お題を受け付けられませんでした。\(SceneGenerator.maxPromptLength) 文字までの一言で入れ直してください。"
    case .timedOut: "時間がかかりすぎたので止めました。もう一度作るか、用意されたシーンを選んでください。"
    case .connectionFailed: "サーバーにつながりませんでした。"
    }
  }
}

enum SceneLayouts {
  /// POST /scenes/generate を待つ時間。バックエンドは長くて 20 秒で返すので、少し余裕を持たせる
  static let generateTimeout: TimeInterval = 25

  /// アプリ全体で使う口。Live で URL があればバックエンドに、それ以外は同梱の見本につなぐ
  static let client: any SceneLayoutClient = {
    let config = AppConfig.current
    if config.mode == .live, let url = config.backendURL {
      return HTTPSceneLayoutClient(baseURL: url)
    }
    return MockSceneLayoutClient()
  }()

  static let store = SceneLayoutStore(client: client)
}

/// 配置の JSON を覚えておく所。同じ場面は 1 度だけ取りに行く。名前は結果の画面でも使う
final class SceneLayoutStore {
  private let client: any SceneLayoutClient
  private var loads: [String: Task<SceneLayout, any Error>] = [:]
  private var names: [String: String] = [:]

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

  func generate(prompt: String, difficulty: SceneDifficulty) async throws -> String {
    struct Body: Encodable {
      let prompt: String
      let difficulty: String
    }
    struct Response: Decodable { let sceneId: String }
    var request = URLRequest(url: baseURL.appending(path: "scenes/generate"))
    request.httpMethod = "POST"
    request.timeoutInterval = SceneLayouts.generateTimeout
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(Body(prompt: prompt, difficulty: difficulty.rawValue))
    let (data, status) = try await send(request)
    guard (200..<300).contains(status) else {
      throw Self.generateError(status: status, code: Self.errorCode(in: data))
    }
    guard let response = try? JSONDecoder().decode(Response.self, from: data),
      GeneratedScene.isGenerated(response.sceneId)
    else { throw SceneLayoutError.connectionFailed }
    return response.sceneId
  }

  /// POST /scenes/generate が失敗したときの、状態コードと error.code から決めるエラー
  static func generateError(status: Int, code: String?) -> SceneLayoutError {
    switch code {
    case "generation_refused": return .refused
    case "generation_failed": return .failed
    case "generation_unavailable": return .unavailable
    case "invalid_message": return .invalidPrompt
    default: break
    }
    switch status {
    // 生成の口がまだ無いバックエンドは 404 を返す。作れないのと同じに扱う
    case 404, 503: return .unavailable
    case 504: return .timedOut
    case 400..<500: return .failed
    default: return .connectionFailed
    }
  }

  /// 失敗の本文（{ "error": { "code", "message" } }）の code。message は画面に出さず、ログにだけ残す
  private static func errorCode(in data: Data) -> String? {
    struct Failure: Decodable {
      struct Detail: Decodable {
        let code: String?
        let message: String?
      }
      let error: Detail
    }
    guard let failure = try? JSONDecoder().decode(Failure.self, from: data) else { return nil }
    sceneLog.notice(
      "場面を作れませんでした: \(failure.error.code ?? "-", privacy: .public) \(failure.error.message ?? "", privacy: .public)")
    return failure.error.code
  }

  /// 本文と状態コード。つながらない・時間切れは throw する
  private func send(_ request: URLRequest) async throws -> (Data, Int) {
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch let error as URLError where error.code == .timedOut {
      throw SceneLayoutError.timedOut
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

/// 仮のデータ。通信せず、同梱の見本（SampleLayouts/<sceneId>.json）を返す
final class MockSceneLayoutClient: SceneLayoutClient {
  /// 一言にこの語が入っていると、部屋の見本を返す。それ以外は公園の見本
  private static let roomWords = ["部屋", "机", "テーブル", "コップ", "本", "椅子", "いす", "room", "table"]
  /// 一言にこの語が入っていると、作れなかったことにする（失敗の画面を確かめる用）
  static let failingWord = "失敗"

  private let bundle: Bundle

  init(bundle: Bundle = .main) {
    self.bundle = bundle
  }

  func layout(sceneID: String) async throws -> SceneLayout {
    guard let url = bundle.url(forResource: sceneID, withExtension: "json", subdirectory: "SampleLayouts") else {
      throw SceneLayoutError.notFound
    }
    return try SceneLayout.decode(Data(contentsOf: url))
  }

  func generate(prompt: String, difficulty: SceneDifficulty) async throws -> String {
    try await Task.sleep(for: .seconds(.random(in: 1...2)))
    if prompt.contains(Self.failingWord) {
      throw SceneLayoutError.refused
    }
    let lower = prompt.lowercased()
    return Self.roomWords.contains(where: lower.contains) ? "gen-sample-2" : "gen-sample-1"
  }
}
