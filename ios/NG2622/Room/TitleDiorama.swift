import Foundation

/// ホーム（タイトル画面）に、作り置きの場面の代わりに出す 3D。ビルド設定 TITLE_DIORAMA で選ぶ（既定は空で、作り置きの場面）。
/// 企業の 3D 広告の見本で、assets/title の USDZ を 1 つ読んで出す（docs/design/ui/screens/home.md）
enum TitleDiorama: String, CaseIterable {
  /// ハッカソンの会場。JPHACKS が提供した場合の見本で、Award Day の TestFlight の版だけで出す（docs/app-store/README.md）
  case hackathon

  /// 設定の値から選ぶ。前後の空白と大文字小文字は問わない。空・知らない値は nil（作り置きの場面を出す）
  init?(setting: String?) {
    guard let value = setting?.trimmingCharacters(in: .whitespaces).lowercased(), !value.isEmpty else { return nil }
    self.init(rawValue: value)
  }

  /// アプリの中の USDZ の名前（title/<name>.usdz。SceneLibrary.usdzDirectory）
  var usdzName: String { rawValue }

  /// タイトルの下に小さく出す字。実際の提供ではないので、見本と分かる書き方にする
  var caption: String {
    switch self {
    case .hackathon: "広告の見本：JPHACKS"
    }
  }

  /// 回し方。会場は壁の裏が手前に来ないよう、横断幕と看板の両方が見える向きを中心に左右へ振る
  /// （中心の -15 度で看板が正面を向き、-55〜25 度の間は横断幕も読める）
  var spin: TitleSpin {
    switch self {
    case .hackathon: .swing(center: -15, amplitude: 40, period: 20)
    }
  }

  /// USDZ がアプリに入っているか
  func isBundled(in bundle: Bundle = .main) -> Bool {
    bundle.url(forResource: usdzName, withExtension: "usdz", subdirectory: SceneLibrary.usdzDirectory) != nil
  }

  /// ホームに出す 3D。設定が空か、USDZ がアプリに無ければ nil（作り置きの場面を出す）
  static func shown(setting: TitleDiorama?, bundle: Bundle = .main) -> TitleDiorama? {
    guard let setting else { return nil }
    guard setting.isBundled(in: bundle) else {
      sceneLog.error("ホームの 3D の USDZ がアプリにありません: \(setting.usdzName, privacy: .public)")
      return nil
    }
    return setting
  }
}

/// ホームの 3D の回し方。向き（yaw）は DioramaView と同じく度で、上から見て反時計回り
enum TitleSpin: Equatable {
  /// 一定の速さで 1 周し続ける。period は 1 周の秒数
  case rotate(period: TimeInterval)
  /// center を中心に ±amplitude 度で左右に振る。period は 1 往復の秒数。正弦で動かし、端ではなめらかに折り返す
  case swing(center: Double, amplitude: Double, period: TimeInterval)

  /// 出してから t 秒の向き（度）。rotate は 0 以上 360 未満
  func yaw(at t: TimeInterval) -> Double {
    switch self {
    case .rotate(let period):
      let turned = (t / period * 360).truncatingRemainder(dividingBy: 360)
      return turned < 0 ? turned + 360 : turned
    case .swing(let center, let amplitude, let period):
      return center + amplitude * sin(2 * .pi * t / period)
    }
  }
}
