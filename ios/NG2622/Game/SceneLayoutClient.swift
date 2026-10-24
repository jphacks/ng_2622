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
  /// 作れなかった。message はバックエンドが返した理由
  case rejected(message: String)
  /// 20 秒を過ぎても返事が無い
  case timedOut
  /// バックエンドにつながらない・返事が読めない
  case connectionFailed

  /// 画面に出す理由
  var reason: String {
    switch self {
    case .notFound: "作った場面が見つかりませんでした。"
    case .rejected(let message): message.isEmpty ? "作れませんでした。" : message
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

  init(baseURL: URL) {
    self.baseURL = baseURL
  }

  func layout(sceneID: String) async throws -> SceneLayout {
    let request = URLRequest(url: baseURL.appending(path: "scenes/\(sceneID)/layout"))
    let data = try await send(request)
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
    let data = try await send(request)
    guard let response = try? JSONDecoder().decode(Response.self, from: data),
      GeneratedScene.isGenerated(response.sceneId)
    else { throw SceneLayoutError.connectionFailed }
    return response.sceneId
  }

  /// 2xx なら本文を返す。それ以外は、本文の error.message（あれば）を理由にする
  private func send(_ request: URLRequest) async throws -> Data {
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await URLSession.shared.data(for: request)
    } catch let error as URLError where error.code == .timedOut {
      throw SceneLayoutError.timedOut
    } catch {
      throw SceneLayoutError.connectionFailed
    }
    guard let http = response as? HTTPURLResponse else { throw SceneLayoutError.connectionFailed }
    switch http.statusCode {
    case 200..<300:
      return data
    case 404:
      throw SceneLayoutError.notFound
    default:
      struct Failure: Decodable {
        struct Detail: Decodable { let message: String }
        let error: Detail
      }
      let message = (try? JSONDecoder().decode(Failure.self, from: data))?.error.message
      sceneLog.notice("\(request.url?.path() ?? "", privacy: .public) が \(http.statusCode) を返しました")
      if let message { throw SceneLayoutError.rejected(message: message) }
      throw http.statusCode == 504 ? SceneLayoutError.timedOut : SceneLayoutError.connectionFailed
    }
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
      throw SceneLayoutError.rejected(message: "（見本）この一言では作れませんでした。言い方を変えてみてください。")
    }
    let lower = prompt.lowercased()
    return Self.roomWords.contains(where: lower.contains) ? "gen-sample-2" : "gen-sample-1"
  }
}
