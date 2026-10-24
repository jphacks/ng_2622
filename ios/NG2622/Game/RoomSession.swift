import Foundation
import Observation

/// 部屋に入ってから出るまでの状態。GameClient のできごとを受けて、どの画面を出すかを決める
@Observable
final class RoomSession {
  enum Phase: Equatable {
    /// 待合
    case lobby
    /// 回転中・録音中（1 つの画面）
    case playing(RoundInfo)
    /// 話し終えて、ほかの人を待っている
    case waiting(enteredAt: Date)
    /// ラウンドが終わり、結果がそろった
    case results(RoundResults)
  }

  let me: PlayerProfile
  private(set) var isHost = false
  private(set) var phase: Phase = .lobby
  /// 部屋のコード（4 桁）。入るまでは nil
  private(set) var code: String?
  /// 参加者と状態。待合では接続の状態、ラウンド中は進み具合
  private(set) var participants: [Participant] = []
  /// 自分の声の録音。ラウンドが始まると用意し、録音中の画面で録り始める
  let recorder = VoiceRecorder()

  /// 完了していない人（話している・採点中・切断中）の数
  var remainingCount: Int {
    participants.filter { $0.status != .done }.count
  }

  var isRoundOver: Bool {
    if case .results = phase { true } else { false }
  }

  private let client: any GameClient
  private var listener: Task<Void, Never>?

  init(client: any GameClient, me: PlayerProfile) {
    self.client = client
    self.me = me
  }

  /// 部屋を作り、ホストとして入る
  func create() async throws {
    listen()
    code = try await client.createRoom(as: me)
    isHost = true
  }

  /// コードの部屋に入る
  func join(code: String) async throws {
    listen()
    try await client.joinRoom(code: code, as: me)
    self.code = code
    isHost = false
  }

  /// 部屋から抜ける
  func leave() {
    listener?.cancel()
    recorder.discard()
    client.leaveRoom()
  }

  /// ホストがラウンドを始める。sceneID が nil なら「おまかせ」（部屋の側がランダムに選ぶ）。
  /// 選んだシーンは参加者には前もって伝えず、ラウンドが始まったときに round で届く
  func start(sceneID: String?) {
    guard isHost, phase == .lobby else { return }
    Task { try? await client.startRound(sceneID: sceneID) }
  }

  /// 「話し終えた」か、20 秒たった
  func finishSpeaking() {
    guard case .playing = phase else { return }
    phase = .waiting(enteredAt: Date())
    let audio = recorder.stop()
    Task { try? await client.finishSpeaking(audio: audio) }
  }

  /// ホストが締め切る
  func close() {
    Task { try? await client.closeRound() }
  }

  /// ホストの「同じ顔ぶれでもう一度」
  func again() {
    guard isHost else { return }
    Task { try? await client.playAgain() }
  }

  private func listen() {
    guard listener == nil else { return }
    let events = client.events
    listener = Task { [weak self] in
      for await event in events {
        self?.handle(event)
      }
    }
  }

  private func handle(_ event: GameEvent) {
    switch event {
    case .room(let room):
      code = room.code
      participants = room.members
    case .roundStarted(let info):
      // 前のラウンドの録音は消す
      recorder.prepare()
      phase = .playing(info)
    case .participantsChanged(let list):
      participants = list
    case .results(let results):
      phase = .results(results)
    case .returnedToLobby(let room):
      code = room.code
      participants = room.members
      phase = .lobby
    }
  }
}
