import Foundation
import UIKit

/// 遊べる 3D シーン。assets/scenes/<id>.json から読む（採点の elements はバックエンドが使うので読まない）
struct SceneInfo: Identifiable, Decodable, Hashable, Sendable {
  let id: String
  /// 画面に出す名前（例: 公園）
  let name: String
  /// 場面の英語の説明。待機の画面に正答例として出す
  let description: String?
}

enum SceneCatalog {
  /// 一覧の並び。ここに無いシーンは後ろに ID の順で並ぶ
  private static let order = ["park", "classroom", "station"]

  static let all: [SceneInfo] = {
    let urls = Bundle.main.urls(forResourcesWithExtension: "json", subdirectory: nil) ?? []
    let scenes = urls.compactMap { url -> SceneInfo? in
      guard let data = try? Data(contentsOf: url),
        let scene = try? JSONDecoder().decode(SceneInfo.self, from: data),
        url.deletingPathExtension().lastPathComponent == scene.id
      else { return nil }
      return scene
    }
    return scenes.sorted { a, b in
      let ia = order.firstIndex(of: a.id) ?? order.count
      let ib = order.firstIndex(of: b.id) ?? order.count
      return ia == ib ? a.id < b.id : ia < ib
    }
  }()

  static func scene(_ id: String) -> SceneInfo? {
    all.first { $0.id == id }
  }

  /// シーンの名前。ホログラムの場面は映像の名前、AI で作った場面は、取った配置の JSON の名前。知らない ID のときは ID をそのまま返す
  static func name(of id: String) -> String {
    scene(id)?.name ?? HologramCatalog.info(id)?.name ?? SceneLayouts.store.name(of: id) ?? id
  }

  /// シーンの英語の説明（正答例）。ホログラムの場面は映像の説明、AI で作った場面は、取った配置の JSON の説明。無ければ nil
  static func description(of id: String) -> String? {
    scene(id)?.description ?? HologramCatalog.info(id)?.description ?? SceneLayouts.store.description(of: id)
  }

  /// 一覧に出す小さなサムネイル。元の <id>.png（1600×1000）は大きいので、縮めて覚えておく
  static func thumbnail(_ id: String) -> UIImage? {
    if let image = thumbnails[id] { return image }
    let image = UIImage(named: id)?.preparingThumbnail(of: CGSize(width: 384, height: 240))
    thumbnails[id] = image
    return image
  }

  private static var thumbnails: [String: UIImage] = [:]

  /// 「おまかせ」で選ぶシーン
  static func randomID() -> String {
    all.randomElement()?.id ?? "park"
  }
}
