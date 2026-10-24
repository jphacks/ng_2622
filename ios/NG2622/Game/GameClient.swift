import Foundation

/// 画面がバックエンドとやりとりする口。docs/design/architecture.md の WebSocket のメッセージに合わせる。
/// いまは仮のデータを返す MockGameClient だけ。本物の API（WebSocket）につなぐ実装は後の PR で足す。
protocol GameClient: AnyObject {
  /// バックエンドから届くできごと。1 か所だけで読む
  var events: AsyncStream<GameEvent> { get }

  /// 部屋を作り、ホストとして入る（POST /rooms → join）。部屋のコードを返す
  func createRoom(as player: PlayerProfile) async throws -> String
  /// コードの部屋に入る（join）。部屋が無いときは GameError.roomNotFound
  func joinRoom(code: String, as player: PlayerProfile) async throws
  /// 部屋から抜ける。以後 events は届かない
  func leaveRoom()

  /// ホストがラウンドを始める（start）。sceneID が nil なら「おまかせ」で、部屋の側がランダムに選ぶ
  func startRound(sceneID: String?) async throws
  /// 自分が話し終えた。録音した音声を送る（POST /rooms/:id/rounds/:n/audio）。録れなかったときは nil
  func finishSpeaking(audio: RecordedAudio?) async throws
  /// ホストが締め切って発表する（close）
  func closeRound() async throws
  /// ホストが同じ顔ぶれでもう一度遊ぶ（again）
  func playAgain() async throws
}

enum GameEvent: Sendable {
  /// 部屋の参加者と接続の状態（room）
  case room(RoomState)
  /// ラウンドが始まった。全員の端末で同じ時刻に回転を始める（round）
  case roundStarted(RoundInfo)
  /// ラウンド中の各自の状態が変わった（progress）
  case participantsChanged([Participant])
  /// ラウンドが終わり、結果がそろった（results）。全員の採点がそろったか、ホストが締め切った
  case results(RoundResults)
  /// ホストが「もう一度」を選び、待合に戻った（again を受けた部屋が送る room）
  case returnedToLobby(RoomState)
}

enum GameError: Error {
  /// そのコードの部屋が無い
  case roomNotFound
}

/// 部屋の状態
struct RoomState: Sendable, Equatable {
  /// 部屋のコード（4 桁）
  let code: String
  /// 入った順。状態は待合では connected か offline
  let members: [Participant]
}

/// 1 部屋の人数の上限（architecture.md の初期値）
enum RoomLimit {
  static let members = 8
}

struct RoundInfo: Sendable, Equatable {
  /// 出す 3D シーンの ID
  let sceneID: String
  /// 回転を始める時刻
  let startsAt: Date
}

struct Participant: Identifiable, Sendable, Equatable {
  enum Status: Sendable, Equatable {
    /// 待合にいる
    case connected
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
  let isHost: Bool
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
