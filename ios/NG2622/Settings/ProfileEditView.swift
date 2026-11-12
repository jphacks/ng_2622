import SwiftUI

/// 名前と色を変える（設定から開く）。打っている間は手元だけで変え、戻るときに保存する。
/// 名前を空にして戻ったときは、前の名前のままにする
struct ProfileEditView: View {
  @Binding var profile: PlayerProfile
  let onBack: () -> Void

  @State private var name: String
  @State private var color: UInt32
  @FocusState private var editing: Bool

  init(profile: Binding<PlayerProfile>, onBack: @escaping () -> Void) {
    _profile = profile
    self.onBack = onBack
    _name = State(initialValue: profile.wrappedValue.name)
    _color = State(initialValue: profile.wrappedValue.color)
  }

  var body: some View {
    VStack(spacing: 0) {
      ResultSubHeader(title: "名前と色", onBack: back)
        .resultColumn()
        .padding(.top, 8)
      VStack(alignment: .leading, spacing: 16) {
        HStack(spacing: 12) {
          Avatar(name: PlayerProfile.trimmed(name), color: color, size: 52)
            .animation(.easeOut(duration: 0.2), value: color)
          NameField(name: $name, editing: $editing)
            .onSubmit { editing = false }
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
      .padding(16)
      .resultCard()
      .resultColumn()
      .padding(.top, 16)
      Spacer()
    }
    .contentShape(Rectangle())
    .onTapGesture { editing = false }
  }

  private func back() {
    editing = false
    let trimmed = PlayerProfile.trimmed(name)
    profile = PlayerProfile(name: trimmed.isEmpty ? profile.name : trimmed, color: color)
    onBack()
  }
}
