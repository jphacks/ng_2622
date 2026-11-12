import SwiftUI

/// 設定。端末に残した遊んだ記録と録音を、まとめて消せる
struct SettingsView: View {
  let library: RecordLibrary
  let onBack: () -> Void

  @State private var confirming = false
  /// 消している（終わるまでボタンを押せなくする）
  @State private var deleting = false
  /// 消せなかった
  @State private var failed = false

  var body: some View {
    VStack(spacing: 0) {
      ResultSubHeader(title: "設定", onBack: onBack)
        .resultColumn()
        .padding(.top, 8)
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
    .overlay {
      if confirming {
        ConfirmDelete(
          count: library.count, audioCount: library.audioCount,
          onCancel: { confirming = false },
          onDelete: {
            confirming = false
            deleting = true
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
}

/// 「すべて消しますか？」の確かめ。消すほうはオレンジにする
private struct ConfirmDelete: View {
  let count: Int
  /// 録音の本数。0 本なら、録音のことは書かない
  let audioCount: Int
  let onCancel: () -> Void
  let onDelete: () -> Void

  /// 消えるものに合わせた文
  private var message: String {
    let what =
      switch (count > 0, audioCount > 0) {
      case (true, true): "きろく \(count) 回と録音 \(audioCount) 本"
      case (true, false): "きろく \(count) 回"
      case (false, _): "読めなかったきろくのファイル"
      }
    return "\(what)が、この iPhone から消えます。元にもどせません。"
  }

  var body: some View {
    ZStack {
      Theme.ink.opacity(0.35)
        .ignoresSafeArea()
        .onTapGesture(perform: onCancel)
      VStack(spacing: 0) {
        VStack(spacing: 10) {
          Text("すべて消しますか？")
            .font(Theme.font(20, .black))
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
          Button(action: onDelete) {
            Text("消す")
              .foregroundStyle(Theme.mismatch)
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
