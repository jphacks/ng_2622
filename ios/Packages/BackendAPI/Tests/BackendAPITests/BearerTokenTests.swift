import BackendAPI
import Foundation
import HTTPTypes
import Testing

/// BearerToken が Authorization ヘッダーを付けて、次に渡すか
struct BearerTokenTests {
  @Test func addsAuthorization() async throws {
    let request = HTTPRequest(method: .post, scheme: "http", authority: "localhost", path: "/rooms/0427/rounds/1/audio")
    let (response, _) = try await BearerToken("t0k").intercept(
      request, body: nil, baseURL: URL(string: "http://localhost")!, operationID: "submitAudio"
    ) { sent, body, _ in
      #expect(sent.headerFields[.authorization] == "Bearer t0k")
      return (HTTPResponse(status: .accepted), body)
    }
    #expect(response.status == .accepted)
  }
}
