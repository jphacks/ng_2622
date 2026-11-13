import SwiftUI

/// 画面の上に重ねる確かめ（「すべて消しますか？」「別のルームに入りますか？」）。
/// 左が「やめる」、右がする方。外を押すと、やめる
struct ConfirmDialog: View {
  let title: String
  let message: String
  /// する方のボタンの文言
  let action: String
  /// する方のボタンの色（消すときはオレンジ）
  var actionColor = Theme.accent
  let onCancel: () -> Void
  let onAction: () -> Void

  var body: some View {
    ZStack {
      Theme.ink.opacity(0.35)
        .ignoresSafeArea()
        .onTapGesture(perform: onCancel)
      VStack(spacing: 0) {
        VStack(spacing: 10) {
          Text(title)
            .font(Theme.font(20, .black))
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
          Text(message)
            .font(Theme.font(15, .bold))
            .foregroundStyle(Theme.muted)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 24)
        Rectangle().fill(Theme.line).frame(height: 1.5)
        HStack(spacing: 0) {
          // 文字だけでなく、枠の半分ずつを押せる範囲にする
          Button(action: onCancel) {
            Text("やめる")
              .foregroundStyle(Theme.accent)
              .frame(maxWidth: .infinity, minHeight: 54)
              .contentShape(Rectangle())
          }
          Rectangle().fill(Theme.line).frame(width: 1.5, height: 54)
          Button(action: onAction) {
            Text(action)
              .foregroundStyle(actionColor)
              .frame(maxWidth: .infinity, minHeight: 54)
              .contentShape(Rectangle())
          }
        }
        .font(Theme.font(19, .heavy))
      }
      .frame(width: 300)
      .background(Theme.card, in: RoundedRectangle(cornerRadius: 22))
      .accessibilityAddTraits(.isModal)
    }
    .transition(.opacity)
  }
}
