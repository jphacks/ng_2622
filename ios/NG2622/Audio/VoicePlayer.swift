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

/// お手本の英文を読み上げる（振り返りの「こう言い換える」）
@Observable
final class SpeechPlayer {
  private(set) var isSpeaking = false
  @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
  @ObservationIgnored private let delegate = Delegate()
  @ObservationIgnored private var sessionActive = false

  init() {
    delegate.onFinish = { [weak self] in self?.finish() }
    synthesizer.delegate = delegate
  }

  func toggle(_ text: String) {
    if isSpeaking { stop() } else { speak(text) }
  }

  func speak(_ text: String) {
    stop()
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    do {
      let session = AVAudioSession.sharedInstance()
      // 消音モードでも聞こえるようにする（自分で押して聞くため）
      try session.setCategory(.playback, mode: .spokenAudio)
      try session.setActive(true)
      sessionActive = true
      let utterance = AVSpeechUtterance(string: trimmed)
      utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
      utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.94
      isSpeaking = true
      synthesizer.speak(utterance)
    } catch {
      finish()
    }
  }

  func stop() {
    if synthesizer.isSpeaking {
      synthesizer.stopSpeaking(at: .immediate)
    }
    finish()
  }

  private func finish() {
    isSpeaking = false
    guard sessionActive else { return }
    sessionActive = false
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private final class Delegate: NSObject, AVSpeechSynthesizerDelegate {
    nonisolated(unsafe) var onFinish: (@MainActor () -> Void)?

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
      let done = onFinish
      Task { @MainActor in done?() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
      let done = onFinish
      Task { @MainActor in done?() }
    }
  }
}
