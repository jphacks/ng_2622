import SwiftUI

/// きろく。遊んだ場面（画面の幅いっぱいの 3D と名前）が横に並び（最後に遊んだのが新しい順）、その下に、
/// 選んだ場面を遊んだ回の振り返りが新しい順に縦に続く（1 枚の縦の流れ。押して別の画面に移る所は無い）。
/// 下へスクロールすると、3D は上端に着いた所で止まり、小さくなって、名前と一緒に上に残る。
/// その下では、上がってくる中身が地の色のぼかしに溶けて消える
struct RecordsView: View {
  let library: RecordLibrary
  /// 上に苦手の画面が重なっているか。重なっている間は、場面の 3D を外す（unmountedWhileCovered）
  var isCovered = false
  let onBack: () -> Void
  /// 下のフッター「苦手をぶっとばせ！」から苦手の画面へ
  let onWeakPoints: () -> Void

  /// 横の並びで 3D を出す場面
  enum SceneMode {
    /// 選んでいる場面と、その両隣（同時に 3 つまで）
    case neighbors
    /// 選んでいる場面だけ。両隣は印だけにする
    case selectedOnly
  }

  /// 3D を同時にいくつ出すか。3 つ出して遊ぶ側の 3D に障りが出るときは .selectedOnly にする
  static let sceneMode = SceneMode.neighbors

  /// 選んでいる場面の ID
  @State private var selected: String?
  /// 回ごとの録音を鳴らす口。1 つを共有し、別の回を押したら前のを止める（2 本同時に鳴らさない）
  @State private var player = VoicePlayer()
  /// 3D が上に止まってから縮み切るまでの進み
  @State private var stick = ShelfStick()
  /// 縮み切った所（3D が止まって小さくなり切り、最新の回の頭が名前のすぐ下に来る所）の印
  private static let settledAnchor = "records-settled"

  private var scenes: [RecordScene] { library.scenes }
  private var current: RecordScene? {
    scenes.first { $0.id == selected } ?? scenes.first
  }

  var body: some View {
    Group {
      if let current {
        records(current)
      } else {
        empty
      }
    }
    .environment(\.sharedVoicePlayer, player)
    .onDisappear { player.stop() }
    .task { await library.reload() }
    // きろくを閉じたら、組んで覚えた場面を忘れる（遊ぶたびに増えるので、持ち続けない）
    .onDisappear { SceneLibrary.shared.forgetComposedLayouts() }
  }

  /// 隣の場面を選ぶ（読み上げの操作から）。横の並びは、選んだ場面まで送られる
  private func step(_ offset: Int) {
    guard let index = scenes.firstIndex(where: { $0.id == current?.id }),
      scenes.indices.contains(index + offset)
    else { return }
    selected = scenes[index + offset].id
  }

