import SwiftUI

/// きろく。遊んだ場面が横に並び（最後に遊んだのが新しい順）、選んだ場面の最新の採点と、
/// 同じ場面を遊んだ記録（新しい順）が下に続く。記録を押すと、遊んだ直後と同じ振り返りを開き直す
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
  /// 開き直している記録
  @State private var opened: RecordEntry?

  private var scenes: [RecordScene] { library.scenes }
  private var current: RecordScene? {
    scenes.first { $0.id == selected } ?? scenes.first
  }

  var body: some View {
    ZStack {
      // 一覧は出したまま、振り返りを上に重ねる。一覧の 3D を消して出し直さないため
      // （3D の入った view を画面の切り替えと同時に出し入れすると、後から出た 3D が描き直されないことがある）
      list
        .accessibilityHidden(opened != nil)
      if let opened {
        ReviewView(
          results: opened.results, recording: library.recording(of: opened), title: Self.title(of: opened),
          savedLayout: opened.layout, savedSceneKey: opened.sceneKey, showsPlace: false,
          onBack: { self.opened = nil }
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
        .transition(.move(edge: .trailing))
      }
    }
    .animation(.easeInOut(duration: 0.25), value: opened)
    .task { await library.reload() }
  }

  private var list: some View {
    VStack(spacing: 0) {
      ResultSubHeader(title: "きろく", onBack: onBack)
        .resultColumn()
        .padding(.top, 8)
      if let current {
        ScrollView {
          LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
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
            Section {
              SceneRecords(scene: current) { opened = $0 }
                .resultColumn()
                .padding(.top, 8)
                .padding(.bottom, 28)
                // 場面を替えたら、棒の伸びる動きなどを初めからにする
                .id(current.id)
            } header: {
              SceneBar(scene: current)
            }
          }
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

  /// 開き直した振り返りの見出し（例: 11/12 図書館の二人）
  static func title(of entry: RecordEntry) -> String {
    "\(Self.day(entry.playedAt)) \(entry.results.sceneName)"
  }

  /// 遊んだ日（例: 11/12）
  static func day(_ date: Date) -> String {
    date.formatted(.dateTime.month(.defaultDigits).day())
  }
}

// MARK: - 横の並び

/// 場面の横の並び。真ん中に 1 つ大きく出し、左右に隣の場面が少しのぞく。端はフェードで消す
private struct SceneCarousel: View {
  let scenes: [RecordScene]
  @Binding var selected: String?
  let mode: RecordsView.SceneMode

  /// 1 つの場面の幅（画面の幅に対する割合）
  private static let tileRatio = 0.58
  private static let height: CGFloat = 250

  var body: some View {
    GeometryReader { geo in
      let tile = geo.size.width * Self.tileRatio
      ScrollView(.horizontal) {
        HStack(spacing: 0) {
          ForEach(Array(scenes.enumerated()), id: \.element.id) { index, scene in
            let isCenter = index == center
            SceneTile(scene: scene, shows3D: shows3D(at: index))
              .frame(width: tile, height: Self.height)
              // 隣の場面は少し小さく、薄くする
              .scaleEffect(isCenter ? 1 : 0.85)
              .opacity(isCenter ? 1 : 0.7)
              .animation(.easeOut(duration: 0.2), value: isCenter)
              .accessibilityLabel(scene.name)
          }
        }
        .scrollTargetLayout()
      }
      .scrollIndicators(.hidden)
      .scrollTargetBehavior(.viewAligned)
      // 初めと終わりの場面も真ん中に来るよう、両端を空ける
      .safeAreaPadding(.horizontal, (geo.size.width - tile) / 2)
      // 真ん中に来た場面を、選んでいる場面にする（スクロールの位置から数える）
      .onScrollGeometryChange(for: Int.self) { geometry in
        Int(((geometry.contentOffset.x + geometry.contentInsets.leading) / max(1, tile)).rounded())
      } action: { _, index in
        guard scenes.indices.contains(index) else { return }
        selected = scenes[index].id
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

  var body: some View {
    if shows3D, let layout = scene.layout {
      RecordSceneView(layout: layout, key: scene.sceneKey)
    } else {
      VStack(spacing: 10) {
        Image(systemName: "cube.fill")
          .font(.system(size: 30, weight: .bold))
          .foregroundStyle(Theme.accent.opacity(0.5))
        Text(scene.name)
          .font(Theme.font(17, .heavy))
          .foregroundStyle(Theme.muted)
          .multilineTextAlignment(.center)
      }
      .padding(16)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Theme.accentSoft.opacity(0.6), in: RoundedRectangle(cornerRadius: 28))
      .padding(.horizontal, 10)
      .padding(.vertical, 40)
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
    .accessibilityElement(children: .combine)
  }
}

/// 選んでいる場面の最新の採点と、それより前の記録（新しい順）
private struct SceneRecords: View {
  let scene: RecordScene
  let onOpen: (RecordEntry) -> Void

  var body: some View {
    VStack(spacing: 20) {
      LatestSummary(entry: scene.latest) { onOpen(scene.latest) }
      let older = scene.entries.dropFirst()
      if !older.isEmpty {
        VStack(spacing: 10) {
          Text("これまで")
            .font(Theme.font(15, .heavy))
            .foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
          ForEach(older) { entry in
            Button {
              onOpen(entry)
            } label: {
              RecordRow(entry: entry)
            }
            .buttonStyle(.plain)
          }
        }
      }
    }
  }
}

/// 最新の採点。合計と 3 つの点、言えた項目の要約。枠では囲まない
private struct LatestSummary: View {
  let entry: RecordEntry
  let onOpen: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Text("最新の採点")
        Spacer()
        Text(RecordsView.day(entry.playedAt)).monospacedDigit()
      }
      .font(Theme.font(15, .heavy))
      .foregroundStyle(Theme.muted)

      if let score = entry.score {
        HStack(spacing: 14) {
          if let difficulty = entry.difficulty {
            DifficultyChip(difficulty: difficulty, size: 16)
          }
          PointsText(total: score.total, size: 48)
            .foregroundStyle(Theme.accent)
        }
        VStack(spacing: 12) {
          ScoreBar(label: "内容", value: score.content)
          ScoreBar(label: "表現", value: score.expression)
          ScoreBar(label: "話し方", value: score.speaking)
        }
      }

      if let content = entry.content, !content.items.isEmpty {
        ItemSummary(content: content)
      }

      Button("振り返りをひらく", action: onOpen)
        .buttonStyle(BigButtonStyle(kind: .outlined))
        .padding(.top, 4)
    }
  }
}

/// 言えた項目と、あと少しの項目（一部だけ言えた）。言えていない項目は、振り返りで見る
private struct ItemSummary: View {
  let content: ContentBreakdown

  var body: some View {
    let said = content.items.filter { $0.level == .full }
    let partial = content.items.filter { $0.level == .partial }
    VStack(alignment: .leading, spacing: 10) {
      Text("言えた項目 \(said.count) / \(content.items.count)")
        .font(Theme.font(15, .heavy))
        .foregroundStyle(Theme.muted)
      if !said.isEmpty {
        FlowLayout {
          ForEach(said) { item in
            Label(item.label, systemImage: "checkmark")
              .font(Theme.font(14, .heavy))
              .foregroundStyle(Theme.ink)
              .padding(.horizontal, 12)
              .padding(.vertical, 6)
              .background(Theme.accentSoft, in: Capsule())
          }
        }
      }
      if !partial.isEmpty {
        Text("あと少し: \(partial.map(\.label).joined(separator: "、"))")
          .font(Theme.font(14, .heavy))
          .foregroundStyle(Theme.muted)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

/// 前の記録の 1 行。日付・難易度・合計・言えた項目の数
private struct RecordRow: View {
  let entry: RecordEntry

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        Text(RecordsView.day(entry.playedAt))
          .font(Theme.font(14, .heavy))
          .foregroundStyle(Theme.muted)
          .monospacedDigit()
        HStack(spacing: 10) {
          if let difficulty = entry.difficulty {
            DifficultyChip(difficulty: difficulty)
          }
          if let score = entry.score {
            PointsText(total: score.total, size: 26)
          }
        }
      }
      Spacer(minLength: 8)
      if let content = entry.content, !content.items.isEmpty {
        Text("言えた \(content.fullCount) / \(content.items.count)")
          .font(Theme.font(14, .heavy))
          .foregroundStyle(Theme.muted)
          .monospacedDigit()
      }
      Image(systemName: "chevron.right")
        .font(.system(size: 15, weight: .bold))
        .foregroundStyle(Theme.gray)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 14)
    .resultCard()
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isButton)
  }
}
