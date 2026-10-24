import Foundation

/// プレイの画面がバックエンドとやりとりする口。
/// いまは仮のデータを返す MockGameClient だけ。本物の API（WebSocket）につなぐ実装は後の PR で足す。
protocol GameClient: AnyObject {
  /// 自分がホストか（ホストだけが締め切れる）
  var isHost: Bool { get }
  /// バックエンドから届くできごと。1 か所だけで読む
  var events: AsyncStream<GameEvent> { get }

  /// ホストがラウンドを始める
  func startRound() async throws
  /// 自分が話し終えた（後の PR で録音した音声を載せる）
  func finishSpeaking() async throws
  /// ホストが締め切って発表する
  func closeRound() async throws
}

enum GameEvent: Sendable {
  /// ラウンドが始まった。全員の端末で同じ時刻に回転を始める
  case roundStarted(RoundInfo)
  /// 参加者とその状態が変わった
  case participantsChanged([Participant])
  /// ラウンドが終わった（全員の採点がそろった／ホストが締め切った）
  case roundFinished(RoundFinishReason)
}

struct RoundInfo: Sendable, Equatable {
  /// 出す 3D シーンの ID（"park" / "classroom" / "station" / "custom"）
  let sceneID: String
  /// AI が動的に生成した USDZ の URL（指定されていればバンドルより優先して読み込む）
  var sceneURL: URL? = nil
  /// 回転を始める時刻
  let startsAt: Date
}

enum RoundFinishReason: Sendable {
  case allGraded
  case closedByHost
}

struct Participant: Identifiable, Sendable, Equatable {
  enum Status: Sendable, Equatable {
    case talking
    case grading
    case done
    case offline
  }

  let id: String
  let name: String
  /// アバターの色（0xRRGGBB）
  let color: UInt32
  let isSelf: Bool
  var status: Status
}

/// ラウンドの時間の決まり
enum RoundTiming {
  /// 回転中（1 周）
  static let intro: TimeInterval = 3
  /// 録音の最長
  static let recording: TimeInterval = 20
  /// 待機に入ってから締め切りを押せない時間
  static let closeLock: TimeInterval = 2
}
