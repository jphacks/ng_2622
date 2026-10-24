import Foundation
import SwiftUI

/// 開発用の付箋の画面（Mock のときだけ出す）。
/// モード 1（定番シーン: 公園・教室・駅前）と、モード 2（ホストの声・文章から AI が 3D シーンを生成）を切り替えられる
struct DevLauncherView: View {
  enum SceneMode: String, CaseIterable {
    case preset = "定番シーン"
    case aiPrompt = "声・文章で作る"
  }

  let onStart: (MockGameClient.Options) -> Void
  @State private var options = MockGameClient.Options()
  @State private var sceneMode: SceneMode = .preset
  @State private var promptText = "A sunny park with two cherry blossom trees, a small pond, a bench, and a girl walking a dog."
  @State private var generatorServerURL = "http://localhost:8790"
  @State private var isGenerating = false
  @State private var errorMessage: String?

  var body: some View {
    VStack(spacing: 0) {
      Spacer()
      VStack(alignment: .leading, spacing: 16) {
        Text("仮の入り口（Mock）")
          .font(Theme.font(20, .black))
        Text("定番の 3D シーンを選ぶか、ホストが話した文章から AI（Claude + Blender）で新しい 3D シーンを生成して始められます。")
          .font(Theme.font(13, .bold))
          .foregroundStyle(Theme.muted)
          .fixedSize(horizontal: false, vertical: true)

        VStack(alignment: .leading, spacing: 8) {
          Text("シーンのモード").font(Theme.font(13, .bold)).foregroundStyle(Theme.muted)
          Picker("シーンのモード", selection: $sceneMode) {
            ForEach(SceneMode.allCases, id: \.self) { mode in
              Text(mode.rawValue).tag(mode)
            }
          }
          .pickerStyle(.segmented)
        }

        if sceneMode == .preset {
          VStack(alignment: .leading, spacing: 8) {
            Text("定番シーン").font(Theme.font(13, .bold)).foregroundStyle(Theme.muted)
            Picker("定番シーン", selection: $options.sceneID) {
              Text("公園").tag("park")
              Text("教室").tag("classroom")
              Text("駅前").tag("station")
            }
            .pickerStyle(.segmented)
          }
        } else {
          VStack(alignment: .leading, spacing: 8) {
            Text("場面の指定（マイク音声入力 / 文章）")
              .font(Theme.font(13, .bold))
              .foregroundStyle(Theme.muted)
            TextField("例: A snowy park with a dog and a bench...", text: $promptText, axis: .vertical)
              .lineLimit(2...4)
              .font(Theme.font(14, .bold))
              .padding(10)
              .background(.white, in: RoundedRectangle(cornerRadius: 8))
            TextField("生成サーバー URL", text: $generatorServerURL)
              .font(.system(size: 12, design: .monospaced))
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .padding(8)
              .background(.white.opacity(0.8), in: RoundedRectangle(cornerRadius: 6))
          }
        }

        VStack(alignment: .leading, spacing: 8) {
          Text("視点").font(Theme.font(13, .bold)).foregroundStyle(Theme.muted)
          Picker("視点", selection: $options.isHost) {
            Text("ホスト").tag(true)
            Text("参加者").tag(false)
          }
          .pickerStyle(.segmented)
        }

        Toggle(isOn: $options.includesOffline) {
          Text("切断中の人を入れる").font(Theme.font(16, .heavy))
        }
        .tint(Theme.accent)

        if let errorMessage {
          Text(errorMessage)
            .font(Theme.font(12, .bold))
            .foregroundStyle(Theme.red)
        }

        Button(isGenerating ? "AI が 3D シーンを生成中..." : "▶ スタート") {
          Task { await handleStart() }
        }
        .buttonStyle(BigButtonStyle(kind: .primary))
        .disabled(isGenerating)
        .padding(.top, 4)
      }
      .padding(24)
      .background(Color(hex: 0xFFF6C2), in: RoundedRectangle(cornerRadius: 6))
      .shadow(color: Theme.ink.opacity(0.15), radius: 10, y: 6)
      .rotationEffect(.degrees(-1.2))
      .padding(.horizontal, 22)
      Spacer()
      Spacer()
    }
  }

  private func handleStart() async {
    errorMessage = nil
    if sceneMode == .preset {
      var opts = options
      opts.sceneURL = nil
      onStart(opts)
      return
    }

    isGenerating = true
    defer { isGenerating = false }

    do {
      let generatedURL = try await generateSceneUSDZ(prompt: promptText, serverBase: generatorServerURL)
      var opts = options
      opts.sceneID = "custom"
      opts.sceneURL = generatedURL
      onStart(opts)
    } catch {
      errorMessage = "生成失敗: \(error.localizedDescription)"
    }
  }

  private struct GenerateResponse: Decodable {
    let sceneId: String
    let usdzUrl: String
  }

  private func generateSceneUSDZ(prompt: String, serverBase: String) async throws -> URL {
    let trimmed = serverBase.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
    guard let endpoint = URL(string: "\(trimmed)/generate-scene") else {
      throw URLError(.badURL)
    }
    var req = URLRequest(url: endpoint)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.timeoutInterval = 120
    req.httpBody = try JSONEncoder().encode(["prompt": prompt])

    let (data, response) = try await URLSession.shared.data(for: req)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw URLError(.badServerResponse)
    }
    let decoded = try JSONDecoder().decode(GenerateResponse.self, from: data)
    guard let url = URL(string: decoded.usdzUrl, relativeTo: endpoint)?.absoluteURL else {
      throw URLError(.badURL)
    }
    return url
  }
}
