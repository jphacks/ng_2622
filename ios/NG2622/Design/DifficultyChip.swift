import SwiftUI

/// 難易度の小さな札（かんたん・ふつう・むずかしい）。振り返りに出す
struct DifficultyChip: View {
  let difficulty: SceneDifficulty
  var size: CGFloat = 14

  var body: some View {
    Text(difficulty.label)
      .font(Theme.font(size, .heavy))
      .foregroundStyle(Theme.accent)
      // 狭い所でも「かんた／ん」と折れないようにする
      .lineLimit(1)
      .fixedSize()
      .padding(.horizontal, size * 0.85)
      .padding(.vertical, size * 0.25)
      .background(Theme.accentSoft, in: Capsule())
      .accessibilityLabel("難易度 \(difficulty.label)")
  }
}

/// 中身の幅で折り返して横に並べる（チェックの札など）
struct FlowLayout: Layout {
  var spacing: CGFloat = 8
  var lineSpacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
    let height = rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(0, rows.count - 1))
    let width = rows.map(\.width).max() ?? 0
    return CGSize(width: proposal.width ?? width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in arrange(width: bounds.width, subviews: subviews) {
      var x = bounds.minX
      for index in row.indices {
        let size = subviews[index].sizeThatFits(.init(width: bounds.width, height: nil))
        subviews[index].place(at: CGPoint(x: x, y: y), proposal: .init(width: min(size.width, bounds.width), height: size.height))
        x += size.width + spacing
      }
      y += row.height + lineSpacing
    }
  }

  private struct Row {
    var indices: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
    var rows: [Row] = []
    var row = Row()
    for (i, view) in subviews.enumerated() {
      let size = view.sizeThatFits(.init(width: width, height: nil))
      let w = min(size.width, width)
      if !row.indices.isEmpty && row.width + spacing + w > width {
        rows.append(row)
        row = Row()
      }
      row.width += (row.indices.isEmpty ? 0 : spacing) + w
      row.height = max(row.height, size.height)
      row.indices.append(i)
    }
    if !row.indices.isEmpty { rows.append(row) }
    return rows
  }
}
