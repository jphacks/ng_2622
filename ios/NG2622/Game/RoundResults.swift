import Foundation

/// 1 ラウンドの結果。全員の採点がそろうか、ホストが締め切ると届く。
/// 結果の画面（結果発表・みんなの描写・振り返り）はこれだけを見る。
struct RoundResults: Sendable, Equatable {
  /// 遊んだシーンの名前（例: 公園）
  let sceneName: String
  /// 順位の順（1 位が先頭）。採点できなかった人は最後に並ぶ
  let players: [PlayerResult]
  /// 自分の振り返り。自分が採点できなかったときは nil
  let myReview: Review?

  /// 自分の講評と模範表現
  struct Review: Sendable, Equatable {
    /// 講評（Claude が書く）
    let comment: String
    /// 模範表現（英文 1 つ）
    let modelSentence: String
    /// 模範表現の日本語訳
    let modelSentenceJa: String
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
