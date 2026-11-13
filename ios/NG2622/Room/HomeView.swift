import SwiftUI

/// ホーム。大きなジオラマの下にタイトル、下の方に「あそぶ」と「きろく」を同じ大きさで縦に並べ、右上に設定の歯車を置く。
/// 「あそぶ」を押すと自分の部屋ができて待合に入る（ほかの部屋へは待合の「他のルーム」から移る）。
/// 名前がまだ無い（初めて開いた）ときは、ボタンの代わりに名前を決める欄を出す（最初の画面）。
/// 最初の画面とホームは同じ view で、ジオラマとタイトルの並びはそのまま下だけを替える（3D を作り直さない）
struct HomeView: View {
  let profile: PlayerProfile
  /// 最初の画面で名前を決めた
  var onName: (String) -> Void = { _ in }
  /// 「あそぶ」
  let onPlay: () -> Void
  var onRecords: () -> Void = {}
  var onSettings: () -> Void = {}
  /// 上に別の画面（きろく・設定）が重なっている。重なっている間は、場面の 3D を外す
  var isCovered = false

  /// 歯車の行の高さ（上の余白 8 と丸いボタン 44 と下 8）
  private static let gearRow: CGFloat = 60
  /// ジオラマの枠の高さ（いちばん大きいとき）。キーボードが出たときなどは縮む。
  /// 場面は枠の下寄りに描かれ、回って斜めになると手前の角が下に伸びるので、角が枠の下で切れないだけの余裕を取る
  /// （枠の外は描かれないため）。下の余裕は、そのままタイトルとの間の余白にもなる
  private static let sceneHeight: CGFloat = 340
  /// カメラから場面の中心までの距離。縦の画角が決まっているので、場面の大きさは「枠の高さ / 距離」で決まる。
  /// 枠を高くしたぶん離して、場面を画面の幅の 8 割ほどに保つ（枠が縮むと、場面も同じ比で縮むので切れない）
  private static let sceneDistance: Float = 5.3

  @FocusState private var editing: Bool

  var body: some View {
    VStack(spacing: 0) {
      // 名前を打っている間（キーボードが出ている間）は、歯車の行と下の余白を詰め、ジオラマをさらに縮めて、
      // 小さい画面でも「はじめる」がキーボードに隠れないようにする（最初の画面には歯車を出さない）
      Color.clear.frame(height: editing ? 0 : Self.gearRow)
      // ジオラマとタイトルのまとまりは、歯車の行と下のボタンの間の空きに置き、見た目の重心を少し上にする
      // （見た目の空きが上 2 : 下 3 ほど。docs/design/ui/screens/home.md）。場面はジオラマの枠の下寄りに描かれ、
      // 枠の上に場面の無い所があるので、空き（Spacer）は上 1 : 下 4 で分ける
      Spacer(minLength: 0)
      // 枠の高さとカメラの距離で、ジオラマが画面の幅の 8 割ほどになるようにする（回って斜めになると少し広がる）
      SpinningScene(distance: Self.sceneDistance)
        .unmountedWhileCovered(isCovered)
        .frame(maxWidth: .infinity, minHeight: editing ? 64 : 120, maxHeight: Self.sceneHeight)
        .layoutPriority(1)
        .contentShape(Rectangle())
        .onTapGesture { editing = false }
      Text("ScenEnglish")
        .font(Theme.font(38, .black))
        .foregroundStyle(Theme.accent)
        .padding(.top, 6)
      // タイトルと下のボタンの間は、小さい画面でも詰まりすぎないよう、少しは空ける
      Spacer(minLength: editing ? 8 : 28)
      ForEach(0..<3, id: \.self) { _ in Spacer(minLength: 0) }
      ZStack(alignment: .bottom) {
        if profile.needsName {
          FirstNameForm(editing: $editing, onStart: onName)
            .transition(.opacity)
        } else {
          menu
            .transition(.opacity)
        }
      }
      .frame(width: 346)
      .animation(.easeInOut(duration: 0.3), value: profile.needsName)
      .padding(.bottom, editing ? 8 : 56)
    }
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

  /// 「あそぶ」（塗り）と「きろく」（枠だけ）。同じ大きさ・同じ幅で、文字だけ
  private var menu: some View {
    VStack(spacing: 16) {
      Button("あそぶ", action: onPlay)
        .buttonStyle(BigButtonStyle(kind: .primary))
      Button("きろく", action: onRecords)
        .buttonStyle(BigButtonStyle(kind: .outlined))
    }
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
  /// カメラから場面の中心までの距離。小さいほど大きく映る
  var distance: Float = 7.8
  @State private var start = Date()

  var body: some View {
    TimelineView(.animation) { context in
      let t = context.date.timeIntervalSince(start)
      DioramaView(
        sceneID: Self.sceneID, yaw: (t / Self.period * 360).truncatingRemainder(dividingBy: 360),
        tilt: SceneOrbit.defaultTilt, distance: distance)
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
