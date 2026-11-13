import BackendAPI
import Foundation
import HTTPTypes
import Testing

@testable import NG2622

/// Live の口（LiveWeakPointClient）: 状態コードから失敗への振り分けと、整形しない JSON で送ること。
/// 通信はせず、決まった応答を返す偽の ClientTransport で確かめる
@MainActor
struct WeakPointClientTests {
  static func request() throws -> Components.Schemas.WeakPointRequest {
    try #require(WeakPointRequestBuilder.build(recent: WeakPointAnalysisTests.records(5))).request
  }

  static func client(_ transport: FakeTransport) -> LiveWeakPointClient {
    LiveWeakPointClient(baseURL: URL(string: "http://localhost:8787")!, transport: transport)
  }

  static let errorBody = Data(#"{"error":{"code":"rate_limited","message":"x"}}"#.utf8)

  /// 200 は分析を返す。本文は整形しない JSON で、大きさを測った形（WeakPointRequestBuilder.encode）と同じ
  @Test func sendsCompactJSONAndReturnsAnalysis() async throws {
    let request = try Self.request()
    let response = MockWeakPointClient.response(for: request, habits: true)
    let transport = FakeTransport(status: 200, body: try JSONEncoder().encode(response))
    let returned = try await Self.client(transport).analyze(request)
    #expect(returned == response)
    let sent = try #require(await transport.sent.data)
    let measured = try WeakPointRequestBuilder.encode(request)
    #expect(sent == measured)
    #expect(!sent.contains(UInt8(ascii: "\n")))
    #expect(await transport.sent.operationID == "analyzeWeakPoints")
  }

  /// 429 は回数の上限、503 は止めている、400・413 は本文が受け付けられない、ほか（502・知らないコード）は失敗
  @Test(arguments: zip(
    [429, 503, 400, 413, 502, 500],
    [WeakPointFailure.rateLimited, .unavailable, .rejected, .rejected, .failed, .failed]))
  func mapsStatusToFailure(status: Int, expected: WeakPointFailure) async throws {
    let transport = FakeTransport(status: status, body: Self.errorBody)
    await #expect(throws: expected) {
      _ = try await Self.client(transport).analyze(try Self.request())
    }
  }

  /// 本文の読めない応答（手前で返った HTML の 429 など）も、状態コードで分ける
  @Test func mapsStatusEvenWhenBodyIsUnreadable() async throws {
    let transport = FakeTransport(status: 429, body: Data("<html>Too Many Requests</html>".utf8), contentType: "text/html")
    await #expect(throws: WeakPointFailure.rateLimited) {
      _ = try await Self.client(transport).analyze(try Self.request())
    }
  }

  /// 通信できない（応答が無い）は失敗
  @Test func networkErrorIsFailed() async throws {
    let transport = FakeTransport(status: 0, body: Data(), error: URLError(.notConnectedToInternet))
    await #expect(throws: WeakPointFailure.failed) {
      _ = try await Self.client(transport).analyze(try Self.request())
    }
  }
}

/// 決まった応答を返し、送られた本文を控える偽の ClientTransport
nonisolated struct FakeTransport: ClientTransport {
  let status: Int
  let body: Data
  var contentType = "application/json"
  var error: (any Error & Sendable)?
  let sent = Sent()

  actor Sent {
    private(set) var data: Data?
    private(set) var operationID: String?

    func set(_ data: Data?, operationID: String) {
      self.data = data
      self.operationID = operationID
    }
  }

  init(status: Int, body: Data, contentType: String = "application/json", error: (any Error & Sendable)? = nil) {
    self.status = status
    self.body = body
    self.contentType = contentType
    self.error = error
  }

  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
    HTTPResponse, HTTPBody?
  ) {
    let data: Data? = if let body { try await Data(collecting: body, upTo: 1 << 20) } else { nil }
    await sent.set(data, operationID: operationID)
    if let error { throw error }
    var fields = HTTPFields()
    fields[.contentType] = contentType
    return (HTTPResponse(status: .init(code: status), headerFields: fields), HTTPBody(self.body))
  }
}
