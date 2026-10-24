import AVFoundation
import Observation

/// 録った自分の声を再生する（振り返り）
@Observable
final class VoicePlayer: NSObject, AVAudioPlayerDelegate {
  private(set) var isPlaying = false
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
    guard sessionActive else { return }
    sessionActive = false
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  /// 最後まで流れたら元に戻す
  nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    let id = ObjectIdentifier(player)
    Task { @MainActor in
      if let current = self.player, ObjectIdentifier(current) == id { self.finish() }
    }
  }
}
