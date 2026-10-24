import AVFoundation
import Observation

/// 1 ラウンドで録った自分の音声。端末の一時フォルダに置き、次のラウンドか退出で消す
struct RecordedAudio: Sendable, Equatable {
  /// WAV（16 kHz・16 bit・モノラル）のファイル
  let url: URL
  /// 長さ（秒）
  let duration: TimeInterval
}

/// 録音の形式（docs/design/architecture.md）。Azure の短い音声用 REST にそのまま送れる形
enum RecordingFormat {
  static let sampleRate: Double = 16_000
  static let channels = 1
  static let bitDepth = 16
}

/// 自分の声を録る。AVAudioRecorder に WAV の形式を指定し、変換と書き出しを任せる（音量も測れる）
@Observable
final class VoiceRecorder {
  /// いま録っているか
  private(set) var isRecording = false
  /// このラウンドで録った音声。録る前と、録れなかったときは nil
  private(set) var recording: RecordedAudio?

  @ObservationIgnored private var recorder: AVAudioRecorder?

  /// ラウンドの始めに呼ぶ。前のラウンドのファイルを消し、すぐ録れるように用意する
  func prepare() {
    discard()
    guard AVAudioApplication.shared.recordPermission == .granted else { return }
    do {
      let session = AVAudioSession.sharedInstance()
      // 録った声を振り返りで聞き直すので、出力は受話口ではなくスピーカーにする
      try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
      try session.setActive(true)
      let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("round-\(UUID().uuidString).wav")
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: RecordingFormat.sampleRate,
        AVNumberOfChannelsKey: RecordingFormat.channels,
        AVLinearPCMBitDepthKey: RecordingFormat.bitDepth,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
      ]
      // 拡張子が .wav なので WAV で書き出す
      let recorder = try AVAudioRecorder(url: url, settings: settings)
      recorder.isMeteringEnabled = true
      recorder.prepareToRecord()
      self.recorder = recorder
    } catch {
      // マイクが使えないときは録らずに進める
      recorder = nil
      deactivateSession()
    }
  }

  /// 録り始める。最長 duration 秒で止まる
  func start(duration: TimeInterval) {
    guard let recorder, !recorder.isRecording, duration > 0 else { return }
    isRecording = recorder.record(forDuration: duration)
  }

  /// 止めて、録った音声を返す。録れていなければ nil
  @discardableResult
  func stop() -> RecordedAudio? {
    guard let recorder else { return recording }
    recorder.stop()
    self.recorder = nil
    isRecording = false
    deactivateSession()
    recording = WAVInfo.read(recorder.url).map { info in
      assert(
        info.sampleRate == Int(RecordingFormat.sampleRate) && info.channels == RecordingFormat.channels
          && info.bitDepth == RecordingFormat.bitDepth,
        "録音の形式が違います: \(info)")
      return RecordedAudio(url: recorder.url, duration: info.duration)
    }
    return recording
  }

  /// 録音を止め、ファイルを消す（次のラウンドの前と、退出のとき）
  func discard() {
    if let recorder {
      recorder.stop()
      recorder.deleteRecording()
      self.recorder = nil
      isRecording = false
      deactivateSession()
    }
    if let recording {
      try? FileManager.default.removeItem(at: recording.url)
      self.recording = nil
    }
  }

  private func deactivateSession() {
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}

/// WAV の見出し（fmt と data のチャンク）を読み、形式と長さを確かめる
struct WAVInfo: Equatable {
  let sampleRate: Int
  let channels: Int
  let bitDepth: Int
  /// 音声の部分のバイト数
  let dataSize: Int

  var duration: TimeInterval {
    let bytesPerSecond = sampleRate * channels * bitDepth / 8
    return bytesPerSecond > 0 ? Double(dataSize) / Double(bytesPerSecond) : 0
  }

  static func read(_ url: URL) -> WAVInfo? {
    guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
    // 見出しは先頭にある。埋め草（JUNK・FLLR）で 4 KB ほどになるので、多めに読む
    let bytes = [UInt8](data.prefix(64 * 1024))
    func text(_ at: Int) -> String { String(decoding: bytes[at..<at + 4], as: UTF8.self) }
    func u16(_ at: Int) -> Int { Int(bytes[at]) | Int(bytes[at + 1]) << 8 }
    func u32(_ at: Int) -> Int { u16(at) | u16(at + 2) << 16 }

    guard bytes.count >= 12, text(0) == "RIFF", text(8) == "WAVE" else { return nil }
    var format: (rate: Int, channels: Int, bits: Int)?
    // チャンクを順にたどる。AVAudioRecorder は fmt と data のあいだに埋め草（FLLR）を入れることがある
    var at = 12
    while at + 8 <= bytes.count {
      let size = u32(at + 4)
      switch text(at) {
      case "fmt ":
        guard at + 24 <= bytes.count, u16(at + 8) == 1 else { return nil }  // 1 = 整数の PCM
        format = (u32(at + 12), u16(at + 10), u16(at + 22))
      case "data":
        guard let format else { return nil }
        // 止めた直後は見出しの大きさが書き換わっていないことがあるので、ファイルの大きさでも抑える
        let size = min(size, data.count - (at + 8))
        return WAVInfo(sampleRate: format.rate, channels: format.channels, bitDepth: format.bits, dataSize: size)
      default:
        break
      }
      at += 8 + size + (size & 1)
    }
    return nil
  }
}
