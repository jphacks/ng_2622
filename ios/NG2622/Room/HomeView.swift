import SwiftUI

/// ホーム。大きなジオラマの下にタイトル、下の方に「あそぶ」と「きろく」を同じ大きさで縦に並べ、右上に設定の歯車を置く。
/// 「あそぶ」を押すと自分の部屋ができて待合に入る（ほかの部屋へは待合の「他のルーム」から移る）。
/// 名前がまだ無い（初めて開いた）ときは、ボタンの代わりに名前を決める欄を出す（最初の画面）。
/// 最初の画面とホームは同じ view で、ジオラマとタイトルの並びはそのまま下だけを替える（3D を作り直さない）。
/// ジオラマは、ふだんは作り置きの場面（公園）。広告の 3D があればそれを出し、3D の下に「PR」の札と広告主の名前を出す（HomeTitle）
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
  /// （枠の外は描かれないため）。下の余裕は、そのままタイトルとの間の余白にもなる。
  /// 余裕は、ホームに出す場面（かんたんの例、今は gen-v2-eiken3-park-01）で測ったもの。斜めのときの角から枠の下まで
  /// 27pt ほど（iPhone 17）。例の場面を、もっと広い・背の高い場面に替えたら、回して切れないかを確かめ直す
  private static let sceneHeight: CGFloat = 340
  /// カメラから場面の中心までの距離。縦の画角が決まっているので、場面の大きさは「枠の高さ / 距離」で決まる。
  /// 枠を高くしたぶん離して、場面を画面の幅の 8 割ほどに保つ（枠が縮むと、場面も同じ比で縮むので切れない）
  private static let sceneDistance: Float = 5.3
  /// 広告の 3D のときの距離。場面と同じく横幅 2.3 m にそろえるが、壁（会場は 3 m）があって背が高いので、
  /// 公園より少し離す。左右に振る両端と中央で、角と壁の上が枠に収まるのを確かめた（iPhone 17）
  private static let advertDistance: Float = 5.5

  /// 出す 3D。端末に取っておいた 3D が替わったら（TitleStore の revision）、見ている途中でも入れ替える
  @State private var title = HomeTitle.current()
  /// 今見えている 3D（札はこれに合わせる）。新しい 3D が描かれて、前の 3D を消し始めたときに title に追いつく
  @State private var shown = HomeTitle.current()
  /// 入れ替えのクロスフェードの長さ
  private static let swapDuration = 0.4

  /// 打つための文字の欄
  @FocusState private var editing: Bool

  /// 下の安全域がこれより大きければ、キーボードが出ているとみなす（ホームバーの所は 34pt ほど）
  private static let keyboardInset: CGFloat = 100

  var body: some View {
    // 最初の画面で名前を打っている（キーボードが出ている）間は、並びを詰める。キーボードが出ているかは、フォーカスでも
    // キーボードの知らせでもなく、並べる所の下の安全域で決める。キーボードを避けて並べ直すのと同じ計算の中で決まるので、
    // 並びはキーボードと一緒に動き、欄を押した瞬間に跳ばない（閉じるときも同じ）
    GeometryReader { geometry in
      layout(compact: profile.needsName && geometry.safeAreaInsets.bottom > Self.keyboardInset)
    }
    .overlay(alignment: .topTrailing) {
      if !profile.needsName {
        CircleIconButton(systemName: "gearshape.fill", label: "設定", action: onSettings)
          .padding(.top, 8)
          .padding(.trailing, 16)
          .transition(.opacity)
      }
    }
  }

  /// 並び。compact なら、歯車の行と下の余白を詰め、ジオラマをさらに縮めて、小さい画面でも「はじめる」が
  /// キーボードに隠れないようにする（最初の画面には歯車を出さない）
  private func layout(compact: Bool) -> some View {
    VStack(spacing: 0) {
      Color.clear.frame(height: compact ? 0 : Self.gearRow)
      // ジオラマとタイトルのまとまりは、歯車の行と下のボタンの間の空きに置き、見た目の重心を少し上にする
      // （見た目の空きが上 2 : 下 3 ほど。docs/design/ui/screens/home.md）。場面はジオラマの枠の下寄りに描かれ、
      // 枠の上に場面の無い所があるので、空き（Spacer）は上 1 : 下 4 で分ける
      Spacer(minLength: 0)
      // 枠の高さとカメラの距離で、ジオラマが画面の幅の 8 割ほどになるようにする（回って斜めになると少し広がる）。
      // 広告の 3D のときは、枠の下の所に「PR」の札を置く。札の分だけ 3D の描く所が縮むので、3D と札は重ならず、
      // タイトルとボタンの位置は公園と広告で変わらない。札は 3D と一緒にクロスフェードで出たり消えたりする
      VStack(spacing: 0) {
        SpinningScene(
          title: title, parkDistance: Self.sceneDistance, advertDistance: Self.advertDistance,
          onFallback: fallBackToPark,
          onSettled: { settled in withAnimation(.easeInOut(duration: Self.swapDuration)) { shown = settled } }
        )
        .unmountedWhileCovered(isCovered)
        if let advertiser = shown.caption {
          AdvertLabel(advertiser: advertiser)
            .padding(.top, 4)
            .transition(.opacity)
        }
      }
      .frame(maxWidth: .infinity, minHeight: compact ? 28 : 120, maxHeight: Self.sceneHeight)
      .layoutPriority(1)
      .contentShape(Rectangle())
      .onTapGesture { editing = false }
      Text("ScenEnglish")
        .font(Theme.font(38, .black))
        .foregroundStyle(Theme.accent)
        .padding(.top, 6)
      // タイトルと下のボタンの間は、小さい画面でも詰まりすぎないよう、少しは空ける
      Spacer(minLength: compact ? 8 : 28)
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
      // 名前を打っている間は 16。「はじめる」の影の下とキーボードの間に 10pt ほど空く
      .padding(.bottom, compact ? 16 : 56)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    // 端末に取っておいた 3D が替わったら（取り終えた・消した）、見ている途中でも入れ替える（Live だけ。Mock は替わらない）
    .task(id: TitleStore.shared.revision) { await follow() }
  }

  /// 今出すべき 3D に入れ替える。新しい 3D は先に読み込み、読み終えてから入れ替えを始める。新しい 3D が描かれたら、
  /// 前の 3D と札を短いクロスフェードで替える（SpinningScene）。待ちは入れない（初めての端末では、公園が出てから替わる）
  private func follow() async {
    let next = HomeTitle.current()
    guard next != title else { return }
    if case .advert(let url, _) = next {
      // 読めなくても替える（DioramaView が公園に戻し、onFallback で消す）
      await SceneLibrary.shared.preload(usdzAt: url)
    }
    // 読み込みの間に、もっと新しいものに替わっていたら、そちらの入れ替えに任せる
    guard !Task.isCancelled, next == HomeTitle.current() else { return }
    title = next
  }

  /// 広告の 3D（url）を読めなかった。今出している 3D のときだけ、公園に戻して字も消し、端末に取っておいたものなら消して
  /// 次に取り直す（前に出していた 3D の読み込みが後から失敗しても、新しい 3D を消さない）
  private func fallBackToPark(_ url: URL) {
    guard title.isShowing(url) else { return }
    TitleStore.shared.discard(url)
    title = .park
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

/// ゆっくり動き続ける場面（触れない）。ふだんは、同梱の作り置きの場面のうち、かんたんの例の場面を部品で組んで 1 周させる
/// （配置の JSON はアプリに同梱なので、通信せずに Mock でも Live でも出る）。広告の 3D は左右に振り、読めなければ公園に戻す。
/// 出すもの（title）が替わったら、新しい 3D を前の 3D の上に重ねて置き、新しい 3D が描かれたら前の 3D を薄くして消す
/// （新しい 3D が描かれるまで前の 3D を残すので、入れ替えの途中で何も無い時が無い）
private struct SpinningScene: View {
  /// 公園に出す場面。かんたんの例が無ければ、どれか 1 つの出題の候補
  static let sceneID = ScenePool.bundled.example(of: .eiken3) ?? ScenePool.bundled.randomCandidate() ?? ""
  /// 前の 3D を薄くする長さ
  static let fadeDuration = 0.4
  /// 新しい 3D を置き終えてから、前の 3D を消し始めるまでの余裕（新しい 3D が最初に描かれるのを待つ）
  static let settleDelay: Duration = .milliseconds(600)

  let title: HomeTitle
  /// カメラから場面の中心までの距離。小さいほど大きく映る
  var parkDistance: Float
  var advertDistance: Float
  /// 広告の 3D を読めず、公園を出した
  var onFallback: (URL) -> Void = { _ in }
  /// 新しい 3D が描かれ、前の 3D を消し始めた（札をこれに合わせて替える）
  var onSettled: (HomeTitle) -> Void = { _ in }

  /// 重ねて出している 3D（後ろほど新しい）。start はそれぞれの動きの 0 秒
  struct Layer: Identifiable {
    let title: HomeTitle
    let start: Date
    var id: HomeTitle { title }
  }
  @State private var layers: [Layer]

  init(
    title: HomeTitle, parkDistance: Float, advertDistance: Float, onFallback: @escaping (URL) -> Void = { _ in },
    onSettled: @escaping (HomeTitle) -> Void = { _ in }
  ) {
    self.title = title
    self.parkDistance = parkDistance
    self.advertDistance = advertDistance
    self.onFallback = onFallback
    self.onSettled = onSettled
    _layers = State(initialValue: [Layer(title: title, start: Date())])
  }

  var body: some View {
    TimelineView(.animation) { context in
      ZStack {
        ForEach(layers) { layer in
          diorama(layer.title, yaw: layer.title.spin.yaw(at: context.date.timeIntervalSince(layer.start)))
            .transition(.opacity)
        }
      }
    }
    // 新しいものは、振りの中心から始め、いちばん上に重ねる（前のものは、新しいものが描かれるまで残す）
    .onChange(of: title) { _, next in
      layers.removeAll { $0.title == next }
      layers.append(Layer(title: next, start: Date()))
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  @ViewBuilder
  private func diorama(_ title: HomeTitle, yaw: Double) -> some View {
    switch title {
    case .park:
      DioramaView(sceneID: Self.sceneID, yaw: yaw, tilt: SceneOrbit.defaultTilt, distance: parkDistance)
        .onShown { shown(title) }
    case .advert(let url, _):
      DioramaView(
        usdzAt: url, fallbackSceneID: Self.sceneID, yaw: yaw, tilt: SceneOrbit.defaultTilt, distance: advertDistance,
        onFallback: onFallback
      )
      .onShown { shown(title) }
    }
  }

  /// title の 3D を世界に置き終えた。いちばん新しいものなら、前の 3D を薄くして消し、札を合わせる。
  /// 置き終えてから最初に描かれるまで、大きい 3D（会場）では少しかかる（シミュレータで 0.5 秒ほど何も無いコマがあった）
  /// ので、前の 3D を消し始めるのを settleDelay だけ待つ。その間は前の 3D と重なって見える
  private func shown(_ title: HomeTitle) {
    guard layers.last?.title == title else { return }
    guard layers.count > 1 else {
      onSettled(title)
      return
    }
    Task {
      try? await Task.sleep(for: Self.settleDelay)
      guard layers.last?.title == title else { return }
      withAnimation(.easeInOut(duration: Self.fadeDuration)) { layers.removeAll { $0.title != title } }
      onSettled(title)
    }
  }
}

/// 広告の 3D を出しているときに、3D の下に出す札。枠線の「PR」の札と、広告主の名前（サーバーの caption）を横に並べる。
/// 「PR」の札はアプリに固定し、サーバーからは変えられない（ステマ規制。広告と分かる表示を消せないようにする。
/// docs/adr/20261113-swap-title-diorama-in-place-and-label-as-pr.md）。見落とされないよう、札は 12pt 以上の太字、
/// 名前は 13pt 以上で、どちらも背景との明るさの比が 4.5:1 以上の色にする（accent 4.8:1、muted 4.6:1）
struct AdvertLabel: View {
  let advertiser: String

  var body: some View {
    HStack(spacing: 8) {
      Text("PR")
        .font(Theme.font(12, .heavy))
        .foregroundStyle(Theme.accent)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .overlay {
          RoundedRectangle(cornerRadius: 5)
            .strokeBorder(Theme.accent, lineWidth: 1.5)
        }
      Text(advertiser)
        .font(Theme.font(13, .bold))
        .foregroundStyle(Theme.muted)
        .lineLimit(1)
    }
    // VoiceOver では「PR、JPHACKS」と 1 つにまとめて読む
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Self.spoken(advertiser))
  }

  /// VoiceOver で読む文
  static func spoken(_ advertiser: String) -> String {
    "PR、\(advertiser)"
  }
}