  private func records(_ current: RecordScene) -> some View {
    // 位置を測る座標（Shelf.space）は、この VStack（安全な領域の中）に付ける。ScrollView は状態バーの下まで広がるため
    VStack(spacing: 0) {
      ScrollViewReader { proxy in
        scroll(current, proxy: proxy)
      }
    }
    // 上に止まった 3D の上（画面の上端まで）を、地の色でふさぐ。流れていく見出しや中身を見せず、
    // 押しても、見えていない中身には届かない（戻るボタンは、この上に重ねる）
    .overlay(alignment: .top) {
      Theme.background
        .frame(height: Shelf.stickTop)
        .background(Theme.background.ignoresSafeArea(edges: .top))
    }
    .overlay(alignment: .top) {
      HStack {
        CircleIconButton(systemName: "chevron.left", label: "戻る", action: onBack)
        Spacer()
      }
      .frame(height: 52)
      .resultColumn()
      .padding(.top, 8)
    }
    // 最下部は、下に行くほど地の色に溶かして、続きがあることを示す
    .overlay(alignment: .bottom) {
      LinearGradient(colors: [Theme.background.opacity(0), Theme.background], startPoint: .top, endPoint: .bottom)
        .frame(height: 72)
        .ignoresSafeArea(edges: .bottom)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
    .overlay(alignment: .bottom) {
      // 苦手の画面に入れるとき（内容の内訳のある記録が 5 件以上）だけ出す。4 件以下は入口ごと出さない
      if library.canOpenWeakPoints {
        WeakPointFooter(stick: stick, action: onWeakPoints)
      }
    }
    .coordinateSpace(.named(Shelf.space))
  }

  /// 縦のスクロール（見出し・場面の横の並び・選んだ場面の回）
  private func scroll(_ current: RecordScene, proxy: ScrollViewProxy) -> some View {
    ScrollView {
      // 横の並びは遅延しない VStack に置く（下にスクロールして戻っても、3D と横の位置がそのまま残る）。
      // 回の振り返りは数が多いことがあるので、その部分だけ遅延にする
      VStack(spacing: 0) {
        // 戻るボタンは上に浮かせて残すので、ここは見出しだけ（スクロールで流れて消える）
        Text("きろく")
          .font(Theme.font(20, .black))
          .frame(height: 52)
          .frame(maxWidth: .infinity)
          .padding(.top, 8)
          .frame(height: Shelf.titleHeight, alignment: .top)
          .accessibilityAddTraits(.isHeader)
          .accessibilityIdentifier("records-title")
        SceneShelf(
          scenes: scenes, selected: $selected, mode: Self.sceneMode, isCovered: isCovered, stick: stick, onStep: step)
          // 上に止まった 3D と名前の下を、振り返りが通る
          .zIndex(1)
        SceneRounds(scene: current, recordings: library.recordings)
          .resultColumn()
          .padding(.top, 10)
          // 入口のフッターがあるときは、その高さだけ下を空ける（一番下まで送ったとき、最後の中身がフッターに隠れない。
          // 振り返りが短くて 3D が止まるまで送れず、フッターが隠れないときも）
          .padding(.bottom, library.canOpenWeakPoints ? WeakPointFooter.height : 56)
          // 場面を替えたら、棒の伸びる動きなどを初めからにする
          .id(current.id)
      }
      // 縮み切った所の印。中身の上端から、縮み切るまでのスクロールの量だけ下に置く
      .background(alignment: .top) {
        Color.clear
          .frame(height: 1)
          .id(Self.settledAnchor)
          .padding(.top, Shelf.settledOffset)
          .accessibilityHidden(true)
      }
    }
    // 上端は地の色でふさぐので、システムのぼかし（状態バーの下）は付けない
    .scrollEdgeEffectHidden(true, for: .top)
    // 縮んだまま場面を替えたら（横に送ったか、読み上げの操作から）、その場面の最新の回から読めるようにする。
    // 印を上（安全な領域の下端）にそろえると、ちょうど縮み切った所に着く
    .onChange(of: current.id) {
      if stick.progress > 0 { proxy.scrollTo(Self.settledAnchor, anchor: .top) }
    }
  }

  private var empty: some View {
    VStack(spacing: 0) {
      ResultSubHeader(title: "きろく", onBack: onBack)
        .resultColumn()
        .padding(.top, 8)
      Spacer()
      VStack(spacing: 10) {
        Image(systemName: "clock.arrow.circlepath")
          .font(.system(size: 40, weight: .bold))
          .foregroundStyle(Theme.gray)
        Text("まだきろくがありません")
          .font(Theme.font(20, .heavy))
        Text("あそぶと、ここに場面と採点がたまります。")
          .font(Theme.font(15, .bold))
          .foregroundStyle(Theme.muted)
          .multilineTextAlignment(.center)
      }
      .resultColumn()
      Spacer()
    }
  }

  /// 遊んだ日と時刻（例: 11/12 14:05）。同じ日に何回か遊んでも見分けられるよう、時刻も出す
  static func dayAndTime(_ date: Date) -> String {
    // 端末の言語の設定によらず、24 時間で出す
    let c = Calendar.current.dateComponents([.month, .day, .hour, .minute], from: date)
    return String(format: "%d/%d %d:%02d", c.month ?? 0, c.day ?? 0, c.hour ?? 0, c.minute ?? 0)
  }
}

// MARK: - 場面の横の並び

/// 場面の並びの寸法と、縦のスクロールで上に止まって縮む動き。
/// 止まってから縮み切るまでのスクロールの量を、3D と名前が縮む量と同じにする。
/// そうすると、下の中身の上端が、縮んでいく名前の下端にちょうど付いてくる（縮む間は中身が名前の下に潜らない）
nonisolated private enum Shelf {
  /// 位置を測る座標（画面の、上の安全な領域の下端が 0）
  static let space = "records"
  /// 見出しの行（上の空き 8・行 52・3D までの空き 4）
  static let titleHeight: CGFloat = 64
  /// 3D の所の高さ（横は画面いっぱい）
  static let sceneHeight: CGFloat = 250
  /// 名前の行の高さ
  static let nameHeight: CGFloat = 30
  /// 名前の下の空き（止まる前だけ）
  static let bottomPadding: CGFloat = 8
  static let height = sceneHeight + nameHeight + bottomPadding
  /// 3D を見る距離（m）
  static let distance: Float = 4.6
  /// 止まった後の 3D の大きさ（止まる前に対する割合）
  static let stuckScale: CGFloat = 0.54
  /// 3D が止まる位置（上の安全な領域の下端から。戻るボタンの上端にそろえる）
  static let stickTop: CGFloat = 8
  /// 止まった後に、名前の下に重ねるぼかしの高さ
  static let wallHeight: CGFloat = 20
  /// ぼかしを、名前の行の下端より上（文字のすぐ下）から始める量
  static let wallOverlap: CGFloat = 4
  /// 3D が縮む量
  static let sceneShrink = sceneHeight * (1 - stuckScale)
  /// 止まってから縮み切るまでのスクロールの量
  static let shrinkDistance = sceneShrink + bottomPadding
  /// 3D が止まり始めるスクロールの量
  static let stickStart = titleHeight - stickTop
  /// 縮み切るスクロールの量
  static let settledOffset = stickStart + shrinkDistance

  /// 並びの上端（minY）が止まる位置より上に来た分。その分だけ下に戻して、止まって見せる
  static func push(_ minY: CGFloat) -> CGFloat { max(0, stickTop - minY) }
  /// 止まってから縮み切るまでの進み（0〜1）
  static func progress(_ minY: CGFloat) -> CGFloat { min(1, push(minY) / shrinkDistance) }
  /// 見えている並びの高さ（止まった後は、小さくした 3D と名前の高さ）
  static func visibleHeight(_ progress: CGFloat) -> CGFloat { height - shrinkDistance * progress }
  static func sceneScale(_ progress: CGFloat) -> CGFloat { 1 - (1 - stuckScale) * progress }
}

/// 3D が上に止まってから縮み切るまでの進み（0 は止まる前、1 は縮み切った後）。
/// 縮む間だけ変わる。読むのは、進みで見た目を変える小さな部分だけにする（3D の入った場面は作り直さない）
@Observable private final class ShelfStick {
  var progress: CGFloat = 0
}

/// 進みに合わせて、大きさ・位置・濃さを変える。進みが変わって作り直すのはこの部分だけで、中身（3D など）は作り直さない
private struct ShelfMotion: ViewModifier {
  let stick: ShelfStick
  let scale: (CGFloat) -> CGSize
  let lift: (CGFloat) -> CGFloat
  let opacity: (CGFloat) -> Double

