import Foundation

/// ホーム（タイトル画面）に出す 3D。HomeView ができたときと、上に重なった画面が外れたときに決める
/// （取り直しても、見ている途中では入れ替えない。docs/design/ui/screens/home.md）
enum HomeTitle: Equatable {
  /// 作り置きの場面（公園）を 1 周させる
  case park
  /// 広告の 3D（USDZ のファイル）を左右に振り、タイトルの下に caption を出す
  case advert(URL, caption: String)

  /// 今ホームに出すもの。Mock はビルド設定 TITLE_DIORAMA（同梱の 3D）、Live はサーバー（GET /title）が決めて
  /// 端末に取っておいた 3D で決める。Live では TITLE_DIORAMA を見ない（docs/adr/20261113-decide-title-diorama-on-server-with-expiry.md）
  static func current(
    config: AppConfig = .current, store: TitleStore = .shared, bundle: Bundle = .main, now: Date = Date()
  ) -> HomeTitle {
    switch config.mode {
    case .mock:
      guard let diorama = TitleDiorama.shown(setting: config.titleDiorama, bundle: bundle),
        let url = diorama.url(in: bundle)
      else { return .park }
      return .advert(url, caption: diorama.caption)
    case .live:
      guard let (stored, url) = store.current(now: now) else { return .park }
      return .advert(url, caption: stored.caption)
    }
  }

  /// タイトルの下に小さく出す字。公園は出さない
  var caption: String? {
    switch self {
    case .park: nil
    case .advert(_, let caption): caption
    }
  }

  var spin: TitleSpin {
    switch self {
    case .park: .park
    case .advert: .advert
    }
  }

  /// url の 3D を出しているか。読めなかった 3D が今出しているものかを見分けるのに使う
  /// （前に出していた 3D の読み込みが後から失敗しても、新しい 3D を消さない）
  func isShowing(_ url: URL) -> Bool {
    guard case .advert(let current, _) = self else { return false }
    return current.standardizedFileURL == url.standardizedFileURL
  }
}

/// ホームに、作り置きの場面の代わりに同梱の 3D を出すビルド設定 TITLE_DIORAMA の値（既定は空で、作り置きの場面）。
/// Mock だけで効く（Live はサーバーが決める）。企業の 3D 広告の見本で、assets/title の USDZ を 1 つ読んで出す
enum TitleDiorama: String, CaseIterable {
  /// ハッカソンの会場。JPHACKS が提供した場合の見本
  case hackathon

  /// 設定の値から選ぶ。前後の空白と大文字小文字は問わない。空・知らない値は nil（作り置きの場面を出す）
  init?(setting: String?) {
    guard let value = setting?.trimmingCharacters(in: .whitespaces).lowercased(), !value.isEmpty else { return nil }
    self.init(rawValue: value)
  }

  /// アプリの中の USDZ の名前（title/<name>.usdz。SceneLibrary.usdzDirectory）
  var usdzName: String { rawValue }

  /// タイトルの下に小さく出す字。実際の提供ではないので、見本と分かる書き方にする（サーバーの予定の caption と同じ）
  var caption: String {
    switch self {
    case .hackathon: "広告の見本：JPHACKS"
    }
  }

  /// アプリの中の USDZ の場所。無ければ nil
  func url(in bundle: Bundle = .main) -> URL? {
    SceneLibrary.bundledUSDZ(usdzName, in: bundle)
  }

  /// USDZ がアプリに入っているか
  func isBundled(in bundle: Bundle = .main) -> Bool {
    url(in: bundle) != nil
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

  /// 作り置きの場面（公園）。24 秒で 1 周
  static let park = TitleSpin.rotate(period: 24)
  /// 広告の 3D。壁の裏が手前に来ないよう、正面（横断幕）と手前右（看板）の両方が見える向きを中心に左右へ振る。
  /// 会場では、中心の -15 度で看板が正面を向き、-55〜25 度の間は横断幕も読める。広告の 3D は、この向きで見えるように作る
  static let advert = TitleSpin.swing(center: -15, amplitude: 40, period: 20)

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
