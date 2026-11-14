import SwiftUI

/// きろくの場面の横の並びで、横にも場面があることと、いまどこにいるかを示す点（場面の名前のすぐ下）。
/// 今の場面は紫の少し長いカプセル、ほかは薄い紫がかった灰色の丸。どの点を出すかは ShelfDotWindow が決める。
/// 押せない。読み上げでは読まない（位置は、場面の所の読み上げの値で伝える）
struct ShelfDots: View {
  /// 場面の数
  let count: Int
  /// いま画面にある場面が何番目か（0 から）
  let current: Int

  /// 丸の直径（点の並びの高さ）
  static let size: CGFloat = 7
  /// 端の小さな丸の直径（その先にまだ場面がある側）
  static let smallSize: CGFloat = 4.5
  /// 今の場面のカプセルの幅
  static let currentWidth: CGFloat = 18
  static let spacing: CGFloat = 8

  var body: some View {
    HStack(spacing: Self.spacing) {
      ForEach(ShelfDotWindow.dots(count: count, current: current), id: \.index) { dot in
        let side = dot.isSmall ? Self.smallSize : Self.size
        Capsule()
          .fill(dot.isCurrent ? Theme.accent : Theme.disabledBorder)
          .frame(width: dot.isCurrent ? Self.currentWidth : side, height: side)
          // 小さな丸も、ふつうの丸と同じ幅の所に置く（範囲がずれても、並びの幅と位置を変えない）
          .frame(width: dot.isCurrent ? Self.currentWidth : Self.size, height: Self.size)
      }
    }
    .animation(.easeInOut(duration: 0.2), value: current)
    .accessibilityHidden(true)
  }
}

/// 点の並びのうち、どの点を出し、どれを小さくするか（View から切り離して試せるようにする）
nonisolated enum ShelfDotWindow {
  /// 同時に見せる点の最大の数
  static let maxVisible = 5

  struct Dot: Equatable, Sendable {
    /// 何番目の場面の点か（0 から）
    let index: Int
    /// 今の場面か
    let isCurrent: Bool
    /// 小さくするか（見せる範囲の端で、その先にまだ場面がある側）
    let isSmall: Bool
  }

  /// 場面が count 個で、いま current 番目のときに見せる点（左から順）。
  /// - 場面が 1 つ以下なら、点を出さない（横に送る先が無い）。
  /// - 5 つまでは全部の点を出す。
  /// - 6 つ以上は、今の場面をなるべく真ん中にして 5 つだけ見せ、その先にまだ場面がある側の端の点を小さくする
  ///   （今の場面の点は、小さくならない）
  static func dots(count: Int, current: Int) -> [Dot] {
    guard count > 1 else { return [] }
    let current = min(max(current, 0), count - 1)
    let shown = min(count, maxVisible)
    let first = min(max(current - shown / 2, 0), count - shown)
    let last = first + shown - 1
    return (first...last).map { index in
      Dot(
        index: index, isCurrent: index == current,
        isSmall: (index == first && first > 0) || (index == last && last < count - 1))
    }
  }
}
