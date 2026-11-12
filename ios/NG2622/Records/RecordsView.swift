import SwiftUI

/// きろく。遊んだ場面が横に並び（最後に遊んだのが新しい順）、その下に、選んだ場面を遊んだ回の振り返りが
/// 新しい順に縦に続く（1 枚の縦の流れ。押して別の画面に移る所は無い）
struct RecordsView: View {
  let library: RecordLibrary
  let onBack: () -> Void

  /// 横の並びで 3D を出す場面
  enum SceneMode {
    /// 選んでいる場面と、その両隣（同時に 3 つまで）
    case neighbors
    /// 選んでいる場面だけ。両隣は名前だけの板にする
    case selectedOnly
  }

  /// 3D を同時にいくつ出すか。3 つ出して遊ぶ側の 3D に障りが出るときは .selectedOnly にする
  static let sceneMode = SceneMode.neighbors
  /// 「苦手」への入口を出すか。押した先（苦手の画面）を作るまで隠しておく
  static let showsWeakPointEntry = false

  /// 選んでいる場面の ID
  @State private var selected: String?
  /// 場面の名前の行が、スクロールで上に隠れたか（隠れたら、同じ行を上に残す）
  @State private var barHidden = false
  /// 回ごとの録音を鳴らす口。1 つを共有し、別の回を押したら前のを止める（2 本同時に鳴らさない）
  @State private var player = VoicePlayer()

  private var scenes: [RecordScene] { library.scenes }
  private var current: RecordScene? {
    scenes.first { $0.id == selected } ?? scenes.first
  }

