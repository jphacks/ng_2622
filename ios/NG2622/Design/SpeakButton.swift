import SwiftUI

/// 丸いスピーカーのボタン。流している間は停止の形にする（自分の録音・お手本の読み上げ）
struct SpeakButton: View {
  let isPlaying: Bool
  /// 流していないときの読み上げ用の名前（例: 自分の録音を再生）
  let label: String
  let action: () -> Void

  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    Button(action: action) {
      Image(systemName: isPlaying ? "stop.fill" : "speaker.wave.2.fill")
        .font(.system(size: isPlaying ? 13 : 15, weight: .bold))
        .foregroundStyle(isEnabled ? Theme.accent : Theme.gray)
        .frame(width: 32, height: 32)
        .background(isPlaying ? Theme.card : (isEnabled ? Theme.accentSoft : Theme.offlineIcon), in: Circle())
        .contentTransition(.symbolEffect(.replace))
    }
    .accessibilityLabel(isPlaying ? "停止" : label)
  }
}

/// 子を左から並べ、幅が足りなくなったら次の行へ送る（振り返りの単語の並び）
struct FlowLayout: Layout {
  var spacing: CGFloat = 4
  var lineSpacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
    let width = rows.map { $0.width }.max() ?? 0
    let height = rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(0, rows.count - 1))
    return CGSize(width: proposal.width ?? width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in arrange(width: bounds.width, subviews: subviews) {
      var x = bounds.minX
      for index in row.indices {
        let size = subviews[index].sizeThatFits(.unspecified)
        subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
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
    for index in subviews.indices {
      let size = subviews[index].sizeThatFits(.unspecified)
      let added = row.indices.isEmpty ? size.width : row.width + spacing + size.width
      if added > width, !row.indices.isEmpty {
        rows.append(row)
        row = Row()
      }
      row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
      row.height = max(row.height, size.height)
      row.indices.append(index)
    }
    if !row.indices.isEmpty { rows.append(row) }
    return rows
  }
}
