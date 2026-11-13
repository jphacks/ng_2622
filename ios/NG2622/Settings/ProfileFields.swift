import SwiftUI

/// 名前と色の欄（設定の「あなた」の板の中）。前にホームにあった欄と同じ形で、名前はその場で打ち替え、色は 6 色の丸から選ぶ。
/// ここで打っている間は手元の値だけを変え、設定から戻るときに保存する（PlayerProfile.edited）
struct ProfileFields: View {
  @Binding var name: String
  @Binding var color: UInt32
  var editing: FocusState<Bool>.Binding

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 12) {
        Avatar(name: PlayerProfile.trimmed(name), color: color, size: 52)
          .animation(.easeOut(duration: 0.2), value: color)
        NameField(name: $name, editing: editing)
          .onSubmit { editing.wrappedValue = false }
      }
      HStack(spacing: 0) {
        ForEach(PlayerProfile.colors, id: \.self) { c in
          Button {
            color = c
          } label: {
            Circle()
              .fill(Color(hex: c))
              .frame(width: 30, height: 30)
              .padding(4)
              .overlay {
                Circle().strokeBorder(color == c ? Theme.ink : .clear, lineWidth: 2.5)
              }
          }
          .accessibilityLabel("色 \(PlayerProfile.colors.firstIndex(of: c).map { $0 + 1 } ?? 0)")
          .accessibilityAddTraits(color == c ? .isSelected : [])
          if c != PlayerProfile.colors.last { Spacer(minLength: 0) }
        }
      }
      .padding(.horizontal, 2)
      Text("変えた名前と色は、次に入る部屋から使います。")
        .font(Theme.font(14, .bold))
        .foregroundStyle(Theme.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}
