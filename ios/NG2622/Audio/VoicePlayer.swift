import AVFoundation
import Observation

/// AVAudioSession を使って声を出す再生。PlaybackSession の持ち主になれる
@MainActor
protocol SessionPlayback: AnyObject {
  func stop()
}

/// AVAudioSession の持ち主を 1 人に決める。新しい再生は前の持ち主を止めてから始まり、
/// 無効にするのは今の持ち主が終わったときだけ。別の再生が後から終わっても、今の再生の音は止まらない
@MainActor
enum PlaybackSession {
  private static weak var owner: (any SessionPlayback)?

  /// この再生が持ち主になる。前の再生は止めてからセッションを有効にする
  static func begin(_ playback: any SessionPlayback, mode: AVAudioSession.Mode) throws {
    if let previous = owner, previous !== playback { previous.stop() }
    owner = playback
    let session = AVAudioSession.sharedInstance()
    // 消音モードでも聞こえるようにする（自分で押して聞くため）
    try session.setCategory(.playback, mode: mode)
    try session.setActive(true)
  }

  /// この再生が終わった。まだ持ち主が自分のときだけセッションを無効にする
  static func end(_ playback: any SessionPlayback) {
    guard owner === playback else { return }
    owner = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}

/// 録った自分の声を再生する（振り返り）
@Observable
@MainActor
final class VoicePlayer: NSObject, AVAudioPlayerDelegate, SessionPlayback {
  private(set) var isPlaying = false
  @ObservationIgnored private var player: AVAudioPlayer?

  func toggle(_ audio: RecordedAudio) {
    if isPlaying { stop() } else { play(audio) }
  }

  func play(_ audio: RecordedAudio) {
    stop()
    do {
      try PlaybackSession.begin(self, mode: .default)
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
    PlaybackSession.end(self)
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
@MainActor
final class SpeechPlayer: SessionPlayback {
  private(set) var isSpeaking = false
  @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
  @ObservationIgnored private let delegate = Delegate()
  /// 今読んでいる発話。止めた発話の終わりの通知が後から届いても、今の読み上げを止めないために見分ける
  @ObservationIgnored private var current: ObjectIdentifier?

  init() {
    delegate.onFinish = { [weak self] id in self?.finish(id) }
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
      try PlaybackSession.begin(self, mode: .spokenAudio)
      let utterance = AVSpeechUtterance(string: trimmed)
      utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
      utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.94
      current = ObjectIdentifier(utterance)
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

  /// 読み上げが終わった（止まった）。id があるときは今の発話のものだけ反映する
  private func finish(_ id: ObjectIdentifier? = nil) {
    if let id, id != current { return }
    current = nil
    isSpeaking = false
    PlaybackSession.end(self)
  }

  private final class Delegate: NSObject, AVSpeechSynthesizerDelegate {
    nonisolated(unsafe) var onFinish: (@MainActor (ObjectIdentifier) -> Void)?

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
      let id = ObjectIdentifier(utterance)
      let done = onFinish
      Task { @MainActor in done?(id) }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
      let id = ObjectIdentifier(utterance)
      let done = onFinish
      Task { @MainActor in done?(id) }
    }
  }
}
