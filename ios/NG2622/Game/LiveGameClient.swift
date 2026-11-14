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
  /// 音声を送る通信を打ち切るまでの時間（秒）。サーバーは録音の終わりから RoundTiming.audioGrace（15 秒）しか
  /// 音声を待たず、その後に届いた音声は deadline_passed で断る。URLSession の既定（データが途切れて 60 秒・
  /// 全体は 7 日）では、締め切りを過ぎても送り続けてしまう。送り始めるのは録音が始まった後なので、
  /// 録音の最長と猶予を足した長さ（35 秒）たてば必ず締め切りを過ぎていて、待っても採点されない。
  /// 猶予の 15 秒だけにすると、早く話し終えた人の、締め切りに間に合う音声まで打ち切りうる。打ち切ったら skip を送る。
  /// 打ち切る前でも、待つ画面はサーバーが締め切って送る結果で終わる（ずっと待つことはない）
  static let uploadTimeout: TimeInterval = RoundTiming.recording + RoundTiming.audioGrace
  /// 音声を送る URLSession（uploadTimeout で打ち切る）
  private static let uploadSession: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = uploadTimeout
    configuration.timeoutIntervalForResource = uploadTimeout
    return URLSession(configuration: configuration)
  }()
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

  /// join の前に、部屋があるか・満員でないか・待合かを確かめる（GET /rooms/:id）。join の一部で、画面からは呼ばない
  private func checkRoom(code: String) async throws {
    let room: Components.Schemas.RoomSummary
    let response: Operations.GetRoom.Output
    do {
      response = try await api.getRoom(path: .init(roomId: code))
    } catch {
      // つながらない・返事が読めない（オフラインなど）。部屋が無いのとは分ける
      liveLog.error("GET /rooms/\(code, privacy: .public) に失敗しました: \(error, privacy: .public)")
      throw GameError.connectionFailed
    }
    switch response {
    case .ok(let ok):
      room = try ok.body.json
    case .notFound, .badRequest:
      throw GameError.roomNotFound
    case .undocumented(let status, _):
      liveLog.error("GET /rooms/\(code, privacy: .public) が \(status) を返しました")
      throw GameError.connectionFailed
    }
    if room.phase != .lobby { throw GameError.alreadyStarted }
    if room.playerCount >= room.maxPlayers { throw GameError.roomFull }
  }

  func joinRoom(code: String, as player: PlayerProfile) async throws {
    // 無い部屋に WebSocket でつなぐと、切り替えに失敗するだけで理由が分からないので、先に確かめる。
    // 確かめたあとで満員になった・始まったときは、join の返事（error）で分かる
    try await checkRoom(code: code)
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
    // 初回は文字起こしの音声モデルのダウンロードが要るので、話す前に始めておく
    Task { await DeviceTranscriber.prepare() }
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

  /// 難易度だけを送り、場面は部屋が作り置きの中から選ぶ（round の sceneId で届く）。sceneId は一緒に送らない
  func startRound(difficulty: SceneDifficulty) async throws {
    try await send(Self.startMessage(difficulty: difficulty))
  }

  /// 難易度の start（{ type: "start", difficulty }）
  static func startMessage(difficulty: SceneDifficulty) -> Components.Schemas.ClientMessage {
    .start(.init(_type: .start, difficulty: Components.Schemas.Difficulty(rawValue: difficulty.rawValue)))
  }

  func finishSpeaking(audio: RecordedAudio?) async throws {
    guard let round = tracker.round else { return }
    let skip = Components.Schemas.ClientMessage.skip(.init(_type: .skip, round: round))
    guard let audio, let data = try? Data(contentsOf: audio.url) else {
      // 録れなかった。音声なしで終え、「採点できませんでした」になる
      try await send(skip)
      return
    }
    // 端末での文字起こしも一緒に送る。できなければ nil で、バックエンドが Azure の文字起こしを使う。
    // 文字起こしが終わらなくても DeviceTranscriber.timeout（5 秒）で戻るので、サーバーの音声の締め切り
    // （録音の終わりから RoundTiming.audioGrace）より前に送り始められる
    let transcript = await DeviceTranscriber.transcribe(audio.url)
    do {
      try await upload(data, transcript: transcript, round: round)
    } catch {
      // 送れなかった人がいるとラウンドが終わらないので、音声なしで終えておく
      liveLog.error("音声を送れませんでした: \(error, privacy: .public)")
      try await send(skip)
    }
  }

  func playAgain() async throws {
    try await send(.again(.init(_type: .again)))
  }

  /// POST /rooms/{roomId}/rounds/{round}/audio。X-Player-Id と Authorization: Bearer <合言葉> を付ける。
  /// 文字起こしは X-Transcript に載せる（作った Client が URL エンコードする）
  private func upload(_ data: Data, transcript: String?, round: Int) async throws {
    guard let roomID, let credentials else { throw GameError.connectionFailed }
    let client = APIClient.make(url: baseURL, session: Self.uploadSession, middlewares: [BearerToken(credentials.token)])
    let output = try await client.submitAudio(
      path: .init(roomId: roomID, round: String(round)),
      headers: .init(xPlayerId: credentials.playerID, xTranscript: transcript),
      body: .audioWav(HTTPBody(data)))
    switch output {
    case .accepted:
      return
    case .conflict(let conflict):
      // もう送った（already_submitted）か、締め切りを過ぎた（deadline_passed）。どちらも skip は要らない（送っても断られる）
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
          // 押した操作が受け付けられなかった（ホストでない・もう始まっている・場面が無いなど）。画面に知らせる
          // （ふつうは画面をそのままにし、苦手の場面のスタートだけはふつうの待合に戻す。RoomSession）
          liveLog.notice("部屋が受け付けませんでした: \(code.rawValue, privacy: .public) \(message, privacy: .public)")
          continuation.yield(.rejected(code: code.rawValue, message: message))
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