  func body(content: Content) -> some View {
    let p = stick.progress
    content
      .scaleEffect(scale(p), anchor: .top)
      .offset(y: lift(p))
      .opacity(opacity(p))
  }
}

extension View {
  fileprivate func shelfMotion(
    _ stick: ShelfStick,
    scale: @escaping (CGFloat) -> CGSize = { _ in CGSize(width: 1, height: 1) },
    lift: @escaping (CGFloat) -> CGFloat = { _ in 0 },
    opacity: @escaping (CGFloat) -> Double = { _ in 1 }
  ) -> some View {
    modifier(ShelfMotion(stick: stick, scale: scale, lift: lift, opacity: opacity))
  }
}

/// 縮み切って上に残っている間は、横に送らない。押したところは、後ろの地の色が受け止め、下に隠れた中身には渡さない
private struct ShelfHitTesting: ViewModifier {
  let stick: ShelfStick

  func body(content: Content) -> some View {
    content.allowsHitTesting(stick.progress < 1)
  }
}

/// 場面の横の並び。1 つの場面（3D と名前）を画面の幅いっぱいに出し、横に 1 つずつ送る。隣の場面はのぞかせない。
/// 縦のスクロールでは、上端に着いた所で止まり、縮む
private struct SceneShelf: View {
  let scenes: [RecordScene]
  @Binding var selected: String?
  let mode: RecordsView.SceneMode
  /// 上に別の画面が重なっているか
  let isCovered: Bool
  let stick: ShelfStick
  /// 隣の場面を選ぶ（-1 で前、+1 で次）。読み上げでは横に送れないので、場面の操作で替える
  let onStep: (Int) -> Void

  /// いま画面にある場面が何番目か（送っている途中も変わる）
  @State private var middle = 0

