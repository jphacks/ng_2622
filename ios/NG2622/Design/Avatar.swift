import SwiftUI

/// 名前の 1 文字目を白で載せた色の丸
struct Avatar: View {
  let name: String
  let color: UInt32
  var size: CGFloat = 44

  var body: some View {
    Circle()
      .fill(Color(hex: color))
      .frame(width: size, height: size)
      .overlay {
        Text(name.isEmpty ? "?" : String(name.prefix(1)))
          .font(Theme.font(size * 0.43, .black))
          .foregroundStyle(.white)
      }
  }
}

/// 左上の丸いボタン（戻る・退出）
struct CircleIconButton: View {
  let systemName: String
  let label: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: systemName)
        .font(.system(size: 18, weight: .bold))
        .foregroundStyle(Theme.accent)
        .frame(width: 44, height: 44)
        .background(.white, in: Circle())
        .shadow(color: Theme.ink.opacity(0.1), radius: 5, y: 2)
    }
    .accessibilityLabel(label)
  }
}
