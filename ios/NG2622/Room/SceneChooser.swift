import AVFAudio
import Observation
import Speech
import SwiftUI

/// 待合でホストが 3D シーンを選ぶ。定番の 3 つから選ぶか、声・文章から AI に作らせる
struct SceneChooser: View {
  let session: RoomSession

  private enum Mode: String, CaseIterable, Identifiable {
    case preset = "定番シーン"
    case voice = "声で作る"
    case generated = "文章で作る"

    var id: Self { self }
  }

  private enum Status: Equatable {
    case idle
    case generating
    case done(String)
    case failed
  }

  @State private var mode: Mode = .preset
  @State private var prompt = "A sunny park with two cherry blossom trees, a small pond, a bench, and a girl walking a dog."
  @State private var status: Status = .idle
  @State private var task: Task<Void, Never>?
  @State private var recorder = VoicePromptRecorder()

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Picker("シーンの選び方", selection: $mode) {
        ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.segmented)
      .onChange(of: mode) { _, newMode in
        if newMode != .voice && recorder.isRecording {
          recorder.stop()
        }
      }

      switch mode {
      case .preset:
        presetPicker
      case .voice:
        voiceGenerator
      case .generated:
        generator
      }

      Text(currentTitle)
        .font(Theme.font(13, .heavy))
        .foregroundStyle(Theme.muted)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(14)
    .background(RoundedRectangle(cornerRadius: 22).fill(Theme.card).shadow(color: Theme.ink.opacity(0.07), radius: 10, y: 6))
    .onDisappear {
      recorder.stop()
      task?.cancel()
    }
  }

  /// 定番の 3 つ
  private var presetPicker: some View {
    HStack(spacing: 8) {
      ForEach(SceneChoice.presets, id: \.sceneID) { scene in
        Button(scene.title) { session.choose(scene) }
          .font(Theme.font(15, .heavy))
          .frame(maxWidth: .infinity)
          .padding(.vertical, 10)
          .background(
            RoundedRectangle(cornerRadius: 14)
              .fill(session.selectedScene == scene ? Theme.accentSoft : Theme.line)
          )
          .foregroundStyle(session.selectedScene == scene ? Theme.accent : Theme.muted)
      }
    }
  }

  /// 声で話して作る
  private var voiceGenerator: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .top, spacing: 8) {
        Image(systemName: recorder.isRecording ? "waveform.circle.fill" : "mic.circle.fill")
          .font(.system(size: 22, weight: .bold))
          .foregroundStyle(recorder.isRecording ? Theme.red : Theme.accent)
        Text(prompt.isEmpty ? "ボタンを押して作りたい場面を英語で話してください" : prompt)
          .font(Theme.font(14, .bold))
          .foregroundStyle(prompt.isEmpty ? Theme.gray : Theme.ink)
          .frame(maxWidth: .infinity, alignment: .leading)
          .lineLimit(3)
      }
      .padding(10)
      .background(RoundedRectangle(cornerRadius: 12).fill(Theme.line))

      if let error = recorder.errorMessage {
        Text(error)
          .font(Theme.font(12, .bold))
          .foregroundStyle(Theme.red)
      }

      HStack(spacing: 8) {
        Button {
          if recorder.isRecording {
            recorder.stop()
            if !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
              generate()
            }
          } else {
            prompt = ""
            recorder.start { transcript in
              prompt = transcript
            }
          }
        } label: {
          HStack(spacing: 6) {
            Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill")
            Text(
              status == .generating
                ? "作っています…"
                : (recorder.isRecording ? "話し終えて作る" : "声で話す")
            )
          }
          .font(Theme.font(15, .heavy))
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
          .background(
            Capsule().fill(recorder.isRecording ? Theme.red : Theme.accent)
          )
          .foregroundStyle(.white)
        }
        .disabled(status == .generating)

        if !recorder.isRecording && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          Button("再生成", action: generate)
            .font(Theme.font(14, .heavy))
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Capsule().fill(Theme.accentSoft))
            .foregroundStyle(Theme.accent)
            .disabled(status == .generating)
        }
      }
    }
  }

  /// 文章から作る
  private var generator: some View {
    VStack(alignment: .leading, spacing: 10) {
      TextField("場面を英文で書く", text: $prompt, axis: .vertical)
        .lineLimit(2...4)
        .font(Theme.font(14, .bold))
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.line))
        .disabled(status == .generating)

      Button(status == .generating ? "作っています…" : "この文章で作る", action: generate)
        .buttonStyle(BigButtonStyle(kind: .outlined))
        .disabled(status == .generating || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
  }

  /// 結果の一行（いま選ばれているシーン、または失敗）
  private var currentTitle: String {
    switch status {
    case .failed:
      "作れませんでした。サーバー（ai_generator.py）が動いているか確かめてください"
    case .done(let name) where mode != .preset:
      "選んだシーン: \(name)"
    default:
      "選んだシーン: \(session.selectedScene.title)"
    }
  }

  private func generate() {
    let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    status = .generating
    task?.cancel()
    task = Task {
      do {
        let scene = try await SceneGenerator.generate(prompt: text, endpoint: AppConfig.current.sceneGeneratorURL)
        session.choose(scene)
        status = .done(scene.title)
      } catch {
        status = .failed
      }
    }
  }
}

