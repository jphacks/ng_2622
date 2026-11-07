import AVFoundation
import Observation

/// 発音のお手本を、端末の音声合成（AVSpeechSynthesizer・en-US）で読み上げる。
/// 正答例（待機）・言い換えの文と単語（振り返り）に使う。採点には使わない
@Observable
final class ModelVoice {
  /// いま読み上げている文。読み上げていなければ nil
  private(set) var speakingText: String?
  @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
  @ObservationIgnored private let delegate = SpeechDelegate()
  @ObservationIgnored private var utterance: AVSpeechUtterance?
  @ObservationIgnored private var onFinish: (() -> Void)?
  @ObservationIgnored private var sessionActive = false

  init() {
    synthesizer.delegate = delegate
    delegate.onFinish = { [weak self] id in
      Task { @MainActor in self?.didFinish(id) }
    }
  }

  /// text を読み上げる。最後まで読み終えたら onFinish を呼ぶ（止めたときは呼ばない）
  func speak(_ text: String, onFinish: (() -> Void)? = nil) {
    stop()
    do {
      let session = AVAudioSession.sharedInstance()
      // 消音モードでも聞こえるようにする（自分で押して聞くため）
      try session.setCategory(.playback, mode: .spokenAudio)
      try session.setActive(true)
      sessionActive = true
    } catch {
      return
    }
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = Self.voice
    self.utterance = utterance
    self.onFinish = onFinish
    speakingText = text
    synthesizer.speak(utterance)
  }

  func stop() {
    onFinish = nil
    utterance = nil
    if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    finish()
  }

  private func finish() {
    speakingText = nil
    guard sessionActive else { return }
    sessionActive = false
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  /// en-US の声のうち、端末に入っている中で最も品質の高いもの（プレミアム → 拡張 → 標準）
  private static let voice: AVSpeechSynthesisVoice? = {
    let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == "en-US" }
    return voices.max { $0.quality.rawValue < $1.quality.rawValue } ?? AVSpeechSynthesisVoice(language: "en-US")
  }()

  /// 最後まで読み終えたら元に戻し、続きの処理（自分の録音の再生など）を呼ぶ。止めた後の古い読み上げの通知は無視する
  private func didFinish(_ id: ObjectIdentifier) {
    guard let current = utterance, ObjectIdentifier(current) == id else { return }
    let next = onFinish
    onFinish = nil
    utterance = nil
    finish()
    next?()
  }
}

/// AVSpeechSynthesizer の通知を受ける。通知は主スレッドの外から来るので、ModelVoice とは分けて actor に属さないようにする
private nonisolated final class SpeechDelegate: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
  /// 読み終えた読み上げ（ObjectIdentifier）を渡す。ModelVoice の init で一度だけ入れる
  var onFinish: (@Sendable (ObjectIdentifier) -> Void)?

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    onFinish?(ObjectIdentifier(utterance))
  }
}
