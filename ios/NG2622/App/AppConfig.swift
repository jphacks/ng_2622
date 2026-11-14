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
  /// Mock の振る舞い（Live では使わない）
  let mock: MockGameClient.Options
  /// Mock で、きろくの画面に初めから出す例の記録の数（0 なら出さない）。端末には書かない
  var mockSampleRecords = 0
  /// Mock の例の記録で使う場面の数（既定は 5）。起動の引数 -MockSampleScenes 10 で替える（きろくの場面の並びの点を、
  /// 場面の数を変えて確かめるためのもの）
  var mockSampleScenes = 5
  /// Mock で、端末に保存した記録を読まない（例の記録だけを出す）か。UI テストで、シミュレータに前から残っている記録に
  /// 左右されないためのもの。起動の引数 -MockIgnoresSavedRecords YES で入れる。Live では使わない
  var mockIgnoresSavedRecords = false
  /// Mock の苦手の分析の振る舞い（ok・empty・fail・limit）
  var mockWeakPoints = MockWeakPointClient.Behavior.ok
  /// ホーム（タイトル画面）に、作り置きの場面の代わりに出す同梱の 3D（TITLE_DIORAMA）。nil なら作り置きの場面。
  /// Mock だけで使う（Live はサーバーの GET /title が決める。HomeTitle）
  var titleDiorama: TitleDiorama?

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
    if let duration = string("MockGeneratingDuration").flatMap(Double.init) {
      mock.generatingDuration = max(0, duration)
    }
    // 値が読めないときは、通信しない Mock にしておく
    let mode = BackendMode(rawValue: raw) ?? .mock
    // 例の記録の数は、起動の引数（-MockSampleRecords 4）でも替えられる（UI テストで、入口が出ない件数を確かめる）
    let argument = UserDefaults.standard.object(forKey: "MockSampleRecords")
    let sampleCount = (argument as? String) ?? (argument as? NSNumber)?.stringValue ?? string("MockSampleRecords")
    let samples = mode == .mock ? max(0, sampleCount.flatMap(Int.init) ?? 0) : 0
    let ignoresSaved = mode == .mock && UserDefaults.standard.bool(forKey: "MockIgnoresSavedRecords")
    // 例の記録で使う場面の数は、起動の引数（-MockSampleScenes 10）で替える。無ければ既定の 5
    let sampleScenes = UserDefaults.standard.integer(forKey: "MockSampleScenes")
    // 苦手の分析の振る舞いも、起動の引数（-MockWeakPoints fail）で替えられる（UI テストで、失敗や癖が 0 件のときを撮る）
    let weak =
      (UserDefaults.standard.string(forKey: "MockWeakPoints") ?? string("MockWeakPoints"))
      .flatMap { MockWeakPointClient.Behavior(rawValue: $0.lowercased()) } ?? .ok
    return AppConfig(
      mode: mode, backendURL: url, mock: mock, mockSampleRecords: samples,
      mockSampleScenes: sampleScenes > 0 ? sampleScenes : 5, mockIgnoresSavedRecords: ignoresSaved,
      mockWeakPoints: weak, titleDiorama: TitleDiorama(setting: string("TitleDiorama")))
  }()
}