  var body: some View {
    GeometryReader { geo in
      let width = geo.size.width
      ScrollViewReader { proxy in
        ScrollView(.horizontal) {
          HStack(spacing: 0) {
            ForEach(Array(scenes.enumerated()), id: \.element.id) { index, scene in
              ScenePage(
                scene: scene, shows3D: shows3D(at: index), isMiddle: index == middle, isCovered: isCovered, stick: stick,
                onStep: onStep)
                .frame(width: width, height: Shelf.height)
            }
          }
          .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.paging)
        // 画面にある場面を、スクロールの位置から数える
        .onScrollGeometryChange(for: Int.self) { geometry in
          Int((geometry.contentOffset.x / max(1, width)).rounded())
        } action: { _, index in
          if scenes.indices.contains(index) { middle = index }
        }
        // 選ぶのは、スクロールが止まってから（速く送ったときに、通り過ぎる場面の 3D を作って捨てない）
        .onScrollPhaseChange { _, phase in
          if phase == .idle, scenes.indices.contains(middle) { selected = scenes[middle].id }
        }
        // 外から選ばれたら（読み上げの「次の場面」など）、その場面まで送る
        .onChange(of: selected) { _, id in
          guard let id, scenes.indices.contains(middle), scenes[middle].id != id else { return }
          withAnimation(.easeInOut(duration: 0.25)) { proxy.scrollTo(id, anchor: .center) }
        }
        .modifier(ShelfHitTesting(stick: stick))
      }
    }
    .frame(height: Shelf.height)
    .background(alignment: .top) {
      ZStack(alignment: .top) {
        // 止まった後に、下を通る中身を隠す地の色（名前の文字の下端まで）
        Theme.background
          .frame(height: Shelf.height)
          .shelfMotion(
            stick, scale: { CGSize(width: 1, height: (Shelf.visibleHeight($0) - Shelf.wallOverlap) / Shelf.height) })
        // 名前のすぐ下で、上がってくる中身を地の色のぼかしに溶かす（疑似的な壁）。名前の文字より後ろに置く
        ShelfWall()
          .frame(height: Shelf.wallHeight)
          .shelfMotion(stick, lift: { Shelf.visibleHeight($0) - Shelf.wallOverlap }, opacity: { Double($0) })
          .allowsHitTesting(false)
      }
      .accessibilityHidden(true)
    }
    // 上端に着いたら、そこで止める（スクロールした分だけ下に戻す）
    .visualEffect { content, proxy in
      content.offset(y: Shelf.push(proxy.frame(in: .named(Shelf.space)).minY))
    }
    .onGeometryChange(for: CGFloat.self) { proxy in
      Shelf.progress(proxy.frame(in: .named(Shelf.space)).minY)
    } action: { progress in
      stick.progress = progress
    }
    .onAppear { if selected == nil { selected = scenes.first?.id } }
    .onChange(of: scenes.map(\.id)) { _, ids in
      if let selected, !ids.contains(selected) { self.selected = ids.first }
    }
  }

  /// 選んでいる場面が何番目か
  private var center: Int {
    scenes.firstIndex { $0.id == selected } ?? 0
  }

  private func shows3D(at index: Int) -> Bool {
    switch mode {
    case .neighbors: return abs(index - center) <= 1
    case .selectedOnly: return index == center
    }
  }
}

/// 1 つの場面。3D（ゆっくり回り続け、触れない）か印と、その下に場面の名前。枠は付けない。
/// 上に止まって縮むと、同じ 3D を小さくして、名前をその下に寄せる
private struct ScenePage: View {
  let scene: RecordScene
  let shows3D: Bool
  /// 画面にある場面か。それ以外は読み上げに出さない
  let isMiddle: Bool
  /// 上に別の画面が重なっているか
  let isCovered: Bool
  let stick: ShelfStick
  let onStep: (Int) -> Void

