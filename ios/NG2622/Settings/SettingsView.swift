import SwiftUI

/// 設定。自分の名前と色を変えられる。端末に残した遊んだ記録と録音を、まとめて消せる
struct SettingsView: View {
  let library: RecordLibrary
  /// 自分の名前と色。変えると、次に入る部屋から使う
  @Binding var profile: PlayerProfile
  let onBack: () -> Void

  @State private var confirming = false
  /// 消せなかった
  @State private var failed = false
  /// 名前と色を変える画面を開いている
  @State private var editingProfile = false

  var body: some View {
    VStack(spacing: 0) {
      ResultSubHeader(title: "設定", onBack: onBack)
        .resultColumn()
        .padding(.top, 8)
      profileCard
        .resultColumn()
        .padding(.top, 16)
      VStack(alignment: .leading, spacing: 12) {
        Text("きろく")
          .font(Theme.font(14, .heavy))
          .foregroundStyle(Theme.muted)
        HStack(alignment: .firstTextBaseline) {
          Text("保存しているきろく")
            .font(Theme.font(18, .heavy))
          Spacer(minLength: 8)
          Text("\(library.count) 回・録音 \(library.audioCount) 本")
            .font(Theme.font(15, .heavy))
            .foregroundStyle(Theme.muted)
            .monospacedDigit()
        }
        Text("きろくと録音は、この iPhone の中だけに保存しています。")
          .font(Theme.font(14, .bold))
          .foregroundStyle(Theme.muted)
          .fixedSize(horizontal: false, vertical: true)
        Button {
          confirming = true
        } label: {
          Text("きろくと録音をすべて消す")
            .font(Theme.font(18, .heavy))
            .foregroundStyle(library.canDelete ? Theme.mismatch : Theme.gray)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .overlay {
              Capsule().strokeBorder(library.canDelete ? Theme.mismatch : Theme.disabledBorder, lineWidth: 2.5)
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        // 読める記録が 0 件でも、読めなかったファイルが残っていれば消せる
        .disabled(!library.canDelete)
        .padding(.top, 4)
        if failed {
          Text("消せませんでした。もう一度ためしてください。")
            .font(Theme.font(14, .heavy))
            .foregroundStyle(Theme.mismatch)
        }
      }
      .padding(18)
      .resultCard()
      .resultColumn()
      .padding(.top, 16)
      Spacer()
    }
    .overlay {
      if confirming {
        ConfirmDialog(
          title: "すべて消しますか？",
          message: library.count > 0
            ? "きろく \(library.count) 回と録音が、この iPhone から消えます。元にもどせません。"
            : "読めなかったきろくのファイルが、この iPhone から消えます。元にもどせません。",
          action: "消す", actionColor: Theme.mismatch,
          onCancel: { confirming = false },
          onAction: {
            confirming = false
            Task { failed = (try? await library.deleteAll()) == nil }
          })
      }
    }
    .animation(.easeOut(duration: 0.15), value: confirming)
    .overlay {
      if editingProfile {
        ProfileEditView(profile: $profile, onBack: { editingProfile = false })
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(Theme.background.ignoresSafeArea())
          .transition(.opacity)
      }
    }
    .animation(.easeInOut(duration: 0.25), value: editingProfile)
    .task { await library.reload() }
  }

  /// 「あなた」。押すと名前と色を変える画面を開く
  private var profileCard: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("あなた")
        .font(Theme.font(14, .heavy))
        .foregroundStyle(Theme.muted)
      Button {
        editingProfile = true
      } label: {
        HStack(spacing: 12) {
          Avatar(name: profile.name, color: profile.color, size: 44)
          Text(profile.name)
            .font(Theme.font(20, .heavy))
            .lineLimit(1)
          Spacer(minLength: 8)
          Text("名前と色を変える")
            .font(Theme.font(14, .heavy))
            .foregroundStyle(Theme.muted)
          Image(systemName: "chevron.right")
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Theme.gray)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityElement(children: .combine)
      .accessibilityAddTraits(.isButton)
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
  }
}
