import Observation
import SwiftUI

/// ホストの一言から場面を作る（POST /scenes/generate）。作れたら配置の JSON も取っておき、すぐ出せるようにする
@Observable
final class SceneGenerator {
  enum State: Equatable {
    case idle
    case generating(startedAt: Date)
    /// 作れなかった。画面には error.reason を出す
    case failed(SceneLayoutError)
  }

  /// 作った場面
  struct Made: Equatable {
    let id: String
    let name: String
    let difficulty: SceneDifficulty
    /// 何度目に作れたか。作り直して同じ場面が返っても別の Made になり、待合が作れたことに気づける
    let serial: Int
  }

  /// 一言の長さの上限
  nonisolated static let maxPromptLength = 40
  /// 待つ時間の目安（進み具合のバーに使う）。バックエンドは長くて 20 秒で返す
  static let expectedWait: TimeInterval = 20
  /// これを過ぎたら待つのをやめ、「時間がかかりすぎた」にする
  static let timeout: Duration = .seconds(SceneLayouts.generateTimeout)

  var prompt = ""
  var difficulty = SceneDifficulty.easy
  private(set) var state = State.idle
  /// 最後に作れた場面
  private(set) var made: Made?

  private let client: any SceneLayoutClient
  private let store: SceneLayoutStore
  private var task: Task<Void, Never>?
  private var timer: Task<Void, Never>?
  private var serial = 0

  init(client: any SceneLayoutClient = SceneLayouts.client, store: SceneLayoutStore = SceneLayouts.store) {
    self.client = client
    self.store = store
  }

  var trimmedPrompt: String {
    prompt.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var isGenerating: Bool {
    if case .generating = state { true } else { false }
  }

  var canGenerate: Bool {
    !trimmedPrompt.isEmpty && !isGenerating
  }

  func generate() {
    guard canGenerate else { return }
    let prompt = String(trimmedPrompt.prefix(Self.maxPromptLength))
    let difficulty = difficulty
    state = .generating(startedAt: Date())
    task = Task { [weak self, client, store] in
      do {
        let id = try await client.generate(prompt: prompt, difficulty: difficulty)
        // 名前を出すのと、スタートしてすぐ出せるように、配置の JSON と部品を先に読んでおく
        let layout = try await store.layout(of: id)
        SceneLibrary.shared.preload([id])
        guard let self, !Task.isCancelled else { return }
        timer?.cancel()
        serial += 1
        made = Made(id: id, name: layout.name, difficulty: difficulty, serial: serial)
        state = .idle
      } catch {
        guard let self, !Task.isCancelled else { return }
        timer?.cancel()
        state = .failed(error as? SceneLayoutError ?? .connectionFailed)
      }
    }
    // 通信の待ち時間（URLRequest の timeoutInterval）は無通信の間しか数えないので、全体の時間もここで区切る
    timer = Task { [weak self] in
      try? await Task.sleep(for: Self.timeout)
      guard let self, !Task.isCancelled, isGenerating else { return }
      task?.cancel()
      task = nil
      state = .failed(.timedOut)
    }
  }

  /// 待つのをやめる
  func cancel() {
    task?.cancel()
    task = nil
    timer?.cancel()
    timer = nil
    state = .idle
  }
}

/// 「AI で作る」の画面（シート）。一言と難しさを入れて作る。失敗したら理由を出し、やり直すか同梱のシーンに戻れる
struct SceneGenerateSheet: View {
  @Bindable var generator: SceneGenerator
  @Environment(\.dismiss) private var dismiss
  @FocusState private var focused: Bool

