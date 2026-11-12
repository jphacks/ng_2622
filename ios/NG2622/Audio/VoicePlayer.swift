import AVFoundation
import Observation
import SwiftUI

/// 何枚かの「あなたの描写」で共有する再生の口。きろくのように何回分も並ぶ所で入れ、別の回を押したら前のを止める
extension EnvironmentValues {
  @Entry var sharedVoicePlayer: VoicePlayer? = nil
}

/// 録った自分の声を再生する（振り返り）
@Observable
final class VoicePlayer: NSObject, AVAudioPlayerDelegate {
  private(set) var isPlaying = false
  /// いま鳴らしている録音のファイル。止まっていれば nil
  private(set) var playingURL: URL?
  @ObservationIgnored private var player: AVAudioPlayer?
  @ObservationIgnored private var sessionActive = false

  func toggle(_ audio: RecordedAudio) {
    if isPlaying { stop() } else { play(audio) }
  }

  func play(_ audio: RecordedAudio) {
    stop()
    do {
      let session = AVAudioSession.sharedInstance()
      // 消音モードでも聞こえるようにする（自分で押して聞くため）
      try session.setCategory(.playback, mode: .default)
      try session.setActive(true)
      sessionActive = true
      let player = try AVAudioPlayer(contentsOf: audio.url)
      player.delegate = self
      guard player.play() else { return finish() }
      self.player = player
      isPlaying = true
      playingURL = audio.url
    } catch {
      finish()
    }
  }

  func stop() {
    player?.stop()
    finish()
  }

  private func finish() {
    player = nil
    isPlaying = false
    playingURL = nil
    guard sessionActive else { return }
    sessionActive = false
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  /// その録音を鳴らしているか（何枚かの「あなたの描写」が 1 つの VoicePlayer を共有するとき、どれが鳴っているかを見分ける）
  func isPlaying(_ audio: RecordedAudio) -> Bool {
    isPlaying && playingURL == audio.url
  }

  /// その録音を鳴らしていれば止め、そうでなければ（ほかの録音を止めて）鳴らす
  func toggle(only audio: RecordedAudio) {
    if isPlaying(audio) { stop() } else { play(audio) }
  }

  /// 最後まで流れたら元に戻す
  nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    let id = ObjectIdentifier(player)
    Task { @MainActor in
      if let current = self.player, ObjectIdentifier(current) == id { self.finish() }
    }
  }
}
