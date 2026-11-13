import BackendAPI
import CryptoKit
import Foundation
import Observation
import OpenAPIURLSession

/// サーバー（GET /title）が「今出す」と言っているタイトル画面の 3D
struct RemoteTitle: Equatable {
  let id: String
  let caption: String
  /// 3D（USDZ）の場所
  let model: URL
  /// 3D の中身の sha256（16 進数の小文字）
  let sha256: String
  /// 出す期間の終わり
  let expiresAt: Date
}

/// GET /title と 3D のダウンロード。テストでは差し替える
protocol TitleSource {
  /// 今出すタイトル。出すものが無ければ nil。つながらない・読めないときは投げる
  func latest() async throws -> RemoteTitle?
  /// url の中身を取り、destination に置く
  func download(_ url: URL, to destination: URL) async throws
}

/// 端末に取っておいたタイトル画面の 3D と、その情報
struct StoredTitle: Codable, Equatable {
  let id: String
  let caption: String
  let sha256: String
  let expiresAt: Date
  /// 置き場（TitleStore の directory）の中のファイルの名前
  let file: String
}

/// サーバーが期間つきで決めるタイトル画面の 3D を、端末に取っておく所
/// （docs/adr/20261113-decide-title-diorama-on-server-with-expiry.md）。
///
/// - 起動時と前に戻ったときに refresh を呼ぶ（Live だけ）。毎回 GET /title で今の id を確かめ、覚えている id と違えば
///   3D を取り直し、sha256 が合えば置き場に置いて覚える。合わなければ捨てる。null なら覚えているものを消す。
/// - 期限（expiresAt）を過ぎたら、current は nil を返し（端末の時刻で見る）、次の refresh で、サーバーにつながらなくても消す。
/// - 置き場は Caches。取り直せるものなので（Apple の指針）、OS に消されても次の refresh で取り直す。部品のキャッシュ
///   （PartLibrary）も Caches に置いている。
/// - 覚えているものが替わる（取り終えた・消した）たびに revision が変わる。ホームはそれを見て、見ている途中でも入れ替える
///   （2026-11-13 に、次に開いたときから出す形から変えた。docs/adr/20261113-swap-title-diorama-in-place-and-label-as-pr.md）。
/// - 送るものは無い（GET /title に本文もクエリも付けない）。
@Observable
final class TitleStore {
  static let shared = TitleStore(
    directory: URL.cachesDirectory.appending(path: "title", directoryHint: .isDirectory),
    source: AppConfig.current.mode == .live ? AppConfig.current.backendURL.map { LiveTitleSource(baseURL: $0) } : nil)

  /// 取る 3D の大きさの上限（今の会場は 2.4 MB）。LiveTitleSource は取る途中でも見て、超えたら止める。
  /// ここでは、取ったあとのファイルでも見る（同梱から写すときと、差し替えた通信のため）
  nonisolated static let maxBytes = 25 * 1024 * 1024

  /// 覚えているものが替わるたびに 1 つ増える（書いた・消した）。ホームはこれを見て、出す 3D を決め直す
  private(set) var revision = 0

  @ObservationIgnored private let directory: URL
  @ObservationIgnored private let source: (any TitleSource)?
  @ObservationIgnored private let bundle: Bundle
  @ObservationIgnored private var refreshing: Task<Void, Never>?
  /// 同梱の 3D の sha256（ファイルの場所ごと）。同じ中身なら通信せずに写す
  @ObservationIgnored private var bundledDigests: [URL: String]?

  init(directory: URL, source: (any TitleSource)?, bundle: Bundle = .main) {
    self.directory = directory
    self.source = source
    self.bundle = bundle
  }

  private var metadataURL: URL { directory.appending(path: "current.json") }

  /// 今出してよいもの。期限を過ぎている・ファイルが無いときは nil（ここでは消さない。ホームの描画の途中で呼ぶため。
  /// 消すのは次の refresh）
  func current(now: Date = Date()) -> (title: StoredTitle, url: URL)? {
    guard let stored = readStored(), now <= stored.expiresAt else { return nil }
    let url = directory.appending(path: stored.file)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    return (stored, url)
  }

  /// 期限の過ぎたもの・ファイルの無くなったものを消す（つながっていなくても）
  private func removeStale(now: Date) {
    guard let stored = readStored(), current(now: now) == nil else { return }
    sceneLog.notice("タイトルの 3D の期限が過ぎた・ファイルが無いので消しました: \(stored.id, privacy: .public)")
    clear()
  }

  /// 出していた 3D を読めなかった。消して、次の refresh で取り直す
  func discard(_ url: URL) {
    guard let stored = readStored(), directory.appending(path: stored.file).standardizedFileURL == url.standardizedFileURL
    else { return }
    sceneLog.error("タイトルの 3D を読めなかったので消しました: \(stored.id, privacy: .public)")
    clear()
  }

