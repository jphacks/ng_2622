import SwiftUI

/// 音量メーター（仮の動き）。話している・黙っている時間を乱数で切り替える。マイクは使わない
struct VolumeMeter: View {
  private static let barCount = 19
  @State private var levels = Array(repeating: 0.05, count: VolumeMeter.barCount)
  @State private var talking = true
  @State private var talkUntil = Date()

  var body: some View {
    HStack(spacing: 5) {
      ForEach(levels.indices, id: \.self) { i in
        Capsule()
          .fill(Theme.accent)
          .frame(width: 6, height: 6 + levels[i] * 32)
      }
    }
    .frame(width: 230, height: 54)
    .background(.white.opacity(0.88), in: Capsule())
    .shadow(color: Theme.ink.opacity(0.1), radius: 7, y: 4)
    .animation(.linear(duration: 0.07), value: levels)
    .task {
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(70))
        push()
      }
    }
    .accessibilityLabel("音量メーター")
  }

  private func push() {
    let now = Date()
    if now > talkUntil {
      talking.toggle()
      talkUntil = now + (talking ? .random(in: 0.9...2.6) : .random(in: 0.25...0.9))
    }
    let target = talking ? Double.random(in: 0.3...1) : .random(in: 0.03...0.1)
    let prev = levels.last ?? 0
    levels.append(prev + (target - prev) * 0.6)
    levels.removeFirst()
  }
}
