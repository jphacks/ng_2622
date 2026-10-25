import SwiftUI

/// 結果発表の下に出す「このシーンを評価」。★を選び、コメントは任意。送ったあとも選び直して送り直せる
struct SceneRatingCard: View {
  let sceneID: String
  let sceneName: String
  /// 評価に出す自分の名前
  let playerName: String

  @State private var rating = 0
  @State private var comment = ""
  @State private var sending = false
  /// 送ったあとの平均と人数
  @State private var summary: SceneRating?
  @State private var failed = false

  var body: some View {
    VStack(spacing: 12) {
      Text("「\(sceneName)」はどうだった？")
        .font(Theme.font(16, .heavy))
      StarPicker(rating: $rating)
      TextField("ひとこと（なくてもよい）", text: $comment, axis: .vertical)
        .font(Theme.font(14, .bold))
        .lineLimit(1...3)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.background, in: RoundedRectangle(cornerRadius: 12))
        .onChange(of: comment) { _, new in
          if new.count > SceneReviews.maxCommentLength {
            comment = String(new.prefix(SceneReviews.maxCommentLength))
          }
        }
      Button(summary == nil ? "評価を送る" : "送り直す", action: send)
        .buttonStyle(BigButtonStyle(kind: .outlined))
        .disabled(rating == 0 || sending)
      if let summary, let average = summary.average {
        Text("送りました。みんなの評価 ★\(average, specifier: "%.1f")（\(summary.count) 人）")
          .font(Theme.font(13, .bold))
          .foregroundStyle(Theme.muted)
      } else if failed {
        Text("送れませんでした。もう一度お試しください")
          .font(Theme.font(13, .bold))
          .foregroundStyle(Theme.red)
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity)
    .resultCard()
  }

  private func send() {
    let text = comment.trimmingCharacters(in: .whitespacesAndNewlines)
    sending = true
    failed = false
    Task {
      defer { sending = false }
      do {
        summary = try await SceneReviews.client.submit(
          sceneID: sceneID, name: playerName, rating: rating, comment: text.isEmpty ? nil : text)
      } catch {
        failed = true
      }
    }
  }
}

/// ★を 1〜5 から選ぶ
struct StarPicker: View {
  @Binding var rating: Int

  var body: some View {
    HStack(spacing: 8) {
      ForEach(SceneReviews.ratings, id: \.self) { n in
        Button {
          rating = n
        } label: {
          Image(systemName: n <= rating ? "star.fill" : "star")
            .font(.system(size: 30, weight: .bold))
            .foregroundStyle(n <= rating ? Color(hex: 0xF5B800) : Theme.disabledBorder)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("★\(n)")
      }
    }
    .sensoryFeedback(.selection, trigger: rating)
  }
}
