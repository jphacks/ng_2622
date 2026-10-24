// 型とクライアント（Client・Components・Operations）は、ビルドのときに openapi.json から作られる。
// アプリは import BackendAPI だけで、URLSessionTransport なども使えるようにする
@_exported import OpenAPIRuntime
@_exported import OpenAPIURLSession
