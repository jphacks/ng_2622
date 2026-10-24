import Foundation
import HTTPTypes
import OpenAPIRuntime

/// リクエストに Authorization: Bearer <合言葉> を付ける。音声を送る POST /rooms/{roomId}/rounds/{round}/audio に要る。
/// OpenAPI では Authorization をパラメーターとして書いても無視する決まりなので、作った Client には引数が無い
public struct BearerToken: ClientMiddleware {
  let token: String

  public init(_ token: String) {
    self.token = token
  }

  public func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    var request = request
    request.headerFields[.authorization] = "Bearer \(token)"
    return try await next(request, body, baseURL)
  }
}
