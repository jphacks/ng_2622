import BackendAPI
import Foundation

/// 本物のバックエンドにつなぐ GameClient。部屋を作る・確かめるのと音声は HTTP（作った Client）、
/// 部屋に入ってからのやりとりは WebSocket（RoomSocket）で行う。届いたメッセージは LiveRoomTracker で GameEvent に直す。
///
/// 切断したら、welcome で受け取った playerId と token を付けた join でつなぎ直す。部屋は切断した人を消さずに
/// 待っていて、つなぎ直すと room・round・progress・results を送り直す（backend/src/durable-objects/room.ts）
final class LiveGameClient: GameClient {
  /// 自分の参加者の ID と合言葉。ホストは POST /rooms の応答で、参加者は welcome で受け取る
  private struct Credentials {
    let playerID: String
    let token: String
  }

  /// join の返事（welcome か error）を待つ時間
  static let joinTimeout: Duration = .seconds(10)
  /// つなぎ直す回数の上限。待つ時間は 0.5 秒から倍にしていき、8 秒で止める（合わせて 1 分ほど）
  static let maxReconnects = 10

  let events: AsyncStream<GameEvent>
  private let continuation: AsyncStream<GameEvent>.Continuation
  private let baseURL: URL
  private let api: Client

  private var tracker = LiveRoomTracker()
  private var player: PlayerProfile?
  private var roomID: String?
  private var credentials: Credentials?
  private var socket: RoomSocket?
  /// socket からの受信
  private var receiver: Task<Void, Never>?
  /// つなぎ直し。動いている間は 1 つだけ
  private var reconnector: Task<Void, Never>?
  /// join の返事を待っている
  private var pendingJoin: CheckedContinuation<Void, any Error>?
  private var joinTimer: Task<Void, Never>?
  /// leaveRoom を呼んだ。以後はつながない
  private var left = false

  init(baseURL: URL) {
    self.baseURL = baseURL
    api = APIClient.make(url: baseURL)
    (events, continuation) = AsyncStream.makeStream()
  }

  deinit {
    receiver?.cancel()
    reconnector?.cancel()
    joinTimer?.cancel()
    continuation.finish()
  }

  // MARK: - 部屋

  func createRoom(as player: PlayerProfile) async throws -> String {
    let room: Components.Schemas.CreateRoomResponse
    switch try await api.createRoom() {
    case .created(let created):
      room = try created.body.json
    case .serviceUnavailable:
      throw GameError.serverBusy
    case .undocumented(let status, _):
      liveLog.error("POST /rooms が \(status) を返しました")
      throw GameError.connectionFailed
    }
    // ホストは、受け取った ID と合言葉を付けた join で入る
    credentials = Credentials(playerID: room.playerId, token: room.token)
    try await enter(roomID: room.roomId, as: player)
    return room.roomId
  }

  func joinRoom(code: String, as player: PlayerProfile) async throws {
    // 無い部屋に WebSocket でつなぐと、切り替えに失敗するだけで理由が分からないので、先に確かめる。
    // 満員と始まっているかは、join の返事（error）で分かる
    switch try await api.getRoom(path: .init(roomId: code)) {
    case .ok:
      break
    case .notFound, .badRequest:
      throw GameError.roomNotFound
    case .undocumented(let status, _):
      liveLog.error("GET /rooms/\(code, privacy: .public) が \(status) を返しました")
      throw GameError.connectionFailed
    }
    try await enter(roomID: code, as: player)
  }

  func leaveRoom() {
    guard !left else { return }
    left = true
    reconnector?.cancel()
    reconnector = nil
    receiver?.cancel()
    receiver = nil
    resolveJoin(.failure(CancellationError()))
    if let socket {
      // 入れていたら leave を送って席を空ける（部屋の側も接続を閉じる）。送れなくても閉じる
      let joined = tracker.selfID != nil
      Task {
        if joined { try? await socket.send(.leave(.init(_type: .leave))) }
        socket.close()
      }
    }
    socket = nil
    continuation.finish()
  }