/// マイクから英語の音声を聞き取ってリアルタイムに文字にする
@Observable
final class VoicePromptRecorder {
  private(set) var isRecording = false
  private(set) var errorMessage: String?

  private var audioEngine: AVAudioEngine?
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))

  func start(onTranscript: @escaping (String) -> Void) {
    guard !isRecording else { return }
    errorMessage = nil

    Task {
      let speechStatus = await Self.requestSpeechAuthorization()
      guard speechStatus == .authorized else {
        errorMessage = "設定で音声認識を許可してください"
        return
      }
      let micGranted = await AVAudioApplication.requestRecordPermission()
      guard micGranted else {
        errorMessage = "設定でマイクを許可してください"
        return
      }
      beginRecordingSession(onTranscript: onTranscript)
    }
  }

  func stop() {
    audioEngine?.stop()
    audioEngine?.inputNode.removeTap(onBus: 0)
    recognitionRequest?.endAudio()
    recognitionTask?.cancel()
    audioEngine = nil
    recognitionRequest = nil
    recognitionTask = nil
    isRecording = false
  }

  private func beginRecordingSession(onTranscript: @escaping (String) -> Void) {
    stop()
    guard let recognizer = speechRecognizer, recognizer.isAvailable else {
      errorMessage = "現在この端末で音声認識を使えません"
      return
    }

    do {
      let audioSession = AVAudioSession.sharedInstance()
      try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
      try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

      let engine = AVAudioEngine()
      let inputFormat = engine.inputNode.inputFormat(forBus: 0)
      guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
        errorMessage = "マイクの入力が見つかりません"
        return
      }
      let request = SFSpeechAudioBufferRecognitionRequest()
      request.shouldReportPartialResults = true

      Self.installAudioTap(on: engine.inputNode, request: request)
      engine.prepare()
      try engine.start()

      audioEngine = engine
      recognitionRequest = request
      isRecording = true

      recognitionTask = Self.startRecognitionTask(recognizer: recognizer, request: request) { [weak self] text, _ in
        guard let self, self.isRecording else { return }
        if let text, !text.isEmpty {
          onTranscript(text)
        }
      }
    } catch {
      errorMessage = "マイクの起動に失敗しました"
      stop()
    }
  }

  private nonisolated static func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
    await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { status in
        continuation.resume(returning: status)
      }
    }
  }

  private nonisolated static func installAudioTap(
    on inputNode: AVAudioInputNode,
    request: SFSpeechAudioBufferRecognitionRequest
  ) {
    inputNode.removeTap(onBus: 0)
    inputNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in
      request.append(buffer)
    }
  }

  private nonisolated static func startRecognitionTask(
    recognizer: SFSpeechRecognizer,
    request: SFSpeechAudioBufferRecognitionRequest,
    onUpdate: @MainActor @Sendable @escaping (String?, Bool) -> Void
  ) -> SFSpeechRecognitionTask {
    recognizer.recognitionTask(with: request) { result, error in
      let transcript = result?.bestTranscription.formattedString
      let isFinal = (result?.isFinal ?? false) || (error != nil)
      Task { @MainActor in
        onUpdate(transcript, isFinal)
      }
    }
  }
}
