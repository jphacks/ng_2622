import Foundation

// 仮のデータ。採点の重みは docs/design/screen-flow.md の決定（内容 50%・表現 25%・話し方 25%）
struct Scores: Equatable {
    let content: Int
    let expression: Int
    let speaking: Int

    var total: Double {
        Double(content) * 0.5 + Double(expression) * 0.25 + Double(speaking) * 0.25
    }
}

struct Player: Identifiable, Equatable {
    let name: String
    let scores: Scores
    let transcript: String
    let comment: String

    var id: String { name }
    var displayScore: Int { Int(scores.total.rounded()) }
}

// 振り返りの講評と模範表現（仮）
struct Review: Equatable {
    let comment: String
    let modelSentence: String
    let modelSentenceJa: String
}

enum MockData {
    static let sceneName = "公園のベンチと木（仮）"
    static let me = "ゆい"

    static let players: [Player] = [
        Player(
            name: "あかり",
            scores: Scores(content: 84, expression: 78, speaking: 80),
            transcript: "There is a wooden bench under a big tree. A dog is sitting next to the bench, and a kid is throwing a ball.",
            comment: "場面の要素を幅広く拾えている。"
        ),
        Player(
            name: "けんた",
            scores: Scores(content: 92, expression: 88, speaking: 85),
            transcript: "A brown dog is waiting beside an old bench, under a tree with green leaves. Sunlight is coming through the branches.",
            comment: "木と光まで描写できていて、場面がよく伝わる。"
        ),
        Player(
            name: me,
            scores: Scores(content: 76, expression: 70, speaking: 88),
            transcript: "There is a bench in the park. There is a tree. A dog is near the bench.",
            comment: "話し方は安定している。要素の説明をもう少し具体的に。"
        ),
        Player(
            name: "ハルト",
            scores: Scores(content: 88, expression: 82, speaking: 74),
            transcript: "The park has a bench and a big tree, and a dog sits there looking at the children playing nearby.",
            comment: "場面の関係が描けている。発音に少し揺れがある。"
        ),
        Player(
            name: "みさき",
            scores: Scores(content: 65, expression: 72, speaking: 79),
            transcript: "Bench, tree, and, um, dog in the park.",
            comment: "要素は挙がっているが、文になっていない。"
        ),
    ]

    // 点数の高い順（順位）
    static var ranked: [Player] {
        players.sorted { $0.scores.total > $1.scores.total }
    }

    static let review = Review(
        comment: "場面の要素（ベンチ・木・犬）は押さえています。「犬がどこにいるか」を文で示すと、内容の点がさらに上がります。",
        modelSentence: "A dog is resting on the bench under the big tree.",
        modelSentenceJa: "大きな木の下のベンチで、犬が休んでいます。"
    )
}
