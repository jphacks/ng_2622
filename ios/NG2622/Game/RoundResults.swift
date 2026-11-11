import Foundation

/// 1 ラウンドの結果。全員の採点がそろうか、ホストが締め切ると届く。
/// 結果の画面（結果発表・みんなの描写・振り返り）はこれだけを見る
struct RoundResults: Sendable, Equatable {
  /// 遊んだシーンの ID（シーンの評価と、振り返りの見本の答えに使う）
  let sceneID: String
  /// 遊んだシーンの名前（例: 公園）
  let sceneName: String
  /// 順位の順（1 位が先頭）。採点できなかった人は最後に並ぶ
  let players: [PlayerResult]
  /// 自分の振り返り。自分が採点できなかったときは nil
  let myReview: Review?
  /// 部屋のコード。部屋がその場で AI で作った場面の配置を取るときに付ける（みんなの描写で場面を出す）。Mock は nil
  var room: String? = nil

  /// 合計の点の重み（バックエンドの採点と同じ。結果の画面に小さく出すだけで、計算には使わない）
  enum Weights {
    static let content = 50
    static let expression = 25
    static let speech = 25
    /// 「内容 50% ・ 表現 25% ・ 話し方 25%」
    static let caption = "内容 \(content)% ・ 表現 \(expression)% ・ 話し方 \(speech)%"
  }

  /// 自分の講評（バックエンドの Feedback）。次に伸ばすのは一つだけ
  struct Review: Sendable, Equatable {
    /// 次に伸ばす一つ
    let nextStep: NextStep
    /// 自分の一文の言い換え。直す所が無ければ nil
    let rewrite: Rewrite?
    /// 話し方のコツ
    let speechTip: SpeechTip

    struct NextStep: Sendable, Equatable {
      enum Kind: String, Sendable { case content, expression, speech }
      let kind: Kind
      let text: String
      /// 勧めるチェックリストの項目の id。全部言えた・短すぎる発話・内容でないときは nil
      let item: String?
      /// その項目を言えたら合計の点が何点伸びるか。item が無ければ nil
      let gain: Int?

      /// 「次の一つ」に付ける「+N 点」。gain が無い（または 0 以下の）ときは出さない
      var badge: String? { gain.flatMap { $0 > 0 ? "+\($0) 点" : nil } }
    }

    struct Rewrite: Sendable, Equatable {
      let before: String
      let after: String
      let reason: String
    }

    struct SpeechTip: Sendable, Equatable {
      /// 発音の正確さ・流ちょうさ・抑揚のうち、いちばん低かったもの
      enum Aspect: String, Sendable {
        case accuracy, fluency, prosody

        var label: String {
          switch self {
          case .accuracy: "正確さ"
          case .fluency: "流ちょうさ"
          case .prosody: "抑揚"
          }
        }
      }
      let aspect: Aspect
      let text: String
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
  /// 内容の点の内訳。採点できなかった人は nil
  let content: ContentBreakdown?

  /// 内容・表現・話し方（各 0〜100）と、重み付きの合計（0〜100）。重みはバックエンドが持つ
  struct Score: Sendable, Equatable {
    let content: Int
    let expression: Int
    let speaking: Int
    let total: Int
  }
}

/// 内容の点の内訳（バックエンドの PlayerContent）。描写の一覧・項目ごとの達成・言えたと正しさ
struct ContentBreakdown: Sendable, Equatable {
  /// 話した順の描写
  let claims: [Claim]
  /// チェックリストの順の項目ごとの達成
  let items: [Item]
  /// 一覧に無い正しい描写のおまけの数（0〜2）
  let others: Int
  /// 言えた重みと満点の重み（0.5 刻み）
  let recall: Recall
  /// 正しい描写の数と、言った描写の数
  let precision: Precision

  struct Recall: Sendable, Equatable {
    let earned: Double
    let max: Double
  }

  struct Precision: Sendable, Equatable {
    let correct: Int
    let said: Int
  }

  /// 項目に当たったときの達成
  enum Level: String, Sendable {
    case full, partial, none
  }

  /// 発話を事実 1 つずつに分けた描写と、その判定
  struct Claim: Sendable, Equatable {
    enum Verdict: String, Sendable {
      /// 場面と合う
      case correct
      /// 場面と矛盾する
      case contradiction
      /// 場面に無い物や人
      case absent
      /// 場面と関係が無い
      case offtopic
    }

    /// 文字起こしのとおりの引用
    let quote: String
    let verdict: Verdict
    /// 当たった項目の id。correct で nil ならおまけ（一覧に無い正しい描写）
    let item: String?
    /// 項目に当たったときの達成（full か partial）。item が nil なら nil
    let level: Level?
    /// 間違いの理由（日本語）。correct のときは nil
    let note: String?

    /// 場面と合わない描写（矛盾・場面に無い・関係が無い）
    var isMismatch: Bool { verdict != .correct }
  }

  /// チェックリストの項目ごとの達成
  struct Item: Identifiable, Sendable, Equatable {
    let id: String
    let kind: ChecklistKind
    let label: String
    let level: Level
  }

  /// 言えた項目の数
  var fullCount: Int { items.filter { $0.level == .full }.count }
  /// 一部だけ言えた項目の数
  var partialCount: Int { items.filter { $0.level == .partial }.count }
  /// 場面と合わない描写の数
  var mismatchCount: Int { claims.filter(\.isMismatch).count }

  /// 「言えた 6.5 / 10」の数（整数なら小数点を付けない）
  static func number(_ value: Double) -> String {
    value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
  }
}