  private static let examples = ["リンゴが落ちる公園", "テーブルのある部屋", "犬とボールで遊ぶ"]

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 4) {
          Text("AI で場面を作る")
            .font(Theme.font(24, .black))
          Text("一言で、みんなで話す場面を作ります")
            .font(Theme.font(14, .bold))
            .foregroundStyle(Theme.muted)
        }
        Spacer()
        CircleIconButton(systemName: "xmark", label: "閉じる") { dismiss() }
      }
      .padding(.top, 24)

      promptField
        .padding(.top, 20)
      examples
        .padding(.top, 10)
      difficultyPicker
        .padding(.top, 22)

      Spacer(minLength: 16)
      status
      actions
        .padding(.top, 14)
        .padding(.bottom, 20)
    }
    .padding(.horizontal, 22)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(Theme.background.ignoresSafeArea())
    .foregroundStyle(Theme.ink)
    .animation(.easeOut(duration: 0.25), value: generator.state)
    .onAppear { if generator.prompt.isEmpty { focused = true } }
  }

  private var promptField: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("お題")
        .font(Theme.font(16, .heavy))
      TextField("例: リンゴが落ちる公園", text: $generator.prompt)
        .font(Theme.font(20, .heavy))
        .focused($focused)
        .submitLabel(.done)
        .onSubmit { generator.generate() }
        .onChange(of: generator.prompt) { _, text in
          if text.count > SceneGenerator.maxPromptLength {
            generator.prompt = String(text.prefix(SceneGenerator.maxPromptLength))
          }
        }
        .padding(.horizontal, 18)
        .frame(height: 60)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay {
          RoundedRectangle(cornerRadius: 18)
            .strokeBorder(focused ? Theme.accent : Theme.line, lineWidth: focused ? 2.5 : 1.5)
        }
        .disabled(generator.isGenerating)
    }
  }

  private var examples: some View {
    HStack(spacing: 6) {
      ForEach(Self.examples, id: \.self) { example in
        Button {
          generator.prompt = example
        } label: {
          Text(example)
            .font(Theme.font(12, .heavy))
            .foregroundStyle(Theme.accent)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(Theme.accentSoft, in: Capsule())
        }
        .buttonStyle(.plain)
      }
    }
    .disabled(generator.isGenerating)
  }

  private var difficultyPicker: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("難しさ")
        .font(Theme.font(16, .heavy))
      HStack(spacing: 8) {
        ForEach(SceneDifficulty.allCases) { level in
          let on = generator.difficulty == level
          Button {
            generator.difficulty = level
          } label: {
            Text(level.label)
              .font(Theme.font(16, .heavy))
              .foregroundStyle(on ? .white : Theme.accent)
              .frame(maxWidth: .infinity)
              .frame(height: 44)
              .background(on ? Theme.accent : Theme.card, in: Capsule())
              .overlay { Capsule().strokeBorder(on ? Theme.accent : Theme.accentSoft, lineWidth: 2) }
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(on ? .isSelected : [])
        }
      }
      .disabled(generator.isGenerating)
    }
  }

  /// 待っている間の進み具合か、作れなかった理由
  @ViewBuilder private var status: some View {
    switch generator.state {
    case .generating(let startedAt):
      GeneratingCard(startedAt: startedAt)
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    case .failed(let error):
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: "exclamationmark.triangle.fill")
          .font(.system(size: 20, weight: .bold))
          .foregroundStyle(Theme.red)
        VStack(alignment: .leading, spacing: 4) {
          Text("作れませんでした")
            .font(Theme.font(16, .heavy))
          Text(error.reason)
            .font(Theme.font(14, .bold))
            .foregroundStyle(Theme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 0)
      }
      .padding(16)
      .background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
      .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.red.opacity(0.35), lineWidth: 1.5) }
      .transition(.opacity.combined(with: .move(edge: .bottom)))
    case .idle:
      EmptyView()
    }
  }

  @ViewBuilder private var actions: some View {
    switch generator.state {
    case .generating:
      Button("やめる") { generator.cancel() }
        .buttonStyle(BigButtonStyle(kind: .outlined))
    case .failed:
      VStack(spacing: 14) {
        Button("もう一度作る") { generator.generate() }
          .buttonStyle(BigButtonStyle(kind: .primary))
          .disabled(!generator.canGenerate)
        Button("用意されたシーンから選ぶ") { dismiss() }
          .buttonStyle(BigButtonStyle(kind: .outlined))
      }
    case .idle:
      Button("作る") {
        focused = false
        generator.generate()
      }
      .buttonStyle(BigButtonStyle(kind: .primary))
      .disabled(!generator.canGenerate)
    }
  }
}

/// 作っている間の表示。長くて 20 秒なので、時間に合わせてバーを伸ばす（終わるまで 9 割で止める）
private struct GeneratingCard: View {
  let startedAt: Date

  var body: some View {
    TimelineView(.animation) { context in
      let elapsed = context.date.timeIntervalSince(startedAt)
      let progress = min(0.9, elapsed / SceneGenerator.expectedWait)
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 10) {
          ProgressView()
            .tint(Theme.accent)
          Text("場面を作っています")
            .font(Theme.font(16, .heavy))
          Spacer()
          Text("\(Int(elapsed)) 秒")
            .font(Theme.font(14, .heavy))
            .monospacedDigit()
            .foregroundStyle(Theme.muted)
        }
        GeometryReader { geo in
          Capsule()
            .fill(Theme.accentSoft)
            .overlay(alignment: .leading) {
              Capsule()
                .fill(Theme.accent)
                .frame(width: geo.size.width * progress)
            }
        }
        .frame(height: 10)
        Text("部品を選んで並べています。長くて 20 秒ほどかかります")
          .font(Theme.font(12, .bold))
          .foregroundStyle(Theme.muted)
      }
      .padding(16)
      .background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
    }
  }
}
