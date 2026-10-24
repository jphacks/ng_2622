// swift-tools-version: 6.2
// バックエンドの API の型とクライアント。backend/openapi.json から、ビルドのたびに
// swift-openapi-generator のビルドプラグインで作る（作ったコードは DerivedData に出て、commit しない）
import PackageDescription

let package = Package(
  name: "BackendAPI",
  platforms: [.iOS(.v26), .macOS(.v15)],
  products: [
    .library(name: "BackendAPI", targets: ["BackendAPI"])
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.14.2"),
    .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.13.3"),
    .package(url: "https://github.com/apple/swift-openapi-urlsession", exact: "1.4.0"),
    // 合言葉を Authorization ヘッダーに載せる middleware（BearerToken.swift）が HTTPRequest を使う
    .package(url: "https://github.com/apple/swift-http-types", exact: "1.8.0"),
  ],
  targets: [
    .target(
      name: "BackendAPI",
      dependencies: [
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
        .product(name: "HTTPTypes", package: "swift-http-types"),
      ],
      // 作られたコードの警告（使っていない public import など）は直せないので出さない。
      // openapi.json を読めなかったときなどのプラグインの警告は、これとは別に出る
      swiftSettings: [.unsafeFlags(["-suppress-warnings"])],
      // openapi.json は backend/openapi.json への symlink。設定は openapi-generator-config.yaml
      plugins: [
        .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")
      ]
    ),
    // WebSocket のメッセージが作った型で読めるか、BearerToken がヘッダーを付けるかの確認。cd ios/Packages/BackendAPI && swift test
    .testTarget(
      name: "BackendAPITests",
      dependencies: ["BackendAPI", .product(name: "HTTPTypes", package: "swift-http-types")]
    ),
  ]
)
