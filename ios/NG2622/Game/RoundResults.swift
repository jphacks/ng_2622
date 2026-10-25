import Foundation

/// 1 ラウンドの結果。全員の採点がそろうか、ホストが締め切ると届く。
/// 結果の画面（結果発表・みんなの描写・振り返り）はこれだけを見る。
struct RoundResults: Sendable, Equatable {
  /// 遊んだシーンの ID（シーンの評価に使う）
  let sceneID: String
  /// 遊んだシーンの名前（例: 公園）
  let sceneName: String
  /// 順位の順（1 位が先頭）。採点できなかった人は最後に並ぶ
  let players: [PlayerResult]
  /// 自分の振り返り。自分が採点できなかったときは nil
  let myReview: Review?

  /// 自分の講評（バックエンドの Feedback）。次に伸ばすのは一つだけ
  struct Review: Sendable, Equatable {
    /// できたこと。quote は自分の発話からの引用（無ければ空）
    let strengthQuote: String
    let strength: String
    /// 次に伸ばす一つ
    let nextStep: String
    /// 足すと合計点が何点伸びるか（内容の要素のときだけ）
    let nextStepGain: Int?
    /// 「次はこれ」に付ける「+N 点」。gain が無い（作り置きの場面の採点・内容でない要素）ときは出さない
    var nextStepBadge: String? { nextStepGain.map { "+\($0) 点" } }
    /// 自分の一文の言い換え。直す所が無ければ nil
    let rewrite: Rewrite?
    /// 話し方のコツ
    let speechTip: String

    struct Rewrite: Sendable, Equatable {
      let before: String
      let after: String
      let reason: String
    }
  }
}

struct PlayerResult: Identifiable, Sendable, Equatable {
  let id: String
  let name: String
  /// アバターの色（0xRRGGBB）。Participant.color と同じ
  let color: UInt32
  let isSelf: Bool
  /// 点数。採点できなかった人（締め切られた・切断した）は nil
  let score: Score?
  /// 文字起こし。採点できなかった人は空
  let transcript: String
  /// 講評の一言（みんなの描写に出す）
  let comment: String

  /// 内容・表現・話し方（各 0〜100）と、重み付きの合計（0〜100）。重みはバックエンドが持つ
  struct Score: Sendable, Equatable {
    let content: Int
    let expression: Int
    let speaking: Int
    let total: Int
  }
}
