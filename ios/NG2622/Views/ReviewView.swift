import SwiftUI

struct ReviewView: View {
    private var me: Player? {
        MockData.players.first { $0.name == MockData.me }
    }

    private var rank: Int? {
        MockData.ranked.firstIndex { $0.name == MockData.me }.map { $0 + 1 }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let me {
                    totalCard(for: me)
                    scoreBars(for: me)
                }

                card(title: "講評（Claude）") {
                    Text(MockData.review.comment)
                }

                card(title: "模範表現") {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(MockData.review.modelSentence)
                            .font(.body.monospaced())
                        Text(MockData.review.modelSentenceJa)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding()
        }
        .navigationTitle("振り返り")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func totalCard(for player: Player) -> some View {
        VStack(spacing: 4) {
            Text("合計点")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text("\(player.displayScore) 点")
                .font(.system(size: 40, weight: .bold))
                .monospacedDigit()
            if let rank {
                Text("\(rank) 位 / \(MockData.ranked.count) 人")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(.secondarySystemBackground))
        )
    }

    private func scoreBars(for player: Player) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            scoreBar(label: "内容", weight: "50%", value: player.scores.content)
            scoreBar(label: "表現", weight: "25%", value: player.scores.expression)
            scoreBar(label: "話し方", weight: "25%", value: player.scores.speaking)
        }
    }

    private func scoreBar(label: String, weight: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                Text(weight)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(value) 点")
                    .monospacedDigit()
            }
            ProgressView(value: Double(value), total: 100)
        }
    }

    private func card<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.footnote.bold())
                .foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(.secondarySystemBackground))
        )
    }
}