  var body: some View {
    list
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

  private var list: some View {
    VStack(spacing: 0) {
      ResultSubHeader(title: "きろく", onBack: onBack)
        .resultColumn()
        .padding(.top, 8)
      if let current {
        ScrollView {
          // 横の並びは遅延しない VStack に置く（下にスクロールして戻っても、3D と横の位置がそのまま残る）。
          // 回の振り返りは数が多いことがあるので、その部分だけ遅延にする
          VStack(spacing: 0) {
            if Self.showsWeakPointEntry {
              // 押した先は次の PR で作る
              Button {
              } label: {
                Label("苦手をぶっとばせ！", systemImage: "bolt.fill")
              }
              .buttonStyle(BigButtonStyle(kind: .primary))
              .resultColumn()
              .padding(.top, 12)
              .padding(.bottom, 14)
            }
            Text("りれき")
              .font(Theme.font(26, .black))
              .frame(maxWidth: .infinity, alignment: .leading)
              .resultColumn()
              .padding(.top, 12)
            SceneCarousel(scenes: scenes, selected: $selected, mode: Self.sceneMode)
            PageDots(count: scenes.count, index: scenes.firstIndex { $0.id == current.id } ?? 0)
              .padding(.top, 4)
            SceneBar(scene: current, onStep: step)
              .onGeometryChange(for: Bool.self) { proxy in
                proxy.frame(in: .scrollView).minY < 0
              } action: { hidden in
                barHidden = hidden
              }
            SceneRounds(scene: current, recordings: library.recordings)
              .resultColumn()
              .padding(.top, 8)
              .padding(.bottom, 56)
              // 場面を替えたら、棒の伸びる動きなどを初めからにする
              .id(current.id)
          }
        }
        // 下にスクロールしても、場面の名前は上に残す（下の中身と重ならないよう、地の色と下の線を付ける）
        .overlay(alignment: .top) {
          if barHidden {
            SceneBar(scene: current, onStep: step, pinned: true)
              .accessibilityHidden(true)
          }
        }
        // 最下部は、下に行くほど地の色に溶かして、続きがあることを示す
        .overlay(alignment: .bottom) {
          LinearGradient(colors: [Theme.background.opacity(0), Theme.background], startPoint: .top, endPoint: .bottom)
            .frame(height: 72)
            .ignoresSafeArea(edges: .bottom)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
      } else {
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
  }

  /// 遊んだ日と時刻（例: 11/12 14:05）。同じ日に何回か遊んでも見分けられるよう、時刻も出す
  static func dayAndTime(_ date: Date) -> String {
    // 端末の言語の設定によらず、24 時間で出す
    let c = Calendar.current.dateComponents([.month, .day, .hour, .minute], from: date)
    return String(format: "%d/%d %d:%02d", c.month ?? 0, c.day ?? 0, c.hour ?? 0, c.minute ?? 0)
  }
}

// MARK: - 横の並び

/// 場面の横の並び。真ん中に 1 つ大きく出し、左右に隣の場面が少しのぞく。端はフェードで消す
private struct SceneCarousel: View {
  let scenes: [RecordScene]
  @Binding var selected: String?
  let mode: RecordsView.SceneMode

  /// いま真ん中にある場面が何番目か（送っている途中も変わる）。隣を小さく薄くするのに使う
  @State private var middle = 0

  /// 1 つの場面の幅（画面の幅に対する割合）
  private static let tileRatio = 0.58
  private static let height: CGFloat = 250

  var body: some View {
    GeometryReader { geo in
      let tile = geo.size.width * Self.tileRatio
      ScrollViewReader { proxy in
        ScrollView(.horizontal) {
          HStack(spacing: 0) {
            ForEach(Array(scenes.enumerated()), id: \.element.id) { index, scene in
              let isMiddle = index == middle
              SceneTile(scene: scene, shows3D: shows3D(at: index), isMiddle: isMiddle)
                .frame(width: tile, height: Self.height)
                // 隣の場面は少し小さく、薄くする。後ろの印が 3D から透けないよう、まとめてから薄くする
                .compositingGroup()
                .scaleEffect(isMiddle ? 1 : 0.85)
                .opacity(isMiddle ? 1 : 0.7)
                .animation(.easeOut(duration: 0.2), value: isMiddle)
            }
          }
          .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.viewAligned)
        // 初めと終わりの場面も真ん中に来るよう、両端を空ける
        .safeAreaPadding(.horizontal, (geo.size.width - tile) / 2)
        // 真ん中に来た場面を、スクロールの位置から数える
        .onScrollGeometryChange(for: Int.self) { geometry in
          Int(((geometry.contentOffset.x + geometry.contentInsets.leading) / max(1, tile)).rounded())
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
      }
      .mask {
        LinearGradient(
          stops: [
            .init(color: .clear, location: 0), .init(color: .black, location: 0.1),
            .init(color: .black, location: 0.9), .init(color: .clear, location: 1),
          ], startPoint: .leading, endPoint: .trailing)
      }
    }
    .frame(height: Self.height)
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

/// 横の並びの 1 つ。3D（ゆっくり回り続け、触れない）か、名前だけの板
private struct SceneTile: View {
  let scene: RecordScene
  let shows3D: Bool
  /// 真ん中の場面か。隣の場面では名前を出さない（薄くしたときに 3D の後ろから透けないよう）
  let isMiddle: Bool

  var body: some View {
    if shows3D, let layout = scene.layout {
      RecordSceneView(layout: layout, key: scene.sceneKey, name: scene.name, showsName: isMiddle)
    } else {
      ScenePlaceholder(name: scene.name, showsName: isMiddle)
    }
  }
}

/// 何番目の場面かの点。多いときは「3 / 12」と数で出す
private struct PageDots: View {
  let count: Int
  let index: Int

  var body: some View {
    Group {
      if count <= 1 {
        EmptyView()
      } else if count <= 8 {
        HStack(spacing: 8) {
          ForEach(0..<count, id: \.self) { i in
            Circle()
              .fill(i == index ? Theme.accent : Theme.accentSoft)
              .frame(width: 8, height: 8)
          }
        }
      } else {
        Text("\(index + 1) / \(count)")
          .font(Theme.font(13, .heavy))
          .foregroundStyle(Theme.muted)
          .monospacedDigit()
      }
    }
    .frame(height: 12)
    .accessibilityHidden(true)
  }
}

// MARK: - 選んでいる場面

/// 場面の名前と遊んだ回数。下にスクロールしても上に残る
private struct SceneBar: View {
  let scene: RecordScene
  /// 隣の場面を選ぶ（-1 で前、+1 で次）。読み上げでは横に送れないので、ここの操作で替える
  let onStep: (Int) -> Void
  /// 上に残している行か。下の線を引き、下の中身と分ける
  var pinned = false

  var body: some View {
    VStack(spacing: 2) {
      Text(scene.name)
        .font(Theme.font(22, .black))
        .multilineTextAlignment(.center)
      Text("\(scene.entries.count) 回あそんだ")
        .font(Theme.font(13, .heavy))
        .foregroundStyle(Theme.muted)
    }
    .resultColumn()
    .padding(.vertical, 8)
    .frame(maxWidth: .infinity)
    .background(Theme.background)
    .overlay(alignment: .bottom) {
      if pinned {
        Rectangle().fill(Theme.line).frame(height: 1.5)
      }
    }
    .shadow(color: Theme.ink.opacity(pinned ? 0.06 : 0), radius: 6, y: 3)
    .accessibilityElement(children: .combine)
    .accessibilityAction(named: "次の場面") { onStep(1) }
    .accessibilityAction(named: "前の場面") { onStep(-1) }
  }
}

/// 選んでいる場面を遊んだ回の振り返り。新しい順に、日付の見出しで区切って縦に並べる。
/// 中身は遊んだ直後の振り返りと同じ（ReviewBody。順位は出さない）
private struct SceneRounds: View {
  let scene: RecordScene
  /// 記録の ID ごとの自分の録音（読み直すときに 1 度だけ読んだもの）
  let recordings: [String: RecordedAudio]

  var body: some View {
    LazyVStack(spacing: 20) {
      ForEach(Array(scene.entries.enumerated()), id: \.element.id) { index, entry in
        VStack(spacing: 14) {
          RoundDivider(
            text: index == 0 ? "最新 \(RecordsView.dayAndTime(entry.playedAt))" : RecordsView.dayAndTime(entry.playedAt))
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

/// 回の区切り（─── 11/11 ───）
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
