import BackendAPI
import Foundation

/// 苦手の場面を頼む口（POST /weak-scenes）。Live はバックエンドに、Mock は作り置きの場面の一つを返す
nonisolated protocol WeakSceneClient: Sendable {
  func make(_ request: Components.Schemas.WeakSceneRequest) async throws -> WeakScene
}

/// 苦手の場面を作れなかった理由。画面はどれも同じに出す（カードから場面を消し、数秒のバナーで知らせる。
/// 2026-11-14 リーダーが決めた）。理由はログとテストで見分ける
nonisolated enum WeakSceneFailure: Error, Equatable, Sendable {
  /// 本文が受け付けられない（400・413）
  case rejected
  /// 回数の上限（429）
  case rateLimited
  /// 止めている・使えない（503）
  case unavailable
  /// 作れなかった（502。Claude の失敗・断った・部品を作れなかった）・時間切れ・知らない応答・届いた場面が読めない
  case failed
  /// 通信できない（応答が無い）
  case offline
}

nonisolated enum WeakSceneClients {
  /// 返るまで待つ長さ。バックエンドは 90 秒で締め切る
  static let timeout: Duration = .seconds(100)

  /// アプリ全体で使う口。Live で URL があればバックエンドに、それ以外は作り置きの場面を返す
  @MainActor static func make(config: AppConfig = .current) -> any WeakSceneClient {
    if config.mode == .live, let url = config.backendURL {
      return LiveWeakSceneClient(baseURL: url)
    }
    return MockWeakSceneClient(behavior: config.mockWeakScene)
  }

  /// timeout までに返らなければ failed にする
  static func withTimeout<T: Sendable>(
    _ timeout: Duration = timeout, _ operation: @escaping @Sendable () async throws -> T
  ) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
      group.addTask { try await operation() }
      group.addTask {
        try await Task.sleep(for: timeout)
        weakPointLog.notice("苦手の場面を作れませんでした: 打ち切り")
        throw WeakSceneFailure.failed
      }
      defer { group.cancelAll() }
      guard let first = try await group.next() else { throw WeakSceneFailure.failed }
      return first
    }
  }
}

/// 本物のバックエンドに頼む。本文は整形しない JSON で送る
nonisolated struct LiveWeakSceneClient: WeakSceneClient {
  let client: Client

  /// 通信が待つ長さ（秒）。URLSession の既定（60 秒）はサーバーの締め切り（90 秒）より短いので、アプリの打ち切り
  /// （WeakSceneClients.timeout の 100 秒）より少し長くする。打ち切りは withTimeout に任せる
  static let requestTimeout: TimeInterval = 110

  /// transport はテストで偽物に替える。既定は requestTimeout まで待つ URLSession
  init(baseURL: URL, transport: (any ClientTransport)? = nil) {
    client = Client(
      serverURL: baseURL, configuration: .init(jsonEncodingOptions: [.sortedKeys]),
      transport: transport ?? URLSessionTransport(configuration: .init(session: Self.session())))
  }

  /// requestTimeout まで待つ URLSession（TitleStore の LiveTitleSource と同じ作り方）
  static func session(configuration: URLSessionConfiguration = .default) -> URLSession {
    let long = configuration.copy() as! URLSessionConfiguration
    long.timeoutIntervalForRequest = requestTimeout
    long.timeoutIntervalForResource = requestTimeout
    return URLSession(configuration: long)
  }

  /// 失敗は状態コードだけをログに出す
  func make(_ request: Components.Schemas.WeakSceneRequest) async throws -> WeakScene {
    let output: Operations.GenerateWeakScene.Output
    do {
      output = try await client.generateWeakScene(body: .json(request))
    } catch {
      let cancelled = error is CancellationError || (error as? ClientError)?.underlyingError is CancellationError
      if Task.isCancelled || cancelled { throw CancellationError() }
      // 応答の本文が読めなかった（手前で返った 429 など）ときも、状態コードで分ける。応答が無ければ通信できない
      let status = (error as? ClientError)?.response?.status.code
      weakPointLog.notice("苦手の場面を作れませんでした: \(status.map { "\($0)" } ?? "応答なし", privacy: .public)")
      throw status.map(Self.failure(status:)) ?? .offline
    }
    if case .ok(let ok) = output, let body = try? ok.body.json {
      do {
        return try WeakScene(body)
      } catch {
        weakPointLog.error("苦手の場面の配置を読めませんでした: \(error, privacy: .public)")
        throw WeakSceneFailure.failed
      }
    }
    let status = Self.status(of: output)
    weakPointLog.notice("苦手の場面を作れませんでした: \(status, privacy: .public)")
    throw Self.failure(status: status)
  }

  /// 状態コードから、画面の出し分けの失敗へ
  static func failure(status: Int) -> WeakSceneFailure {
    switch status {
    case 400, 413: .rejected
    case 429: .rateLimited
    case 503: .unavailable
    default: .failed
    }
  }

  static func status(of output: Operations.GenerateWeakScene.Output) -> Int {
    switch output {
    case .ok: 200
    case .badRequest: 400
    case .contentTooLarge: 413
    case .tooManyRequests: 429
    case .badGateway: 502
    case .serviceUnavailable: 503
    case .undocumented(let statusCode, _): statusCode
    }
  }
}

