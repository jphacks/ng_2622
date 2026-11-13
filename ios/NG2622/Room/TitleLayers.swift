import Foundation

/// ホームの 3D の重なり（HomeView の SpinningScene の状態）。出すもの（HomeTitle）が替わったら、新しい 3D を前の 3D の上に
/// ほとんど見えない濃さで置いて描かせておき、描かれたら（settle）、新しい 3D を濃くする・前の 3D を薄くして外す・札を出し入れ
/// するのを同じアニメーションで同時に行う。値の型にして、入れ替えの手順（A → B → A、読めない 3D、字だけの変更）をテストできるようにする
struct TitleLayers {
  struct Layer: Identifiable, Equatable {
    /// 置くたびに新しくする。同じ title を置き直しても別の層として扱い、前の層の知らせと取り違えない
    let id: UUID
    var title: HomeTitle
    /// 動き（振り・回転）の 0 秒
    let start: Date
    /// 描かれて見えているか。落ち着く前は、ほとんど見えない濃さで描かせておく
    var settled: Bool
  }

  enum Change: Equatable {
    /// 同じものなので何もしない
    case none
    /// いちばん上の層の title だけを替えた（3D は同じで、字だけが替わった。向きもそのまま）
    case retitled
    /// 新しい層を上に置いた。描かれたら settle を呼ぶ
    case added
  }

  private(set) var layers: [Layer]

  /// 最初の 3D。広告の 3D は、描かれるまで見えていないものとして扱い（薄くしておく）、描かれたら札と一緒に出す。
  /// 公園は札が無いので、待たずにすぐ出す
  init(_ title: HomeTitle, now: Date = Date()) {
    layers = [Layer(id: UUID(), title: title, start: now, settled: title == .park)]
  }

  /// いちばん上（いちばん新しい）の層
  var top: Layer { layers[layers.count - 1] }

  /// 見えている 3D（落ち着いた層のうち、いちばん上）。まだ何も描かれていなければ nil
  var shown: HomeTitle? { layers.last(where: \.settled)?.title }

  /// 出すものを title に替える
  mutating func show(_ title: HomeTitle, now: Date = Date()) -> Change {
    if top.title == title { return .none }
    if top.title.sameModel(as: title) {
      layers[layers.count - 1].title = title
      return .retitled
    }
    layers.append(Layer(id: UUID(), title: title, start: now, settled: false))
    return .added
  }

  /// id の層の 3D が描かれた。いちばん上の層なら落ち着かせ、下の層をすべて外して true を返す。
  /// いちばん上でなければ（もっと新しい層を置いた後に、前の層の知らせが届いた）何もせず false
  mutating func settle(_ id: UUID) -> Bool {
    guard top.id == id else { return false }
    layers[layers.count - 1].settled = true
    layers.removeAll { $0.id != id }
    return true
  }
}

extension HomeTitle {
  /// 同じ 3D か（公園どうし、または同じ USDZ の広告）。字（caption）は見ない
  func sameModel(as other: HomeTitle) -> Bool {
    switch (self, other) {
    case (.park, .park): true
    case (.advert(let a, _), .advert(let b, _)): a.standardizedFileURL == b.standardizedFileURL
    default: false
    }
  }
}
