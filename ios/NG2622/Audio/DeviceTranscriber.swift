import AVFoundation
import OSLog
import Speech
import Synchronization

let transcriptLog = Logger(subsystem: "jp.jphacks.ng2622", category: "Transcript")

/// 録った声を端末の中で文字起こしする（SpeechAnalyzer）。結果は音声と一緒にバックエンドへ送り、
/// Azure の発音評価の正解文と Claude の採点に使う。使えない・失敗したときは nil で、バックエンドは Azure の文字起こしを使う
enum DeviceTranscriber {
  /// 採点は en-US で行う（backend/src/scoring/azure.ts）
  private static let locale = Locale(identifier: "en-US")
  /// これより長くかかったら諦めて、文字起こしなしで送る。サーバーは録音の終わりから RoundTiming.audioGrace（15 秒）
  /// しか音声を待たない。過ぎて届いた音声は断られ、「採点できませんでした」になる
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

  /// WAV を文字起こしする。何も聞き取れない・使えない・時間切れのときは nil。
  /// 文字起こしが終わらなくても、timeout を過ぎたら必ず nil で戻る（first(within:_:)）
  static func transcribe(_ url: URL) async -> String? {
    let started = ContinuousClock.now
    let text = await first(within: timeout) { await run(url) }
    if text == nil, ContinuousClock.now - started >= timeout {
      transcriptLog.notice("文字起こしが \(timeout, privacy: .public) で終わらなかったので、文字起こしなしで送ります")
    }
    return text
  }

  /// work が within のうちに返ればその値を、返らなければ nil を返す。時間切れのときは work を取り消す（cancel）。
  ///
  /// withTaskGroup では作らない。group は子のタスクが全部終わるまで戻らないので、work が取り消しに応じないと
  /// 時間切れが効かない（SpeechAnalyzer は応じず、最後まで文字起こしを続けてから返る。Mac で確かめた）。
  /// その間は音声を送らないので、サーバーの音声の締め切りを過ぎて「採点できませんでした」になる。
  /// ここでは work と時間切れを構造化されていない Task で走らせ、先に来た方だけで一度だけ resume する。
  /// 呼んだ側が取り消されても、within までは待つ
  nonisolated static func first(
    within limit: Duration, _ work: @escaping @Sendable () async -> String?
  ) async -> String? {
    var tasks: [Task<Void, Never>] = []
    let value = await withCheckedContinuation { (continuation: CheckedContinuation<String?, Never>) in
      let once = ResumeOnce(continuation)
      tasks = [
        Task { once.resume(await work()) },
        Task {
          // work が先に返って取り消されたら、何もしない
          guard (try? await Task.sleep(for: limit)) != nil else { return }
          once.resume(nil)
        },
      ]
    }
    // 時間切れなら work を、work が先なら時間切れの待ちを止める（終わった Task の cancel は何もしない）
    for task in tasks { task.cancel() }
    return value
  }

  private static func run(_ url: URL) async -> String? {
    guard SpeechTranscriber.isAvailable,
      let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
    else { return nil }
    let transcriber = SpeechTranscriber(locale: supported, preset: .transcription)
    // ダウンロードは部屋に入ったときの prepare() に任せ、ここでは待たない
    guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
      transcriptLog.notice("文字起こしの音声モデルがまだ入っていません")
      return nil
    }
    let file: AVAudioFile
    do {
      file = try AVAudioFile(forReading: url)
    } catch {
      transcriptLog.error("文字起こしの音声を読めませんでした: \(error, privacy: .public)")
      return nil
    }
    // 準備を待つ間に時間切れになっていたら、文字起こしを始めない
    if Task.isCancelled { return nil }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    // SpeechAnalyzer は Task の取り消しに応じないので、時間切れで取り消されたら自分で止める
    // （裏で文字起こしを続けて、次のラウンドの文字起こしと取り合わないように）
    return await withTaskCancellationHandler {
      // .transcription の preset は確定した結果だけを、区切りごとに返す
      async let segments = transcriber.results.reduce(into: [String]()) {
        $0.append(String($1.text.characters))
      }
      do {
        if let last = try await analyzer.analyzeSequence(from: file) {
          try await analyzer.finalizeAndFinish(through: last)
        } else {
          await analyzer.cancelAndFinishNow()
        }
        let text = try await segments.joined(separator: " ")
          .split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return text.isEmpty ? nil : text
      } catch {
        // 途中で失敗したら、結果の流れを閉じてから抜ける（閉じないと、抜けるときに segments の終わりを待ち続ける）
        await analyzer.cancelAndFinishNow()
        // 時間切れで取り消されたときは、transcribe がログに出している
        if !Task.isCancelled {
          transcriptLog.error("文字起こしに失敗しました: \(error, privacy: .public)")
        }
        return nil
      }
    } onCancel: {
      Task { await analyzer.cancelAndFinishNow() }
    }
  }
}

/// continuation を一度だけ resume する。2 度目からは何もしない（work と時間切れの、後から来た方）
nonisolated private final class ResumeOnce: Sendable {
  private let continuation: Mutex<CheckedContinuation<String?, Never>?>

  init(_ continuation: CheckedContinuation<String?, Never>) {
    self.continuation = Mutex(continuation)
  }

  func resume(_ value: String?) {
    continuation.withLock { $0.take() }?.resume(returning: value)
  }
}
