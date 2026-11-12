import SwiftUI

/// ホーム。名前と色を決めて、部屋を作るか、部屋に入るかを選ぶ。きろくと設定にも、ここから入る
struct HomeView: View {
  @Binding var profile: PlayerProfile
  /// 端末に残した遊んだ記録の数
  var recordCount = 0
  let onCreate: () -> Void
  let onJoin: () -> Void
  var onRecords: () -> Void = {}
  var onSettings: () -> Void = {}
  /// 上に別の画面（きろく・設定）が重なっている。重なっている間は、場面の 3D を外す
  var isCovered = false

  @FocusState private var editing: Bool

  private var hasName: Bool {
    !profile.name.trimmingCharacters(in: .whitespaces).isEmpty
  }

  var body: some View {
    VStack(spacing: 0) {
      SpinningScene()
        .unmountedWhileCovered(isCovered)
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
      recordsCard
        .padding(.top, 22)
      Spacer(minLength: 12)
    }
    .frame(width: 346)
    .frame(maxWidth: .infinity)
    .overlay(alignment: .topTrailing) {
      CircleIconButton(systemName: "gearshape.fill", label: "設定", action: onSettings)
        .padding(.top, 8)
        .padding(.trailing, 16)
    }
    .onChange(of: profile.name) { _, name in
      if name.count > PlayerProfile.maxNameLength {
        profile.name = String(name.prefix(PlayerProfile.maxNameLength))
      }
    }
  }

  /// きろくへの入口。部屋のボタンより目立たせない（白い板）。名前が無くても開ける
  private var recordsCard: some View {
    Button(action: onRecords) {
      HStack(spacing: 14) {
        Image(systemName: "clock.arrow.circlepath")
          .font(.system(size: 26, weight: .bold))
          .foregroundStyle(Theme.accent)
        VStack(alignment: .leading, spacing: 2) {
          Text("きろく")
            .font(Theme.font(19, .heavy))
          Text(recordCount > 0 ? "これまでの \(recordCount) 回" : "あそぶと、ここにたまります")
            .font(Theme.font(14, .heavy))
            .foregroundStyle(Theme.muted)
            .monospacedDigit()
        }
        Spacer(minLength: 8)
        Image(systemName: "chevron.right")
          .font(.system(size: 15, weight: .bold))
          .foregroundStyle(Theme.gray)
      }
      .padding(.horizontal, 18)
      .frame(height: 64)
      .background(Theme.card, in: RoundedRectangle(cornerRadius: 22))
      .shadow(color: Theme.ink.opacity(0.07), radius: 10, y: 6)
      .contentShape(RoundedRectangle(cornerRadius: 22))
    }
    .buttonStyle(.plain)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isButton)
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

/// ゆっくり回り続ける場面（触れない）。同梱の作り置きの場面のうち、かんたんの例の場面を部品で組んで出す
/// （配置の JSON はアプリに同梱なので、通信せずに Mock でも Live でも出る）
private struct SpinningScene: View {
  /// 1 周の秒数
  private static let period: TimeInterval = 24
  /// 出す場面。かんたんの例が無ければ、どれか 1 つの出題の候補
  static let sceneID = ScenePool.bundled.example(of: .eiken3) ?? ScenePool.bundled.randomCandidate() ?? ""
  @State private var start = Date()

  var body: some View {
    TimelineView(.animation) { context in
      let t = context.date.timeIntervalSince(start)
      DioramaView(
        sceneID: Self.sceneID, yaw: (t / Self.period * 360).truncatingRemainder(dividingBy: 360),
        tilt: SceneOrbit.defaultTilt)
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
