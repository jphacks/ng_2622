import SwiftUI

/// ホーム。主ボタンは「あそぶ」の 1 つで、押すと自分の部屋ができて待合に入る（ほかの部屋へは待合の「他のルーム」から移る）。
/// きろくと設定にも、ここから入る。名前がまだ無い（初めて開いた）ときは、ボタンの代わりに名前を決める欄を出す（最初の画面）。
/// 最初の画面とホームは同じ view で、ジオラマとタイトルはそのまま下だけを替える（3D を作り直さない）
struct HomeView: View {
  let profile: PlayerProfile
  /// 端末に残した遊んだ記録の数
  var recordCount = 0
  /// 「あそぶ」の上に出す短い知らせ（別の部屋に入れなかったとき）
  var notice: String?
  /// 最初の画面で名前を決めた
  var onName: (String) -> Void = { _ in }
  /// 「あそぶ」
  let onPlay: () -> Void
  var onRecords: () -> Void = {}
  var onSettings: () -> Void = {}
  /// 上に別の画面（きろく・設定）が重なっている。重なっている間は、場面の 3D を外す
  var isCovered = false

  @FocusState private var editing: Bool

  var body: some View {
    VStack(spacing: 0) {
      SpinningScene()
        .unmountedWhileCovered(isCovered)
        .frame(maxWidth: .infinity, minHeight: 120, maxHeight: 340)
        .contentShape(Rectangle())
        .onTapGesture { editing = false }
      Text("ScenEnglish")
        .font(Theme.font(38, .black))
        .foregroundStyle(Theme.accent)
        .padding(.bottom, 22)
      ZStack(alignment: .top) {
        if profile.needsName {
          FirstNameForm(editing: $editing, onStart: onName)
            .transition(.opacity)
        } else {
          menu
            .transition(.opacity)
        }
      }
      .animation(.easeInOut(duration: 0.3), value: profile.needsName)
      Spacer(minLength: 12)
    }
    .frame(width: 346)
    .frame(maxWidth: .infinity)
    .overlay(alignment: .topTrailing) {
      if !profile.needsName {
        CircleIconButton(systemName: "gearshape.fill", label: "設定", action: onSettings)
          .padding(.top, 8)
          .padding(.trailing, 16)
          .transition(.opacity)
      }
    }
  }

  private var menu: some View {
    VStack(spacing: 22) {
      Button("あそぶ", action: onPlay)
        .buttonStyle(BigButtonStyle(kind: .primary))
        .padding(.top, 8)
      recordsCard
      // きろくの板の下に出す（下は空いているので、ボタンの位置は動かない）
      if let notice {
        Label(notice, systemImage: "exclamationmark.circle.fill")
          .font(Theme.font(15, .heavy))
          .foregroundStyle(Theme.ink)
          .padding(.horizontal, 14)
          .frame(height: 34)
          .background(Theme.card, in: Capsule())
          .shadow(color: Theme.ink.opacity(0.08), radius: 6, y: 3)
          .transition(.opacity)
      }
    }
    .animation(.easeOut(duration: 0.2), value: notice)
    // 知らせが出たら VoiceOver で読み上げる（ホームに切り替わる動きが落ち着いてから）
    .task(id: notice) {
      guard let notice else { return }
      try? await Task.sleep(for: .milliseconds(600))
      if !Task.isCancelled { AccessibilityNotification.Announcement(notice).post() }
    }
  }

  /// きろくへの入口。「あそぶ」より目立たせない（白い板）
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
}

/// 最初の画面の、名前を決める欄。色は決めてもらわない（自動。設定で変えられる）
private struct FirstNameForm: View {
  var editing: FocusState<Bool>.Binding
  let onStart: (String) -> Void

  @State private var name = ""

  private var canStart: Bool {
    !PlayerProfile.trimmed(name).isEmpty
  }

  var body: some View {
    VStack(spacing: 0) {
      Text("あなたの名前を決めよう")
        .font(Theme.font(24, .black))
        .padding(.bottom, 18)
      NameField(name: $name, editing: editing)
        .onSubmit(start)
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 22))
        .shadow(color: Theme.ink.opacity(0.07), radius: 10, y: 6)
      Text("あとで設定から変えられます")
        .font(Theme.font(14, .heavy))
        .foregroundStyle(Theme.muted)
        .padding(.top, 14)
      Button("はじめる", action: start)
        .buttonStyle(BigButtonStyle(kind: .primary))
        .disabled(!canStart)
        .padding(.top, 18)
    }
  }

  private func start() {
    guard canStart else { return }
    editing.wrappedValue = false
    onStart(name)
  }
}

/// 名前の入力欄（最初の画面と設定で使う）。上限の長さを超えた分は切る
struct NameField: View {
  @Binding var name: String
  var editing: FocusState<Bool>.Binding

  var body: some View {
    // 空のときの「名前」は、既定の色だと薄すぎるので、読める灰色にする
    TextField("名前", text: $name, prompt: Text("名前").foregroundStyle(Theme.gray))
      .font(Theme.font(22, .heavy))
      .focused(editing)
      .submitLabel(.done)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .padding(.horizontal, 16)
      .frame(height: 52)
      .background(Theme.background, in: RoundedRectangle(cornerRadius: 16))
      .overlay {
        RoundedRectangle(cornerRadius: 16)
          .strokeBorder(editing.wrappedValue ? Theme.accent : Theme.line, lineWidth: 2)
      }
      .onChange(of: name) { _, value in
        let limited = PlayerProfile.limited(value)
        if limited != value { name = limited }
      }
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
