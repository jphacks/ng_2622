import SwiftUI

/// 待合でホストが 3D シーンを選ぶ。定番の 3 つから選ぶか、話した文章から AI に作らせる
struct SceneChooser: View {
  let session: RoomSession

  private enum Mode: String, CaseIterable, Identifiable {
    case preset = "定番シーン"
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

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Picker("シーンの選び方", selection: $mode) {
        ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.segmented)

      switch mode {
      case .preset:
        presetPicker
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
    .onDisappear { task?.cancel() }
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
    case .done(let name) where mode == .generated:
      "選んだシーン: \(name)"
    default:
      "選んだシーン: \(session.selectedScene.title)"
    }
  }

  private func generate() {
    let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
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
