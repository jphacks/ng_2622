import AVFoundation
import SwiftUI

/// ホログラム用の映像。assets/holograms/<id>.json と <id>.mp4 を、アプリの中の holograms/ から読む。
/// 待合で「ホログラム」を選ぶと、この中からランダムに 1 つ選んでラウンドを始める（docs は assets/holograms/README.md）
struct HologramInfo: Identifiable, Decodable, Hashable, Sendable {
  let id: String
  /// 画面に出す名前（例: 縄跳び）
  let name: String
  /// 動画のファイル名（例: jump_rope.mp4）
  let video: String
  /// 場面の英語の説明。待機の画面に正答例として出す
  let description: String?
}

enum HologramCatalog {
  static let all: [HologramInfo] = {
    let urls = Bundle.main.urls(forResourcesWithExtension: "json", subdirectory: "holograms") ?? []
    return urls.compactMap { url -> HologramInfo? in
      guard let data = try? Data(contentsOf: url),
        let info = try? JSONDecoder().decode(HologramInfo.self, from: data),
        url.deletingPathExtension().lastPathComponent == info.id,
        videoURL(file: info.video) != nil
      else { return nil }
      return info
    }
    .sorted { $0.id < $1.id }
  }()

  static func info(_ id: String) -> HologramInfo? {
    all.first { $0.id == id }
  }

  /// ホログラムの場面か（プレイと待機の画面で、3D の代わりに映像を出す）
  static func isHologram(_ id: String) -> Bool {
    info(id) != nil
  }

  static func videoURL(of id: String) -> URL? {
    info(id).flatMap { videoURL(file: $0.video) }
  }

  /// 「ホログラム」で選ぶ場面。映像が 1 つも無ければ nil
  static func randomID() -> String? {
    all.randomElement()?.id
  }

  private static func videoURL(file: String) -> URL? {
    let name = (file as NSString).deletingPathExtension
    let ext = (file as NSString).pathExtension
    return Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "holograms")
  }
}

/// 繰り返し再生する動画（音なし）。黒い背景に、縦横比を保って収める
struct LoopingVideoView: UIViewRepresentable {
  let url: URL
  /// 左右を反転する（ペットボトルなどに反射させると反転するため）
  var mirrored = false

  func makeUIView(context: Context) -> PlayerView {
    let view = PlayerView()
    view.backgroundColor = .black
    let player = AVQueuePlayer()
    player.isMuted = true
    context.coordinator.looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
    view.playerLayer.player = player
    view.playerLayer.videoGravity = .resizeAspect
    view.transform = mirrored ? CGAffineTransform(scaleX: -1, y: 1) : .identity
    player.play()
    return view
  }

  func updateUIView(_ view: PlayerView, context: Context) {
    view.transform = mirrored ? CGAffineTransform(scaleX: -1, y: 1) : .identity
  }

  static func dismantleUIView(_ view: PlayerView, coordinator: Coordinator) {
    view.playerLayer.player?.pause()
    view.playerLayer.player = nil
    coordinator.looper = nil
  }

  func makeCoordinator() -> Coordinator { Coordinator() }

  final class Coordinator {
    var looper: AVPlayerLooper?
  }

  final class PlayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
  }
}
