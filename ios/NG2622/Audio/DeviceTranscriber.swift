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

  /// 文字起こしの文と、語ごとの録音の中の位置（ミリ秒）
  struct Timed: Sendable {
    let text: String
    let words: [(word: String, offsetMs: Int, durationMs: Int)]
  }

  /// WAV を文字起こしする。何も聞き取れない・使えない・時間切れのときは nil
  static func transcribe(_ url: URL) async -> String? {
    await withTimeout { await run(url, withTimes: false)?.text }
  }

  /// 文字起こしに、語ごとの録音の中の位置も付ける（Mock の振り返りで、自分の声の単語を聞き比べるのに使う）
  static func transcribeWithTimes(_ url: URL) async -> Timed? {
    await withTimeout { await run(url, withTimes: true) }
  }

  private static func withTimeout<T: Sendable>(_ work: @escaping @Sendable () async -> T?) async -> T? {
    await withTaskGroup(of: T?.self) { group in
      group.addTask { await work() }
      group.addTask {
        try? await Task.sleep(for: timeout)
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
  }

  private static func run(_ url: URL, withTimes: Bool) async -> Timed? {
    guard SpeechTranscriber.isAvailable,
      let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
    else { return nil }
    var preset = SpeechTranscriber.Preset.transcription
    // 区切りごとに、録音の中の時刻（CMTimeRange）を付けてもらう
    if withTimes { preset.attributeOptions.insert(.audioTimeRange) }
    let transcriber = SpeechTranscriber(locale: supported, preset: preset)
    // ダウンロードは部屋に入ったときの prepare() に任せ、ここでは待たない
    guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
      transcriptLog.notice("文字起こしの音声モデルがまだ入っていません")
      return nil
    }
    do {
      let file = try AVAudioFile(forReading: url)
      let analyzer = SpeechAnalyzer(modules: [transcriber])
      // .transcription の preset は確定した結果だけを、区切りごとに返す
      async let segments = transcriber.results.reduce(into: [AttributedString]()) {
        $0.append($1.text)
      }
      if let last = try await analyzer.analyzeSequence(from: file) {
        try await analyzer.finalizeAndFinish(through: last)
      } else {
        await analyzer.cancelAndFinishNow()
      }
      let results = try await segments
      let text = results.map { String($0.characters) }.joined(separator: " ")
        .split(whereSeparator: \.isWhitespace).joined(separator: " ")
      guard !text.isEmpty else { return nil }
      return Timed(text: text, words: withTimes ? results.flatMap(timedWords) : [])
    } catch {
      transcriptLog.error("文字起こしに失敗しました: \(error, privacy: .public)")
      return nil
    }
  }

  /// 時刻の付いた区切りを語に分ける。1 つの区切りに語が複数あれば、時刻を等分する
  private static func timedWords(_ text: AttributedString) -> [(word: String, offsetMs: Int, durationMs: Int)] {
    text.runs.flatMap { run -> [(word: String, offsetMs: Int, durationMs: Int)] in
      guard let range = run.audioTimeRange else { return [] }
      let words = String(text[run.range].characters).split(whereSeparator: \.isWhitespace).map(String.init)
      guard !words.isEmpty else { return [] }
      let start = range.start.seconds * 1000
      let each = range.duration.seconds * 1000 / Double(words.count)
      return words.enumerated().map { i, word in
        (word, Int((start + each * Double(i)).rounded()), Int(each.rounded()))
      }
    }
  }
}
