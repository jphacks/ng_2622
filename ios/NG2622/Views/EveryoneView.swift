import SwiftUI

struct EveryoneView: View {
    private let ranked = MockData.ranked

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("シーン: \(MockData.sceneName)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)

                ForEach(ranked) { player in
                    DescriptionCard(player: player)
                }
            }
            .padding()
        }
        .navigationTitle("みんなの描写")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct DescriptionCard: View {
    let player: Player

    private var isMe: Bool {
        player.name == MockData.me
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(player.name)
                    .font(.headline)
                if isMe {
                    Text("あなた")
                        .font(.caption.bold())
                        .foregroundStyle(Color.accentColor)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.accentColor.opacity(0.12), in: Capsule())
                }
                Spacer()
                Text("\(player.displayScore) 点")
                    .font(.headline)
                    .monospacedDigit()
            }

            Text(player.transcript)
                .font(.body)

            Text(player.comment)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(.secondarySystemBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(isMe ? Color.accentColor : Color.clear, lineWidth: 1.5)
        )
    }
}
