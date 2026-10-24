import SwiftUI

/// ホーム。名前と色を決めて、部屋を作るか、部屋に入るかを選ぶ
struct HomeView: View {
  @Binding var profile: PlayerProfile
  let onCreate: () -> Void
  let onJoin: () -> Void

  @FocusState private var editing: Bool

  private var hasName: Bool {
    !profile.name.trimmingCharacters(in: .whitespaces).isEmpty
  }

  var body: some View {
    VStack(spacing: 0) {
      SpinningPark()
        .frame(maxWidth: .infinity, minHeight: 160, maxHeight: 340)
        .contentShape(Rectangle())
        .onTapGesture { editing = false }
      Text("ScenEnglish")
        .font(Theme.font(38, .black))
        .foregroundStyle(Theme.accent)
        .padding(.bottom, 22)
      playerCard
      VStack(spacing: 18) {
        Button("部屋を作る", action: onCreate)
          .buttonStyle(BigButtonStyle(kind: .primary))
        Button("部屋に入る", action: onJoin)
          .buttonStyle(BigButtonStyle(kind: .outlined))
      }
      .disabled(!hasName)
      .padding(.top, 26)
      Spacer(minLength: 12)
    }
    .frame(width: 346)
    .frame(maxWidth: .infinity)
    .onChange(of: profile.name) { _, name in
      if name.count > PlayerProfile.maxNameLength {
        profile.name = String(name.prefix(PlayerProfile.maxNameLength))
      }
    }
  }

  private var playerCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 12) {
        Avatar(name: profile.name, color: profile.color, size: 52)
          .animation(.easeOut(duration: 0.2), value: profile.color)
        TextField("名前", text: $profile.name)
          .font(Theme.font(22, .heavy))
          .focused($editing)
          .submitLabel(.done)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .padding(.horizontal, 16)
          .frame(height: 52)
          .background(Theme.background, in: RoundedRectangle(cornerRadius: 16))
          .overlay {
            RoundedRectangle(cornerRadius: 16)
              .strokeBorder(editing ? Theme.accent : Theme.line, lineWidth: 2)
          }
      }
      HStack(spacing: 0) {
        ForEach(PlayerProfile.colors, id: \.self) { c in
          Button {
            profile.color = c
          } label: {
            Circle()
              .fill(Color(hex: c))
              .frame(width: 30, height: 30)
              .padding(4)
              .overlay {
                Circle().strokeBorder(profile.color == c ? Theme.ink : .clear, lineWidth: 2.5)
              }
          }
          .accessibilityLabel("色 \(PlayerProfile.colors.firstIndex(of: c).map { $0 + 1 } ?? 0)")
          .accessibilityAddTraits(profile.color == c ? .isSelected : [])
          if c != PlayerProfile.colors.last { Spacer(minLength: 0) }
        }
      }
      .padding(.horizontal, 2)
    }
    .padding(16)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 22))
    .shadow(color: Theme.ink.opacity(0.07), radius: 10, y: 6)
  }
}

/// ゆっくり回り続ける公園（触れない）
private struct SpinningPark: View {
  /// 1 周の秒数
  private static let period: TimeInterval = 24
  @State private var start = Date()

  var body: some View {
    TimelineView(.animation) { context in
      let t = context.date.timeIntervalSince(start)
      DioramaView(
        sceneID: "park", yaw: (t / Self.period * 360).truncatingRemainder(dividingBy: 360), tilt: SceneOrbit.defaultTilt)
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