  /// WebSocket でつないで join する。失敗したら後始末をして throw する
  private func enter(roomID: String, as player: PlayerProfile) async throws {
    self.roomID = roomID
    self.player = player
    do {
      try await connect()
    } catch {
      receiver?.cancel()
      receiver = nil
      socket?.close()
      socket = nil
      throw error
    }
  }

  // MARK: - ラウンド

  func startRound(sceneID: String?) async throws {
    // sceneId が nil のときは JSON から省かれ、部屋の側が「おまかせ」で選ぶ
    try await send(.start(.init(_type: .start, sceneId: sceneID)))
  }

  /// 今の API の start には難易度が無く、作り置きの場面もまだバックエンドに無いので、「おまかせ」で始める。
  /// バックエンドの部屋が難易度で選ぶようになったら、ここで start に難易度を入れて送る（docs/design/architecture.md）
  func startRound(difficulty: SceneDifficulty) async throws {
    sceneLog.notice("Live の start は難易度を送れないので、おまかせで始めます（\(difficulty.rawValue, privacy: .public)）")
    try await startRound(sceneID: nil)
  }

  func finishSpeaking(audio: RecordedAudio?) async throws {
    guard let round = tracker.round else { return }
    let skip = Components.Schemas.ClientMessage.skip(.init(_type: .skip, round: round))
    guard let audio, let data = try? Data(contentsOf: audio.url) else {
      // 録れなかった。音声なしで終え、「採点できませんでした」になる
      try await send(skip)
      return
    }
    do {
      try await upload(data, round: round)
    } catch {
      // 送れなかった人がいるとラウンドが終わらないので、音声なしで終えておく
      liveLog.error("音声を送れませんでした: \(error, privacy: .public)")
      try await send(skip)
    }
  }

  func closeRound() async throws {
    try await send(.close(.init(_type: .close)))
  }

  func playAgain() async throws {
    try await send(.again(.init(_type: .again)))
  }

  /// POST /rooms/{roomId}/rounds/{round}/audio。X-Player-Id と Authorization: Bearer <合言葉> を付ける
  private func upload(_ data: Data, round: Int) async throws {
    guard let roomID, let credentials else { throw GameError.connectionFailed }
    let client = APIClient.make(url: baseURL, middlewares: [BearerToken(credentials.token)])
    let output = try await client.submitAudio(
      path: .init(roomId: roomID, round: String(round)),
      headers: .init(xPlayerId: credentials.playerID),
      body: .audioWav(HTTPBody(data)))
    switch output {
    case .accepted:
      return
    case .conflict(let conflict):
      // もう送った（already_submitted）か、締め切られた（not_playing）。どちらも skip は要らない
      let reason = (try? conflict.body.json).map { "\($0.error.code.rawValue) \($0.error.message)" } ?? ""
      liveLog.notice("音声は受け付けられませんでした: \(reason, privacy: .public)")
    default:
      throw GameError.rejected(code: "submit_audio", message: "\(output)")
    }
  }

  // MARK: - WebSocket

  /// RoomSocket でつなぎ、join を送って welcome を待つ。前の接続があれば閉じる
  private func connect() async throws {
    guard let roomID, let player, !left else { throw CancellationError() }
    receiver?.cancel()
    socket?.close()
    let socket = RoomSocket(baseURL: baseURL, roomID: roomID)
    self.socket = socket
    receiver = Task { [weak self] in
      while true {
        do {
          let message = try await socket.receive()
          guard let self, !Task.isCancelled else { return }
          if let message { handle(message) }
        } catch {
          guard !Task.isCancelled else { return }
          self?.disconnected(socket, error: error)
          return
        }
      }
    }

    let join = Components.Schemas.JoinMessage(
      _type: .join, name: player.name, color: Int(player.color), playerId: credentials?.playerID,
      token: credentials?.token)
    // welcome が send の終わりより先に届いても取りこぼさないよう、待ち受けてから送る
    try await withCheckedThrowingContinuation { (pending: CheckedContinuation<Void, any Error>) in
      pendingJoin = pending
      joinTimer = Task { [weak self] in
        try? await Task.sleep(for: Self.joinTimeout)
        guard !Task.isCancelled else { return }
        self?.resolveJoin(.failure(GameError.connectionFailed))
      }
      Task { [weak self] in
        do {
          try await socket.send(.join(join))
        } catch {
          self?.resolveJoin(.failure(GameError.connectionFailed))
        }
      }
    }
  }

