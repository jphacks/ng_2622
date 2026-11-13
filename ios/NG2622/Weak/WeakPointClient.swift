import BackendAPI
import Foundation
import os

nonisolated let weakPointLog = Logger(subsystem: "jp.jphacks.ng2622", category: "WeakPoints")

/// 苦手の分析を頼む口（POST /weak-points）。Live はバックエンドに、Mock は決まった分析を返す
nonisolated protocol WeakPointClient: Sendable {
  func analyze(_ request: Components.Schemas.WeakPointRequest) async throws -> Components.Schemas.WeakPointResponse
}

/// 分析を作れなかった理由。画面の短い 1 行を分ける
nonisolated enum WeakPointFailure: Error, Equatable, Sendable {
  /// 回数の上限（429）
  case rateLimited
  /// 止めている・使えない（503）
  case unavailable
  /// 本文が受け付けられない（400・413）。開き直しても同じ本文になるので、もう一度作るとは書かない
  case rejected
  /// Claude の失敗（502）・時間切れ・通信できない・知らない応答
  case failed
}

nonisolated enum WeakPointClients {
  /// 返るまで待つ長さ。バックエンドは呼び直しを含めて 25 秒で締め切る
  static let timeout: Duration = .seconds(30)

  /// アプリ全体で使う口。Live で URL があればバックエンドに、それ以外は決まった分析を返す
  @MainActor static func make(config: AppConfig = .current) -> any WeakPointClient {
    if config.mode == .live, let url = config.backendURL {
      return LiveWeakPointClient(baseURL: url)
    }
    return MockWeakPointClient(behavior: config.mockWeakPoints)
  }

  /// timeout までに返らなければ failed にする
  static func withTimeout<T: Sendable>(
    _ timeout: Duration = timeout, _ operation: @escaping @Sendable () async throws -> T
  ) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
      group.addTask { try await operation() }
      group.addTask {
        try await Task.sleep(for: timeout)
        throw WeakPointFailure.failed
      }
      defer { group.cancelAll() }
      guard let first = try await group.next() else { throw WeakPointFailure.failed }
      return first
    }
  }
}

/// 本物のバックエンドに頼む。本文は整形しない JSON で送る（生成した Client の既定は整形した JSON で、
/// 約 1.44 倍になって 64 KB の上限を超えることがある）
nonisolated struct LiveWeakPointClient: WeakPointClient {
  let client: Client

  /// transport はテストで偽物に替える
  init(baseURL: URL, transport: any ClientTransport = URLSessionTransport()) {
    client = Client(serverURL: baseURL, configuration: .init(jsonEncodingOptions: [.sortedKeys]), transport: transport)
  }

  /// 失敗は状態コードだけをログに出す（本文には自分の文が入りうるので出さない）
  func analyze(_ request: Components.Schemas.WeakPointRequest) async throws -> Components.Schemas.WeakPointResponse {
    let output: Operations.AnalyzeWeakPoints.Output
    do {
      output = try await client.analyzeWeakPoints(body: .json(request))
    } catch {
      // 応答の本文が読めなかった（手前で返った 429 など）ときも、状態コードで分ける。応答が無ければ通信の失敗
      let status = (error as? ClientError)?.response?.status.code
      weakPointLog.notice("苦手の分析を作れませんでした: \(status.map { "\($0)" } ?? "応答なし", privacy: .public)")
      throw Self.failure(status: status)
    }
    if case .ok(let ok) = output, let body = try? ok.body.json {
      return body
    }
    let status = Self.status(of: output)
    weakPointLog.notice("苦手の分析を作れませんでした: \(status, privacy: .public)")
    throw Self.failure(status: status)
  }

  /// 状態コードから、画面の 1 行を分ける失敗へ
  static func failure(status: Int?) -> WeakPointFailure {
    switch status {
    case 400, 413: .rejected
    case 429: .rateLimited
    case 503: .unavailable
    default: .failed
    }
  }

  static func status(of output: Operations.AnalyzeWeakPoints.Output) -> Int {
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

/// Mock の分析。作っている間が見えるよう少し待ってから、送った回の文字起こしから引いた決まった分析を返す。
/// 振る舞い（MOCK_WEAK_POINTS）で、癖が 0 件・失敗・上限にも切り替えられる
nonisolated struct MockWeakPointClient: WeakPointClient {
  enum Behavior: String, Sendable {
    /// 癖 2 件・良くなった点・次に試すこと
    case ok
    /// 癖が 0 件（良くなった点と次に試すことはある）
    case empty
    /// 失敗（502 と同じ）
    case fail
    /// 回数の上限（429 と同じ）
    case limit
  }

  var behavior = Behavior.ok
  /// 返すまで待つ時間
  var delay: Duration = .seconds(3)

  func analyze(_ request: Components.Schemas.WeakPointRequest) async throws -> Components.Schemas.WeakPointResponse {
    try await Task.sleep(for: delay)
    switch behavior {
    case .fail: throw WeakPointFailure.failed
    case .limit: throw WeakPointFailure.rateLimited
    case .ok, .empty: return Self.response(for: request, habits: behavior == .ok)
    }
  }

  /// 送った回の文字起こしの index 番目の文（無ければ最後の文）。引用は、その回の文字起こしにあるとおりの文字列にする
  static func sentence(_ transcript: String, _ index: Int) -> String {
    let sentences = transcript.split(separator: ".").map { $0.trimmingCharacters(in: .whitespaces) + "." }
      .filter { $0.count > 1 && transcript.contains($0) }
    return sentences.isEmpty ? transcript : sentences[min(index, sentences.count - 1)]
  }

  static func response(
    for request: Components.Schemas.WeakPointRequest, habits: Bool
  ) -> Components.Schemas.WeakPointResponse {
    let rounds = request.rounds
    // 回の index 番目の、sentence 番目の文
    func quote(_ index: Int, _ sentence: Int) -> Components.Schemas.WeakPointQuote {
      let round = rounds[max(0, min(rounds.count - 1, index))]
      return .init(n: round.n, quote: Self.sentence(round.transcript, sentence))
    }
    let last = rounds.count - 1
    let found: [Components.Schemas.WeakPointHabit] =
      habits
      ? [
        .init(
          viewpoint: .content, title: "理由をつなげずに文が終わる",
          what: "人の動きは言えているが、なぜそうしているかを言わずに文が終わっている。",
          examples: [quote(last, 1), quote(last - 2, 1)],
          fix: "動きのあとに because で理由を 1 つ足そう。\"A girl is carrying a bucket because she wants to make a castle.\""),
        .init(
          viewpoint: .expression, title: "短い文を同じ形でくり返す",
          what: "There is と is ～ing の短い文が続き、文と文がつながっていない。",
          examples: [quote(last - 1, 2), quote(last - 3, 0)],
          fix: "2 つの文を and でつないでみよう。\"A boy is building a castle and a girl is carrying a bucket.\""),
      ] : []
    return .init(
      habits: found,
      improvement: .init(
        value1: .init(viewpoint: .content, text: "物の場所を言えるようになった。", example: quote(last, 2))),
      nextTry: .init(value1: .init(viewpoint: .content, text: "動きのあとに because で理由を 1 つ足してみよう。")),
      retries: 0)
  }
}
