import Foundation

/// ビルド構成（scheme）で決まる設定。Config/*.xcconfig の値が Info.plist を通って入る
struct AppConfig {
  enum BackendMode: String {
    /// 仮のデータで動く。通信しない
    case mock
    /// 本物のバックエンドにつなぐ（まだ未実装）
    case live
  }

  let mode: BackendMode
  let backendURL: URL?

  static let current: AppConfig = {
    let info = Bundle.main.infoDictionary ?? [:]
    let raw = info["BackendMode"] as? String ?? ""
    let url = (info["BackendURL"] as? String).flatMap(URL.init(string:))
    // 値が読めないときは、通信しない Mock にしておく
    return AppConfig(mode: BackendMode(rawValue: raw) ?? .mock, backendURL: url)
  }()
}