  private func resolveJoin(_ result: Result<Void, any Error>) {
    joinTimer?.cancel()
    joinTimer = nil
    guard let pending = pendingJoin else { return }
    pendingJoin = nil
    pending.resume(with: result)
  }

  private func send(_ message: Components.Schemas.ClientMessage) async throws {
    guard let socket else { throw GameError.connectionFailed }
    try await socket.send(message)
  }

  private func handle(_ message: Components.Schemas.ServerMessage) {
    for update in tracker.apply(message) {
      switch update {
      case .welcome(let playerID, let token, _):
        credentials = Credentials(playerID: playerID, token: token)
        resolveJoin(.success(()))
      case .event(let event):
        continuation.yield(event)
      case .error(let code, let message):
        if pendingJoin != nil {
          resolveJoin(.failure(GameError(code: code, message: message)))
        } else {
          // 押した操作が受け付けられなかった（ホストでない・もう始まっているなど）。画面はそのままにする
          liveLog.notice("部屋が受け付けませんでした: \(code.rawValue, privacy: .public) \(message, privacy: .public)")
        }
      }
    }
  }

  /// 接続が切れた。join を待っていたら失敗にし、入れていたらつなぎ直す
  private func disconnected(_ closed: RoomSocket, error: any Error) {
    guard closed === socket, !left else { return }
    socket = nil
    receiver = nil
    liveLog.notice("切断しました（\(closed.closeCode)）: \(error, privacy: .public)")
    if pendingJoin != nil {
      resolveJoin(.failure(GameError.connectionFailed))
      return
    }
    // ほかの接続（同じ ID と合言葉）に置き換えられた。取り合いにならないよう、つなぎ直さない
    guard closed.closeCode != RoomSocket.replacedCloseCode else { return }
    reconnect()
  }

  private func reconnect() {
    guard reconnector == nil, credentials != nil else { return }
    reconnector = Task { [weak self] in
      for attempt in 0..<Self.maxReconnects {
        try? await Task.sleep(for: .milliseconds(min(500 << attempt, 8000)))
        guard let self, !Task.isCancelled, !left else { return }
        do {
          try await connect()
          reconnector = nil
          return
        } catch GameError.rejected(let code, _) where code == Components.Schemas.ErrorCode.unauthorized.rawValue {
          // 合言葉が通らない（部屋から外された）。何度やっても入れない
          break
        } catch {
          liveLog.notice("つなぎ直せませんでした（\(attempt + 1) 回目）: \(error, privacy: .public)")
        }
      }
      liveLog.error("つなぎ直すのをあきらめました")
      self?.reconnector = nil
    }
  }
}

#if DEBUG
  extension LiveGameClient {
    /// テスト用。いまの接続を部屋に知らせずに切り、つなぎ直しを始めさせる
    func dropConnectionForTesting() {
      socket?.close()
    }
  }
#endif

extension GameError {
  /// WebSocket の error を、画面が見分ける理由に直す
  init(code: Components.Schemas.ErrorCode, message: String) {
    switch code {
    case .roomNotFound: self = .roomNotFound
    case .roomFull: self = .roomFull
    case .notInLobby: self = .alreadyStarted
    case .serverBusy: self = .serverBusy
    default: self = .rejected(code: code.rawValue, message: message)
    }
  }
}
