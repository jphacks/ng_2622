import Foundation

/// ビルド構成（scheme）で決まる設定。Config/*.xcconfig の値が Info.plist を通って入る
struct AppConfig {
  enum BackendMode: String {
    /// 仮のデータで動く。通信しない
    case mock
    /// 本物のバックエンド（BACKEND_URL）につなぐ。LiveGameClient
    case live
  }

  let mode: BackendMode
  let backendURL: URL?
  /// 待合でのシーンの選び方（SCENE_PICK）
  let scenePick: ScenePick
  /// Mock の振る舞い（Live では使わない）
  let mock: MockGameClient.Options

  static let current: AppConfig = {
    let info = Bundle.main.infoDictionary ?? [:]
    func string(_ key: String) -> String? {
      (info[key] as? String).map { $0.trimmingCharacters(in: .whitespaces) }.flatMap { $0.isEmpty ? nil : $0 }
    }
    let raw = string("BackendMode") ?? ""
    let url = string("BackendURL").flatMap(URL.init(string:))

    // 値が無い・読めないときは Options の既定値を使う
    var mock = MockGameClient.Options()
    if let n = string("MockOtherPlayers").flatMap(Int.init) {
      mock.otherPlayers = min(max(n, 0), RoomLimit.members - 1)
    }
    if let flag = string("MockIncludesOffline") {
      mock.includesOffline = ["YES", "TRUE", "1"].contains(flag.uppercased())
    }
    if let delay = string("MockHostStartDelay").flatMap(Double.init) {
      mock.hostStartDelay = max(0, delay)
    }
    // 値が読めないときは、通信しない Mock にしておく
    let mode = BackendMode(rawValue: raw) ?? .mock
    // 値が無い・読めないときは難易度（Mock.xcconfig・Live.xcconfig の既定値と同じ）
    let pick = string("ScenePick").flatMap { ScenePick(rawValue: $0.lowercased()) } ?? .difficulty
    return AppConfig(mode: mode, backendURL: url, scenePick: pick, mock: mock)
  }()
}