  /// サーバーに今出すものを確かめ、違えば取り直す。重ねて呼ばれたら、走っている分を待つ
  func refresh(now: @escaping () -> Date = Date.init) async {
    if let refreshing {
      await refreshing.value
      return
    }
    let task = Task { await update(now: now) }
    refreshing = task
    await task.value
    refreshing = nil
  }

  private func update(now: () -> Date) async {
    guard let source else { return }
    // 前に取り途中で終わった（アプリが止められた）ファイルを消す。refresh は重ならないので、今取っているものは無い
    removeDownloads()
    // つながらなくても、期限の過ぎたものは消す
    removeStale(now: now())
    let latest: RemoteTitle?
    do {
      latest = try await source.latest()
    } catch {
      // つながらない・読めない。覚えているものは期限まで出す
      sceneLog.notice("タイトルを確かめられませんでした: \(error, privacy: .public)")
      return
    }
    guard let latest else {
      // 覚えているものが無くても、置き場に残ったファイルごと消す
      if readStored() != nil { sceneLog.notice("サーバーが出すタイトルが無くなったので消しました") }
      clear()
      return
    }
    guard Self.isValid(latest), now() <= latest.expiresAt else {
      sceneLog.error("出せないタイトルが届きました: \(latest.id, privacy: .public)")
      clear()
      return
    }
    if let stored = readStored(), stored.id == latest.id, stored.sha256 == latest.sha256,
      FileManager.default.fileExists(atPath: directory.appending(path: stored.file).path)
    {
      // 中身は同じ。期限と字だけを新しくする
      let renewed = StoredTitle(
        id: stored.id, caption: latest.caption, sha256: stored.sha256, expiresAt: latest.expiresAt, file: stored.file)
      if renewed != stored { write(renewed) }
      return
    }
    await replace(with: latest, from: source)
  }

  /// 新しい 3D を取り、sha256 が合えば置き換える。取れない・合わないときは、前のものも消す
  /// （サーバーが前のものを「今のもの」としていないため）
  private func replace(with latest: RemoteTitle, from source: any TitleSource) async {
    let fm = FileManager.default
    let file = "\(latest.id).usdz"
    let temp = directory.appending(path: "download-\(UUID().uuidString).usdz")
    defer { try? fm.removeItem(at: temp) }
    do {
      try fm.createDirectory(at: directory, withIntermediateDirectories: true)
      if let bundled = await bundledFile(sha256: latest.sha256) {
        try fm.copyItem(at: bundled, to: temp)
      } else {
        try await source.download(latest.model, to: temp)
      }
      let size = (try fm.attributesOfItem(atPath: temp.path)[.size] as? NSNumber)?.intValue ?? 0
      guard size <= Self.maxBytes else { throw TitleStoreError.tooLarge(size) }
      let digest = try await Self.sha256(of: temp)
      guard digest == latest.sha256 else { throw TitleStoreError.digestMismatch }
      let destination = directory.appending(path: file)
      if fm.fileExists(atPath: destination.path) {
        try fm.removeItem(at: destination)
        SceneLibrary.shared.forget(usdzAt: destination)
      }
      try fm.moveItem(at: temp, to: destination)
      write(StoredTitle(id: latest.id, caption: latest.caption, sha256: digest, expiresAt: latest.expiresAt, file: file))
      removeFiles(except: file)
      sceneLog.notice("タイトルの 3D を取りました: \(latest.id, privacy: .public)")
    } catch {
      sceneLog.error("タイトルの 3D を取れませんでした（\(latest.id, privacy: .public)）: \(error, privacy: .public)")
      clear()
    }
  }

  /// 同梱の 3D（title/*.usdz）のうち、中身が sha256 と同じもの。会場の回線で同じ物を取り直さない
  private func bundledFile(sha256: String) async -> URL? {
    if bundledDigests == nil {
      var digests: [URL: String] = [:]
      for url in bundle.urls(forResourcesWithExtension: "usdz", subdirectory: SceneLibrary.usdzDirectory) ?? [] {
        digests[url] = try? await Self.sha256(of: url)
      }
      bundledDigests = digests
    }
    return bundledDigests?.first { $0.value == sha256 }?.key
  }

  private func readStored() -> StoredTitle? {
    guard let data = try? Data(contentsOf: metadataURL) else { return nil }
    return try? Self.decoder.decode(StoredTitle.self, from: data)
  }

