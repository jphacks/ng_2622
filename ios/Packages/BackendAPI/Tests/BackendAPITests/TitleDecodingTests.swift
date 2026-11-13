import BackendAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// GET /title の応答が、openapi.json から作ったクライアントで読めるか（expiresAt は秒までの UTC の日時）
struct TitleDecodingTests {
  /// 決めた本文を返すだけの通信
  struct StubTransport: ClientTransport {
    let body: String

    func send(
      _ request: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
      #expect(request.path == "/title")
      var response = HTTPResponse(status: .ok)
      response.headerFields[.contentType] = "application/json"
      return (response, HTTPBody(body))
    }
  }

  func title(_ json: String) async throws -> Components.Schemas.TitleResponse {
    let client = Client(serverURL: URL(string: "https://example.workers.dev")!, transport: StubTransport(body: json))
    return try await client.getTitle().ok.body.json
  }

  @Test func decodesTitle() async throws {
    let response = try await title(
      #"{"title":{"id":"jphacks-2026-ecc5df64","caption":"広告の見本：JPHACKS","model":"https://example.workers.dev/title/hackathon.usdz?v=ecc5df64","sha256":"ecc5df6420d58288105de59ecfde931755a1d345b0789245f9dca72f09719dae","expiresAt":"2026-11-15T14:59:59Z"}}"#
    )
    // null を許す $ref は allOf で包まれるので、中身は value1 に入る（backend/src/openapi.ts の normalizeNullable）
    let title = try #require(response.title?.value1)
    #expect(title.id == "jphacks-2026-ecc5df64")
    #expect(title.caption == "広告の見本：JPHACKS")
    #expect(title.model == "https://example.workers.dev/title/hackathon.usdz?v=ecc5df64")
    #expect(title.sha256.count == 64)
    // 日本時間 2026-11-15 23:59:59
    #expect(title.expiresAt == Date(timeIntervalSince1970: 1_794_754_799))
  }

  @Test func decodesNull() async throws {
    let response = try await title(#"{"title":null}"#)
    #expect(response.title == nil)
  }
}
