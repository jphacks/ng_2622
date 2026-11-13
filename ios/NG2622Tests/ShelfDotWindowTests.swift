import Testing

@testable import NG2622

/// きろくの場面の並びの点（最大 5 つ・範囲をずらす・端を小さくする・1 つなら出さない）
struct ShelfDotWindowTests {
  /// 点の並びを短い文字にする。今の場面は [2]、小さな点は ·2、ふつうの点は 2
  func render(_ count: Int, _ current: Int) -> String {
    ShelfDotWindow.dots(count: count, current: current).map { dot in
      dot.isCurrent ? "[\(dot.index)]" : dot.isSmall ? "·\(dot.index)" : "\(dot.index)"
    }
    .joined(separator: " ")
  }

  /// 場面が 1 つ（や 0）なら、点を出さない
  @Test func noDotsForOneScene() {
    #expect(render(1, 0) == "")
    #expect(render(0, 0) == "")
  }

  /// 5 つまでは全部の点を出し、小さくしない
  @Test func showsAllDotsUpToFive() {
    #expect(render(2, 0) == "[0] 1")
    #expect(render(2, 1) == "0 [1]")
    #expect(render(5, 0) == "[0] 1 2 3 4")
    #expect(render(5, 2) == "0 1 [2] 3 4")
    #expect(render(5, 4) == "0 1 2 3 [4]")
  }

  /// 6 つ: 先頭の近くでは右端だけ、末尾の近くでは左端だけを小さくする
  @Test func sixScenes() {
    #expect(render(6, 0) == "[0] 1 2 3 ·4")
    #expect(render(6, 2) == "0 1 [2] 3 ·4")
    #expect(render(6, 3) == "·1 2 [3] 4 5")
    #expect(render(6, 5) == "·1 2 3 4 [5]")
  }

  /// 10: 5 つだけ見せ、中ほどでは両端を小さくする（10 個並べない）
  @Test func tenScenes() {
    #expect(render(10, 0) == "[0] 1 2 3 ·4")
    #expect(render(10, 1) == "0 [1] 2 3 ·4")
    #expect(render(10, 4) == "·2 3 [4] 5 ·6")
    #expect(render(10, 5) == "·3 4 [5] 6 ·7")
    #expect(render(10, 8) == "·5 6 7 [8] 9")
    #expect(render(10, 9) == "·5 6 7 8 [9]")
  }

  /// どの数・どの位置でも、点は 5 つ以下で、今の場面の点が 1 つだけあり、それは小さくならない。
  /// 小さな点は、その先に見せていない場面がある側の端だけ
  @Test func invariants() {
    for count in 2...12 {
      for current in 0..<count {
        let dots = ShelfDotWindow.dots(count: count, current: current)
        #expect(dots.count == min(count, ShelfDotWindow.maxVisible))
        #expect(dots.filter(\.isCurrent).map(\.index) == [current])
        #expect(!dots.contains { $0.isCurrent && $0.isSmall })
        #expect(dots.map(\.index) == Array(dots[0].index...dots[dots.count - 1].index))
        let first = dots[0].index
        let last = dots[dots.count - 1].index
        let small = [first > 0 ? first : nil, last < count - 1 ? last : nil].compactMap { $0 }
        #expect(dots.filter(\.isSmall).map(\.index) == small)
      }
    }
  }

  /// 範囲の外の位置は、端にそろえる
  @Test func clampsOutOfRange() {
    #expect(render(3, -1) == "[0] 1 2")
    #expect(render(3, 7) == "0 1 [2]")
  }
}