  private func write(_ stored: StoredTitle) {
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try Self.encoder.encode(stored).write(to: metadataURL, options: .atomic)
    } catch {
      sceneLog.error("タイトルの情報を書けませんでした: \(error, privacy: .public)")
    }
    revision += 1
  }

  /// 覚えているものを消す（取り途中のファイルは残す）。覚えているものがあったときだけ、替わったと知らせる
  private func clear() {
    let had = FileManager.default.fileExists(atPath: metadataURL.path)
    try? FileManager.default.removeItem(at: metadataURL)
    removeFiles(except: nil)
    if had { revision += 1 }
  }

  /// 取り途中のファイル（download-*）を消す
  private func removeDownloads() {
    let fm = FileManager.default
    let files = (try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    for url in files where url.lastPathComponent.hasPrefix("download-") {
      try? fm.removeItem(at: url)
    }
  }

  /// 置き場の 3D のうち、keep 以外を消す。読み込んでおいた場面も忘れる
  private func removeFiles(except keep: String?) {
    let fm = FileManager.default
    let files = (try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    for url in files where url.pathExtension == "usdz" && url.lastPathComponent != keep
      && !url.lastPathComponent.hasPrefix("download-")
    {
      try? fm.removeItem(at: url)
      SceneLibrary.shared.forget(usdzAt: url)
    }
  }

  /// id はファイルの名前に使うので、英小文字・数字・ハイフンだけにする（サーバーの予定と同じ形）
  static func isValid(_ title: RemoteTitle) -> Bool {
    title.id.wholeMatch(of: /[a-z0-9][a-z0-9-]{0,63}/) != nil
      && title.sha256.wholeMatch(of: /[0-9a-f]{64}/) != nil
      && ["http", "https"].contains(title.model.scheme?.lowercased())
  }

  /// ファイルの中身の sha256（16 進数の小文字）。読むのと計算は main の外で行う
  @concurrent nonisolated static func sha256(of url: URL) async throws -> String {
    let data = try Data(contentsOf: url, options: .mappedIfSafe)
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  private static let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    return encoder
  }()

  private static let decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
  }()
}

nonisolated enum TitleStoreError: Error {
  case tooLarge(Int)
  case digestMismatch
  case badStatus(Int)
  case badModelURL
}

/// 本物のバックエンドの GET /title と、3D のダウンロード。起動の描画を待たせないよう、GET /title は短く打ち切る
struct LiveTitleSource: TitleSource {
  private let client: Client
  private let session: URLSession

  /// configuration はテストで通信を差し替えるのに使う（protocolClasses）
  init(baseURL: URL, configuration: URLSessionConfiguration = .default) {
    let short = configuration.copy() as! URLSessionConfiguration
    short.timeoutIntervalForRequest = 5
    client = Client(
      serverURL: baseURL, transport: URLSessionTransport(configuration: .init(session: URLSession(configuration: short))))
    let long = configuration.copy() as! URLSessionConfiguration
    long.timeoutIntervalForRequest = 30
    long.timeoutIntervalForResource = 120
    session = URLSession(configuration: long)
  }

  /// 今出すタイトル。200 でない（古いバックエンドで 404 など）・読めないときは投げる（覚えているものはそのまま）
  func latest() async throws -> RemoteTitle? {
    let body = try await client.getTitle().ok.body.json
    // null を許す型は allOf で包まれ、中身は value1 に入る
    guard let title = body.title?.value1 else { return nil }
    guard let model = URL(string: title.model) else { throw TitleStoreError.badModelURL }
    return RemoteTitle(
      id: title.id, caption: title.caption, model: model, sha256: title.sha256, expiresAt: title.expiresAt)
  }

  /// 3D を取って destination に書く。大きさの上限（TitleStore.maxBytes）は、知らせられた大きさと、受け取りながらの両方で見る
  func download(_ url: URL, to destination: URL) async throws {
    try await Self.fetch(url, to: destination, session: session)
  }

  /// 受け取りと書き込み（main の外で行う）。maxBytes を超えると知らせられた・受け取った時点で止め、通信も止める。
  /// 受け取りは 1 バイトずつ回すが、AsyncBytes は中でまとめて読んでいて、2.4 MB でも main の外で短く済む
  @concurrent nonisolated static func fetch(
    _ url: URL, to destination: URL, session: URLSession, maxBytes: Int = TitleStore.maxBytes
  ) async throws {
    let (bytes, response) = try await session.bytes(from: url)
    // 途中で抜けるとき（200 でない・大きすぎる・書けない）は、残りを受け取らないよう通信を止める
    var finished = false
    defer { if !finished { bytes.task.cancel() } }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw TitleStoreError.badStatus(status) }
    guard response.expectedContentLength <= Int64(maxBytes) else {
      throw TitleStoreError.tooLarge(Int(response.expectedContentLength))
    }
    guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
      throw CocoaError(.fileWriteUnknown)
    }
    let handle = try FileHandle(forWritingTo: destination)
    defer { try? handle.close() }
    var buffer = Data()
    buffer.reserveCapacity(1 << 16)
    var total = 0
    for try await byte in bytes {
      buffer.append(byte)
      total += 1
      guard total <= maxBytes else { throw TitleStoreError.tooLarge(total) }
      if buffer.count >= 1 << 16 {
        try handle.write(contentsOf: buffer)
        buffer.removeAll(keepingCapacity: true)
      }
    }
    try handle.write(contentsOf: buffer)
    finished = true
  }
}