  var body: some View {
    VStack(spacing: 0) {
      Group {
        if shows3D, let layout = scene.layout {
          RecordSceneView(layout: layout, key: scene.sceneKey, name: scene.name, distance: Shelf.distance)
            // 苦手の画面が重なっている間は外す（覆われた 3D を残すと、ほかの 3D が描き直されなくなる）
            .unmountedWhileCovered(isCovered)
        } else {
          ScenePlaceholder()
        }
      }
      .frame(height: Shelf.sceneHeight)
      // 止まった後は、同じ 3D を小さくする（作り直さない）
      .shelfMotion(
        stick,
        scale: {
          let s = Shelf.sceneScale($0)
          return CGSize(width: s, height: s)
        })
      Text(scene.name)
        .font(Theme.font(22, .black))
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .frame(height: Shelf.nameHeight)
        .resultColumn()
        .shelfMotion(stick, lift: { -Shelf.sceneShrink * $0 })
      Spacer(minLength: 0)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(scene.name)の場面")
    .accessibilityValue("\(scene.entries.count) 回あそんだ")
    .accessibilityAction(named: "次の場面") { onStep(1) }
    .accessibilityAction(named: "前の場面") { onStep(-1) }
    .accessibilityHidden(!isMiddle)
    // UI テストが、場面の所を撮って 3D が描かれたかを見るための名前
    .accessibilityIdentifier("record-scene")
  }
}

/// 疑似的な壁。上ほど地の色で濃くぼかし、下で消える
private struct ShelfWall: View {
  private static let fade = LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)

  var body: some View {
    ZStack {
      Rectangle()
        .fill(.ultraThinMaterial)
        .mask(Self.fade)
      LinearGradient(colors: [Theme.background, Theme.background.opacity(0)], startPoint: .top, endPoint: .bottom)
    }
  }
}

/// 下に固定する「苦手」への入口。下へスクロールして振り返りを読み始めたら（3D が止まったら）下に隠れ、上に戻ると出る
/// ボタンの後ろは、上ほど地の色に溶かした帯にし、下を流れる中身の文字がボタンのすぐ上で消えるようにする
private struct WeakPointFooter: View {
  let stick: ShelfStick
  let action: () -> Void

  /// ボタンの上の、地の色に溶かす帯
  private static let fade: CGFloat = 28
  /// ボタンの下の空き（安全な領域の上）
  private static let bottom: CGFloat = 8
  /// フッターが占める高さ（上の帯・ボタン 64・押せる影 6・下の空き。安全な領域は含まない）。中身の下の空きに使う
  static let height: CGFloat = fade + 64 + 6 + bottom

  var body: some View {
    let hidden = stick.progress > 0
    // 空きと帯は、ボタンの外側に付ける（押せる所と読み上げの枠を、ボタンの形だけにする）
    VStack(spacing: 0) {
      Button(action: action) {
        Text("苦手をぶっとばせ！")
      }
      .buttonStyle(BigButtonStyle(kind: .primary))
    }
    .accessibilityElement(children: .contain)
    .resultColumn()
    .padding(.top, Self.fade)
    .padding(.bottom, Self.bottom + 6)
    .background {
      LinearGradient(
        stops: [.init(color: Theme.background.opacity(0), location: 0), .init(color: Theme.background, location: 0.45)],
        startPoint: .top, endPoint: .bottom
      )
      .ignoresSafeArea(edges: .bottom)
      .allowsHitTesting(false)
    }
    .offset(y: hidden ? 200 : 0)
    .animation(.easeInOut(duration: 0.25), value: hidden)
    .allowsHitTesting(!hidden)
    .accessibilityHidden(hidden)
  }
}

// MARK: - 選んでいる場面の回

/// 選んでいる場面を遊んだ回の振り返り。新しい順に、日付の見出しで区切って縦に並べる。
/// 中身は遊んだ直後の振り返りと同じ（ReviewBody。順位は出さない）
private struct SceneRounds: View {
  let scene: RecordScene
  /// 記録の ID ごとの自分の録音（読み直すときに 1 度だけ読んだもの）
  let recordings: [String: RecordedAudio]

  var body: some View {
    LazyVStack(spacing: 20) {
      ForEach(scene.entries) { entry in
        VStack(spacing: 14) {
          RoundDivider(text: RecordsView.dayAndTime(entry.playedAt))
          if let me = entry.results.me, let score = me.score {
            ReviewBody(
              me: me, score: score, review: entry.results.myReview, layout: entry.layout,
              recording: recordings[entry.id])
          }
        }
      }
    }
  }
}

/// 回の区切り（─── 11/13 3:02 ───）
private struct RoundDivider: View {
  let text: String

  var body: some View {
    HStack(spacing: 12) {
      Rectangle().fill(Theme.disabledBorder).frame(height: 1.5)
      Text(text)
        .font(Theme.font(15, .heavy))
        .foregroundStyle(Theme.muted)
        .monospacedDigit()
        .fixedSize()
      Rectangle().fill(Theme.disabledBorder).frame(height: 1.5)
    }
    .padding(.top, 8)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(text)
    .accessibilityAddTraits(.isHeader)
    .accessibilityIdentifier("round-divider")
  }
}
