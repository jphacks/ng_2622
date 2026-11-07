import AVFoundation
import Observation

/// 録った自分の声を再生する（振り返り）
@Observable
final class VoicePlayer: NSObject, AVAudioPlayerDelegate {
  private(set) var isPlaying = false
  @ObservationIgnored private var player: AVAudioPlayer?
  @ObservationIgnored private var sessionActive = false
  /// 一部だけ流すとき、終わりの時刻で止める
  @ObservationIgnored private var stopTask: Task<Void, Never>?

  func toggle(_ audio: RecordedAudio) {
    if isPlaying { stop() } else { play(audio) }
  }

  /// segment を渡すと、録音の頭からその範囲（秒）だけを流す（振り返りの単語の聞き比べ）
  func play(_ audio: RecordedAudio, segment: Range<TimeInterval>? = nil) {
    stop()
    do {
      let session = AVAudioSession.sharedInstance()
      // 消音モードでも聞こえるようにする（自分で押して聞くため）
      try session.setCategory(.playback, mode: .default)
      try session.setActive(true)
      sessionActive = true
      let player = try AVAudioPlayer(contentsOf: audio.url)
      player.delegate = self
      if let segment { player.currentTime = max(0, segment.lowerBound) }
      guard player.play() else { return finish() }
      self.player = player
      isPlaying = true
      if let segment {
        let id = ObjectIdentifier(player)
        stopTask = Task { [weak self] in
          try? await Task.sleep(for: .seconds(segment.upperBound - segment.lowerBound))
          guard !Task.isCancelled, let self, let current = self.player, ObjectIdentifier(current) == id else { return }
          self.stop()
        }
      }
    } catch {
      finish()
    }
  }

  func stop() {
    stopTask?.cancel()
    stopTask = nil
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
