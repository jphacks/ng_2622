import AVFoundation
import OSLog
import Speech

let transcriptLog = Logger(subsystem: "jp.jphacks.ng2622", category: "Transcript")

/// 録った声を端末の中で文字起こしする（SpeechAnalyzer）。結果は音声と一緒にバックエンドへ送り、
/// Azure の発音評価の正解文と Claude の採点に使う。使えない・失敗したときは nil で、バックエンドは Azure の文字起こしを使う
enum DeviceTranscriber {
  /// 採点は en-US で行う（backend/src/scoring/azure.ts）
  private static let locale = Locale(identifier: "en-US")
  /// これより長くかかったら諦めて、文字起こしなしで送る（送るのが遅れると、ラウンドが終わらない）
  private static let timeout: Duration = .seconds(5)

  /// 音声モデルが端末に無ければ入れる。初回はダウンロードが要るので、部屋に入ったときに呼んでおく
  @discardableResult
  static func prepare() async -> SpeechTranscriber? {
    guard SpeechTranscriber.isAvailable,
      let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
    else {
      transcriptLog.notice("この端末では英語の文字起こしが使えません")
      return nil
    }
    let transcriber = SpeechTranscriber(locale: supported, preset: .transcription)
    do {
      if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        try await request.downloadAndInstall()
      }
      return transcriber
    } catch {
      transcriptLog.error("文字起こしの音声モデルを入れられませんでした: \(error, privacy: .public)")
      return nil
    }
  }

  /// WAV を文字起こしする。何も聞き取れない・使えない・時間切れのときは nil
  static func transcribe(_ url: URL) async -> String? {
    await withTaskGroup(of: String?.self) { group in
      group.addTask { await run(url) }
      group.addTask {
        try? await Task.sleep(for: timeout)
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
  }

  private static func run(_ url: URL) async -> String? {
    guard let transcriber = await prepare() else { return nil }
    do {
      let file = try AVAudioFile(forReading: url)
      let analyzer = SpeechAnalyzer(modules: [transcriber])
      // .transcription の preset は確定した結果だけを、区切りごとに返す
      async let segments = transcriber.results.reduce(into: [String]()) {
        $0.append(String($1.text.characters))
      }
      if let last = try await analyzer.analyzeSequence(from: file) {
        try await analyzer.finalizeAndFinish(through: last)
      } else {
        await analyzer.cancelAndFinishNow()
      }
      let text = try await segments.joined(separator: " ")
        .split(whereSeparator: \.isWhitespace).joined(separator: " ")
      return text.isEmpty ? nil : text
    } catch {
      transcriptLog.error("文字起こしに失敗しました: \(error, privacy: .public)")
      return nil
    }
  }
}