extension WeakScene {
  /// 返った場面から作る。配置は JSON に戻して持つ（記録と同じく、アプリが読まない項目も残す）。
  /// 配置がアプリで読めない（知らない版の形）なら throw する
  nonisolated init(_ response: Components.Schemas.WeakSceneResponse) throws {
    let data = try JSONEncoder().encode(response.layout)
    _ = try SceneDocument(data: data)
    self.init(
      sceneId: response.sceneId, name: response.name, difficulty: response.difficulty.rawValue,
      focus: response.focus.rawValue, pitch: response.pitch, layout: try JSONValue(data: data),
      createdParts: response.createdParts)
  }
}

/// Mock の苦手の場面。作っている間が見えるよう少し待ってから、頼んだ級の作り置きの場面の一つを、苦手の場面の ID で返す。
/// 振る舞い（MOCK_WEAK_SCENE・起動の引数 -MockWeakScene）で、失敗・上限・止めている・通信できないにも切り替えられる
nonisolated struct MockWeakSceneClient: WeakSceneClient {
  enum Behavior: String, Sendable {
    /// 作り置きの場面を返す
    case ok
    /// 作れない（502 と同じ）
    case fail
    /// 回数の上限（429 と同じ）
    case limit
    /// 止めている（503 と同じ）
    case off
    /// 通信できない
    case offline
    /// 作れたが、部屋の置き場に無い（スタートすると部屋が unknown_scene で断る。MockGameClient.missingSceneID）
    case missing
  }

  var behavior = Behavior.ok
  /// 返すまで待つ時間
  var delay: Duration = .seconds(4)
  var bundle: Bundle = .main

  func make(_ request: Components.Schemas.WeakSceneRequest) async throws -> WeakScene {
    try await Task.sleep(for: delay)
    switch behavior {
    case .fail: throw WeakSceneFailure.failed
    case .limit: throw WeakSceneFailure.rateLimited
    case .off: throw WeakSceneFailure.unavailable
    case .offline: throw WeakSceneFailure.offline
    case .ok, .missing: break
    }
    let kinds = request.kinds.compactMap { ChecklistKind(rawValue: $0.rawValue) }
    let grade = request.difficulty.rawValue
    let bundle = bundle
    let missing = behavior == .missing
    let scene = await MainActor.run {
      Self.scene(
        for: SceneDifficulty(rawValue: grade) ?? .eiken3, kinds: kinds, pool: ScenePool(bundle: bundle), bundle: bundle,
        sceneID: missing ? MockGameClient.missingSceneID : "weak-" + UUID().uuidString.lowercased())
    }
    guard let scene else { throw WeakSceneFailure.failed }
    return scene
  }

  /// 級の作り置きの場面（ID の順）のうち、狙う種類の項目がある最初の場面。狙うのは、kinds のうち場面にある最初の種類
  @MainActor static func scene(
    for difficulty: SceneDifficulty, kinds: [ChecklistKind], pool: ScenePool, bundle: Bundle,
    sceneID: String = "weak-" + UUID().uuidString.lowercased()
  ) -> WeakScene? {
    let documents = pool.candidates(of: difficulty).sorted().compactMap {
      try? MockSceneLayoutClient.readDocument($0, bundle: bundle)
    }
    func focus(_ document: SceneDocument) -> ChecklistKind? {
      kinds.first { kind in document.layout.checklist.contains { $0.kind == kind } }
    }
    guard let document = documents.first(where: { focus($0) != nil }) ?? documents.first,
      case .object(var layout) = try? JSONValue(data: document.data)
    else { return nil }
    let kind = focus(document) ?? kinds.first ?? .center
    layout["id"] = .string(sceneID)
    return WeakScene(
      sceneId: sceneID, name: document.layout.name, difficulty: difficulty.rawValue, focus: kind.rawValue,
      pitch: pitch(kind), layout: .object(layout), createdParts: [])
  }

  /// 狙った種類の一言（Mock だけ。本物はサーバーが書く）
  static func pitch(_ kind: ChecklistKind) -> String {
    switch kind {
    case .center: "だれが何をしているかを言いやすい場面です"
    case .reason: "because で理由を言いやすい場面です"
    case .link: "so や to で、つなげて言いやすい場面です"
    case .detail: "物の場所を on や next to で言いやすい場面です"
    }
  }
}
