import SwiftUI

/// 設定。自分の名前と色を、この画面の中で変えられる（戻るときに保存する）。端末に残した遊んだ記録と録音を、まとめて消せる
struct SettingsView: View {
  let library: RecordLibrary
  /// 自分の名前と色。変えると、次に入る部屋から使う
  @Binding var profile: PlayerProfile
  let onBack: () -> Void

  @State private var confirming = false
  /// 消している（終わるまでボタンを押せなくする）
  @State private var deleting = false
  /// 消せなかった
  @State private var failed = false
  /// 打っている名前と、選んでいる色。戻るときに profile に入れる
  @State private var name: String
  @State private var color: UInt32
  @FocusState private var editing: Bool

  init(library: RecordLibrary, profile: Binding<PlayerProfile>, onBack: @escaping () -> Void) {
    self.library = library
    _profile = profile
    self.onBack = onBack
    _name = State(initialValue: profile.wrappedValue.name)
    _color = State(initialValue: profile.wrappedValue.color)
  }

  var body: some View {
    VStack(spacing: 0) {
      ResultSubHeader(title: "設定", onBack: back)
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
            .foregroundStyle(library.canDelete && !deleting ? Theme.mismatch : Theme.gray)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .overlay {
              Capsule().strokeBorder(library.canDelete && !deleting ? Theme.mismatch : Theme.disabledBorder, lineWidth: 2.5)
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        // 読める記録が 0 件でも、読めなかったファイルが残っていれば消せる
        .disabled(!library.canDelete || deleting)
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
    .contentShape(Rectangle())
    .onTapGesture { editing = false }
    .overlay {
      if confirming {
        ConfirmDialog(
          title: "すべて消しますか？",
          message: Self.deleteMessage(count: library.count, audioCount: library.audioCount),
          action: "消す", actionColor: Theme.mismatch,
          onCancel: { confirming = false },
          onAction: {
            confirming = false
            deleting = true
            // 作っている途中の苦手の分析も捨てる（消したあとに応答が返って、消した記録の文を覚え直さないよう）
            WeakPointAnalyzer.app.forget()
            Task {
              failed = (try? await library.deleteAll()) == nil
              deleting = false
            }
          })
      }
    }
    .animation(.easeOut(duration: 0.15), value: confirming)
    .task { await library.reload() }
  }

  /// 戻る。打った名前と選んだ色を保存する（名前が空なら前の名前のまま）
  private func back() {
    editing = false
    profile = profile.edited(name: name, color: color)
    onBack()
  }

  /// 「すべて消しますか？」の文。消えるものに合わせ、録音が 0 本なら録音のことは書かない
  static func deleteMessage(count: Int, audioCount: Int) -> String {
    let what =
      switch (count > 0, audioCount > 0) {
      case (true, true): "きろく \(count) 回と録音 \(audioCount) 本"
      case (true, false): "きろく \(count) 回"
      case (false, _): "読めなかったきろくのファイル"
      }
    // 「ん。」などだけが次の行に落ちないよう、句の切れ目で改行する
    return "\(what)が、\nこの iPhone から消えます。\n元にもどせません。"
  }

  /// 「あなた」。名前の欄と 6 色の丸を、この板の中に置く
  private var profileCard: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("あなた")
        .font(Theme.font(14, .heavy))
        .foregroundStyle(Theme.muted)
      ProfileFields(name: $name, color: $color, editing: $editing)
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .resultCard()
  }
}
