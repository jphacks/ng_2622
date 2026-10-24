import SwiftUI

struct RankingView: View {
    private let ranked = MockData.ranked

    // 下の順位から何行開いたか（0 から始まり、全行数で発表が終わる）
    @State private var revealedCount = 0
    @State private var revealTask: Task<Void, Never>?

    private var isFinished: Bool {
        revealedCount >= ranked.count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("シーン: \(MockData.sceneName)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)

                ForEach(Array(ranked.enumerated()), id: \.element.id) { index, player in
                    RankRow(
                        place: index + 1,
                        player: player,
                        isOpen: index >= ranked.count - revealedCount,
                        isWinner: index == 0
                    )
                }

                if isFinished {
                    winnerBanner
                }

                actions
                    .padding(.top, 12)
            }
            .padding()
        }
        .navigationTitle("結果発表")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: startReveal)
    }

    private var winnerBanner: some View {
        VStack(spacing: 4) {
            Text("優勝 \(ranked[0].name)")
                .font(.headline)
            Text("おめでとう")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
        .transition(.opacity)
    }

    @ViewBuilder
    private var actions: some View {
        if isFinished {
            NavigationLink {
                EveryoneView()
            } label: {
                Text("みんなの描写を見る")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            NavigationLink {
                ReviewView()
            } label: {
                Text("自分の結果を振り返る")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        } else {
            Button("発表をとばす") {
                skipReveal()
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .frame(maxWidth: .infinity)
        }
    }

    // 最下位から約 0.9 秒ごとに 1 行開く。戻ってきたときは開いたままにする
    private func startReveal() {
        guard revealedCount == 0, revealTask == nil else { return }

        revealTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            for _ in ranked {
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.45)) {
                    revealedCount += 1
                }
                try? await Task.sleep(for: .milliseconds(900))
            }
        }
    }

    private func skipReveal() {
        revealTask?.cancel()
        withAnimation(.easeOut(duration: 0.3)) {
            revealedCount = ranked.count
        }
    }
}

private struct RankRow: View {
    let place: Int
    let player: Player
    let isOpen: Bool
    let isWinner: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text("\(place)")
                .font(.headline)
                .foregroundStyle(isWinner && isOpen ? Color.orange : Color.secondary)
                .frame(width: 28)

            ZStack(alignment: .leading) {
                // 閉じている行
                Text("？？？")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .opacity(isOpen ? 0 : 1)

                // 開いた行。下から上へ、回りながら現れる
                HStack {
                    Text(player.name)
                        .font(.headline)
                    Spacer()
                    Text("\(player.displayScore) 点")
                        .font(.title3.bold())
                        .monospacedDigit()
                }
                .rotation3DEffect(.degrees(isOpen ? 0 : -90), axis: (x: 1, y: 0, z: 0))
                .opacity(isOpen ? 1 : 0)
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(.secondarySystemBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(isWinner && isOpen ? Color.orange : Color.clear, lineWidth: 1.5)
        )
    }
}
