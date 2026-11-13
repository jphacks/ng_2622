import CryptoKit
import Foundation
import Testing

@testable import NG2622

/// サーバーが決めるタイトル画面の 3D を、端末に取っておく所（TitleStore）。通信は差し替える
/// （docs/adr/20261113-decide-title-diorama-on-server-with-expiry.md）
struct TitleStoreTests {
  /// GET /title とダウンロードの代わり。決めた応答を返し、取った回数を数える
  final class StubSource: TitleSource {
    var latestResult: Result<RemoteTitle?, any Error> = .success(nil)
    /// URL ごとの中身
    var files: [URL: Data] = [:]
    var latestCalls = 0
    var downloads = 0
    /// ダウンロードを遅らせる（重ねて呼ばれたときの確かめ）
    var delay: Duration = .zero

    func latest() async throws -> RemoteTitle? {
      latestCalls += 1
      return try latestResult.get()
    }

    func download(_ url: URL, to destination: URL) async throws {
      downloads += 1
      if delay > .zero { try await Task.sleep(for: delay) }
      guard let data = files[url] else { throw URLError(.fileDoesNotExist) }
      try data.write(to: destination)
    }
  }

  struct Offline: Error {}

  let directory = URL.temporaryDirectory.appending(path: "title-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
  let source = StubSource()
  /// テストの bundle には同梱の 3D が無いので、いつも通信で取る
  let testBundle = Bundle(for: BundleToken.self)
  let now = Date(timeIntervalSince1970: 1_794_700_000)  // 2026-11-14T23:46:40Z（日本時間 11/15 8:46:40）

  func store(bundle: Bundle? = nil) -> TitleStore {
    TitleStore(directory: directory, source: source, bundle: bundle ?? testBundle)
  }

  func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  /// 中身 data の 3D を、id で出すタイトル
  func remote(_ id: String, _ data: Data, caption: String = "広告の見本：JPHACKS", expiresIn: TimeInterval = 3600)
    -> RemoteTitle
  {
    let url = URL(string: "https://example.workers.dev/title/\(id).usdz")!
    source.files[url] = data
    return RemoteTitle(id: id, caption: caption, model: url, sha256: digest(data), expiresAt: now + expiresIn)
  }

  func usdzFiles() -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []).filter { $0.hasSuffix(".usdz") }.sorted()
  }

  func cleanUp() {
    try? FileManager.default.removeItem(at: directory)
  }

  // MARK: - 取る・取らない

  /// 覚えている id と違えば取り、sha256 が合えば置いて覚える。次にホームを開いたときに出せる
  @Test func downloadsWhenIDDiffers() async throws {
    defer { cleanUp() }
    let data = Data("usdz-a".utf8)
    source.latestResult = .success(remote("jphacks-2026-aaaaaaaa", data))
    let store = store()
    await store.refresh(now: { now })
    #expect(source.downloads == 1)
    let current = try #require(store.current(now: now))
    #expect(current.title.id == "jphacks-2026-aaaaaaaa")
    #expect(current.title.caption == "広告の見本：JPHACKS")
    #expect(try Data(contentsOf: current.url) == data)
    #expect(usdzFiles() == ["jphacks-2026-aaaaaaaa.usdz"])
  }

  /// id が同じなら、期限の内でも毎回確かめるが、取り直さない。期限と字は新しくする
  @Test func sameIDDoesNotDownloadAgain() async throws {
    defer { cleanUp() }
    let data = Data("usdz-a".utf8)
    source.latestResult = .success(remote("jphacks-2026-aaaaaaaa", data))
    let store = store()
    await store.refresh(now: { now })
    source.latestResult = .success(remote("jphacks-2026-aaaaaaaa", data, caption: "広告の見本：ほか", expiresIn: 7200))
    await store.refresh(now: { now })
    #expect(source.latestCalls == 2)
    #expect(source.downloads == 1)
    let current = try #require(store.current(now: now))
    #expect(current.title.caption == "広告の見本：ほか")
    #expect(current.title.expiresAt == now + 7200)
  }

  /// 新しい id なら取り直し、前の 3D は消す
  @Test func replacesOldFile() async throws {
    defer { cleanUp() }
    let store = store()
    source.latestResult = .success(remote("jphacks-2026-aaaaaaaa", Data("usdz-a".utf8)))
    await store.refresh(now: { now })
    source.latestResult = .success(remote("jphacks-2026-bbbbbbbb", Data("usdz-b".utf8)))
    await store.refresh(now: { now })
    #expect(source.downloads == 2)
    #expect(store.current(now: now)?.title.id == "jphacks-2026-bbbbbbbb")
    #expect(usdzFiles() == ["jphacks-2026-bbbbbbbb.usdz"])
  }

  /// 起動と前に戻るのが重なっても、取るのは 1 回
  @Test func overlappingRefreshDownloadsOnce() async throws {
    defer { cleanUp() }
    source.latestResult = .success(remote("jphacks-2026-aaaaaaaa", Data("usdz-a".utf8)))
    source.delay = .milliseconds(100)
    let store = store()
    async let first: Void = store.refresh(now: { now })
    async let second: Void = store.refresh(now: { now })
    _ = await (first, second)
    #expect(source.latestCalls == 1)
    #expect(source.downloads == 1)
    #expect(store.current(now: now) != nil)
  }

  /// 同梱の 3D と同じ中身なら、通信で取らずに写す（会場の回線で取り直さない）
  @Test func copiesBundledFileWithSameDigest() async throws {
    defer { cleanUp() }
    let bundled = try #require(TitleDiorama.hackathon.url(in: .main))
    let data = try Data(contentsOf: bundled)
    let title = RemoteTitle(
      id: "jphacks-2026-\(digest(data).prefix(8))", caption: "広告の見本：JPHACKS",
      model: URL(string: "https://example.workers.dev/title/hackathon.usdz")!, sha256: digest(data),
      expiresAt: now + 3600)
    source.latestResult = .success(title)
    let store = store(bundle: .main)
    await store.refresh(now: { now })
    #expect(source.downloads == 0)
    let current = try #require(store.current(now: now))
    #expect(try Data(contentsOf: current.url) == data)
  }

  // MARK: - 捨てる・消す

  /// sha256 が合わなければ捨て、何も出さない
  @Test func discardsOnDigestMismatch() async throws {
    defer { cleanUp() }
    let good = remote("jphacks-2026-aaaaaaaa", Data("usdz-a".utf8))
    source.files[good.model] = Data("tampered".utf8)
    source.latestResult = .success(good)
    let store = store()
    await store.refresh(now: { now })
    #expect(source.downloads == 1)
    #expect(store.current(now: now) == nil)
    #expect(usdzFiles().isEmpty)
  }

  /// サーバーが null を返したら、覚えているものを消す（公園に戻る）
  @Test func clearsWhenServerReturnsNull() async throws {
    defer { cleanUp() }
    let store = store()
    source.latestResult = .success(remote("jphacks-2026-aaaaaaaa", Data("usdz-a".utf8)))
    await store.refresh(now: { now })
    #expect(store.current(now: now) != nil)
    source.latestResult = .success(nil)
    await store.refresh(now: { now })
    #expect(store.current(now: now) == nil)
    #expect(usdzFiles().isEmpty)
  }

  /// つながらなくても、期限までは出し、期限を過ぎたら消す（端末の時刻で見る）
  @Test func expiresWithoutNetwork() async throws {
    defer { cleanUp() }
    let store = store()
    source.latestResult = .success(remote("jphacks-2026-aaaaaaaa", Data("usdz-a".utf8), expiresIn: 60))
    await store.refresh(now: { now })
    source.latestResult = .failure(Offline())
    await store.refresh(now: { now + 30 })
    #expect(store.current(now: now + 30) != nil)
    #expect(store.current(now: now + 60) != nil)  // 期限ちょうどは出す
    #expect(store.current(now: now + 61) == nil)
    #expect(usdzFiles().isEmpty)
    // 消したあとは、戻した時刻でも出さない
    #expect(store.current(now: now) == nil)
  }

  /// 前に覚えたものがあるときにつながらなければ、期限まではそのまま出す（取り直さない）
  @Test func keepsStoredWhenOffline() async throws {
    defer { cleanUp() }
    let store = store()
    source.latestResult = .success(remote("jphacks-2026-aaaaaaaa", Data("usdz-a".utf8)))
    await store.refresh(now: { now })
    source.latestResult = .failure(Offline())
    await store.refresh(now: { now })
    #expect(source.downloads == 1)
    #expect(store.current(now: now)?.title.id == "jphacks-2026-aaaaaaaa")
    #expect(usdzFiles() == ["jphacks-2026-aaaaaaaa.usdz"])
  }

  /// 前に覚えたものがあるときに、新しい 3D の sha256 が合わなければ、新しい方を捨て、前のものも消す
  /// （サーバーは前のものを「今のもの」としていないため）。次に確かめたときに、もう一度取る
  @Test func digestMismatchAfterStoredClearsBoth() async throws {
    defer { cleanUp() }
    let store = store()
    source.latestResult = .success(remote("jphacks-2026-aaaaaaaa", Data("usdz-a".utf8)))
    await store.refresh(now: { now })
    let next = remote("jphacks-2026-bbbbbbbb", Data("usdz-b".utf8))
    source.files[next.model] = Data("tampered".utf8)
    source.latestResult = .success(next)
    await store.refresh(now: { now })
    #expect(store.current(now: now) == nil)
    #expect(usdzFiles().isEmpty)
    source.files[next.model] = Data("usdz-b".utf8)
    await store.refresh(now: { now })
    #expect(store.current(now: now)?.title.id == "jphacks-2026-bbbbbbbb")
  }

  /// 取り途中で止まったファイル（download-*）は、次に確かめるときに消す
  @Test func removesLeftoverDownloads() async throws {
    defer { cleanUp() }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data("partial".utf8).write(to: directory.appending(path: "download-left.usdz"))
    source.latestResult = .success(nil)
    await store().refresh(now: { now })
    #expect(((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []).isEmpty)
  }

  /// 期限の過ぎたタイトルが届いたら、出さない
  @Test func ignoresExpiredRemote() async throws {
    defer { cleanUp() }
    source.latestResult = .success(remote("jphacks-2026-aaaaaaaa", Data("usdz-a".utf8), expiresIn: -1))
    let store = store()
    await store.refresh(now: { now })
    #expect(source.downloads == 0)
    #expect(store.current(now: now) == nil)
  }

  /// id はファイルの名前に使うので、決めた形でないもの（場所を指す文字など）は取らない
  @Test func rejectsUnsafeID() async throws {
    defer { cleanUp() }
    source.latestResult = .success(remote("../evil", Data("usdz-a".utf8)))
    let store = store()
    await store.refresh(now: { now })
    #expect(source.downloads == 0)
    #expect(store.current(now: now) == nil)
  }

  /// 出していた 3D を読めなかったら消す（次の refresh で取り直す）
  @Test func discardRemovesCurrent() async throws {
    defer { cleanUp() }
    let store = store()
    source.latestResult = .success(remote("jphacks-2026-aaaaaaaa", Data("usdz-a".utf8)))
    await store.refresh(now: { now })
    let current = try #require(store.current(now: now))
    store.discard(current.url)
    #expect(store.current(now: now) == nil)
    await store.refresh(now: { now })
    #expect(source.downloads == 2)
  }

  // MARK: - ホームに出すもの

  /// Live はサーバーが決めて取っておいた 3D を出し、TITLE_DIORAMA は見ない。無ければ公園
  @Test func liveUsesStoredTitle() async throws {
    defer { cleanUp() }
    let live = AppConfig(mode: .live, backendURL: nil, mock: .init(), titleDiorama: .hackathon)
    let store = store()
    #expect(HomeTitle.current(config: live, store: store, now: now) == .park)
    source.latestResult = .success(remote("jphacks-2026-aaaaaaaa", Data("usdz-a".utf8)))
    await store.refresh(now: { now })
    let url = try #require(store.current(now: now)?.url)
    #expect(HomeTitle.current(config: live, store: store, now: now) == .advert(url, caption: "広告の見本：JPHACKS"))
    #expect(HomeTitle.current(config: live, store: store, now: now + 7200) == .park)
  }

  /// 読めなかった 3D が今出しているものかを見分ける（前の 3D の読み込みの失敗で、新しい 3D を消さない）
  @Test func isShowingOnlyCurrentAdvert() {
    let current = URL(filePath: "/tmp/title/jphacks-2026-bbbbbbbb.usdz")
    let title = HomeTitle.advert(current, caption: "広告の見本：JPHACKS")
    #expect(title.isShowing(current))
    #expect(title.isShowing(URL(filePath: "/tmp/title/./jphacks-2026-bbbbbbbb.usdz")))
    #expect(!title.isShowing(URL(filePath: "/tmp/title/jphacks-2026-aaaaaaaa.usdz")))
    #expect(!HomeTitle.park.isShowing(current))
  }

  /// Mock は TITLE_DIORAMA の同梱の 3D を出す（サーバーには聞かない）
  @Test func mockUsesBuildSetting() throws {
    let mock = AppConfig(mode: .mock, backendURL: nil, mock: .init(), titleDiorama: .hackathon)
    let url = try #require(TitleDiorama.hackathon.url())
    #expect(HomeTitle.current(config: mock, store: store(), now: now) == .advert(url, caption: "広告の見本：JPHACKS"))
    let plain = AppConfig(mode: .mock, backendURL: nil, mock: .init())
    #expect(HomeTitle.current(config: plain, store: store(), now: now) == .park)
    #expect(HomeTitle.park.caption == nil)
  }
}

/// 本物のバックエンドを呼ぶ LiveTitleSource。通信は URLProtocol で差し替える
struct LiveTitleSourceTests {
  let base = URL(string: "https://live-title-\(UUID().uuidString.lowercased()).example")!

  func source(_ routes: [String: (Int, Data)]) -> LiveTitleSource {
    for (path, response) in routes { StubURLProtocol.set(base.host()! + path, response) }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubURLProtocol.self]
    return LiveTitleSource(baseURL: base, configuration: configuration)
  }

  /// 200 の本文から今出すタイトルを読み、3D をそのまま書く
  @Test func readsTitleAndDownloads() async throws {
    let data = Data("usdz-a".utf8)
    let json = #"{"title":{"id":"jphacks-2026-ecc5df64","caption":"広告の見本：JPHACKS","model":"https://example.workers.dev/title/hackathon.usdz?v=ecc5df64","sha256":"ecc5df6420d58288105de59ecfde931755a1d345b0789245f9dca72f09719dae","expiresAt":"2026-11-15T14:59:59Z"}}"#
    let live = source(["/title": (200, Data(json.utf8)), "/title/hackathon.usdz": (200, data)])
    let title = try #require(try await live.latest())
    #expect(title.id == "jphacks-2026-ecc5df64")
    #expect(title.expiresAt == Date(timeIntervalSince1970: 1_794_754_799))
    let destination = URL.temporaryDirectory.appending(path: "live-\(UUID().uuidString).usdz")
    defer { try? FileManager.default.removeItem(at: destination) }
    try await live.download(base.appending(path: "title/hackathon.usdz"), to: destination)
    #expect(try Data(contentsOf: destination) == data)
    let none = source(["/title": (200, Data(#"{"title":null}"#.utf8))])
    #expect(try await none.latest() == nil)
  }

  /// GET /title が 404（/title の無い古いバックエンド）なら投げ、覚えているものは残す
  @Test func notFoundKeepsStored() async throws {
    let directory = URL.temporaryDirectory.appending(path: "title-live-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    let now = Date(timeIntervalSince1970: 1_794_700_000)
    let data = Data("usdz-a".utf8)
    let stub = TitleStoreTests.StubSource()
    let model = URL(string: "https://example.workers.dev/title/a.usdz")!
    stub.files[model] = data
    stub.latestResult = .success(
      RemoteTitle(
        id: "jphacks-2026-aaaaaaaa", caption: "広告の見本：JPHACKS", model: model,
        sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), expiresAt: now + 3600))
    let bundle = Bundle(for: BundleToken.self)
    await TitleStore(directory: directory, source: stub, bundle: bundle).refresh(now: { now })

    let live = source(["/title": (404, Data("Not Found".utf8))])
    await #expect(throws: (any Error).self) { try await live.latest() }
    let store = TitleStore(directory: directory, source: live, bundle: bundle)
    await store.refresh(now: { now })
    #expect(store.current(now: now)?.title.id == "jphacks-2026-aaaaaaaa")
  }

  /// 3D が 404 なら投げる（TitleStore は取れなかったものとして扱う）
  @Test func downloadNotFoundThrows() async throws {
    let live = source([:])
    let destination = URL.temporaryDirectory.appending(path: "live-\(UUID().uuidString).usdz")
    defer { try? FileManager.default.removeItem(at: destination) }
    await #expect(throws: TitleStoreError.self) {
      try await live.download(base.appending(path: "title/missing.usdz"), to: destination)
    }
  }

  /// 大きさの上限を超える 3D は、知らせられた大きさでも、大きさを小さく偽って送られても、受け取る途中で止める
  @Test func stopsTooLargeDownload() async throws {
    let session: URLSession = {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.protocolClasses = [StubURLProtocol.self]
      return URLSession(configuration: configuration)
    }()
    let big = Data(repeating: 7, count: 1_000)
    let host = base.host()!
    StubURLProtocol.set(host + "/title/announced.usdz", (200, big))
    StubURLProtocol.set(host + "/title/disguised.usdz", (200, big), contentLength: 10)
    StubURLProtocol.set(host + "/title/fits.usdz", (200, Data(repeating: 7, count: 100)))
    let destination = URL.temporaryDirectory.appending(path: "live-\(UUID().uuidString).usdz")
    defer { try? FileManager.default.removeItem(at: destination) }
    for name in ["announced", "disguised"] {
      await #expect(throws: TitleStoreError.self, "\(name)") {
        try await LiveTitleSource.fetch(
          base.appending(path: "title/\(name).usdz"), to: destination, session: session, maxBytes: 100)
      }
    }
    // 上限ちょうどは取る
    try await LiveTitleSource.fetch(base.appending(path: "title/fits.usdz"), to: destination, session: session, maxBytes: 100)
    #expect(try Data(contentsOf: destination).count == 100)
  }
}

/// 決めた状態と本文を返す通信の代わり。routes のキーはホストとパス（テストごとにホストを変えて、並べて流してもぶつからない）
nonisolated final class StubURLProtocol: URLProtocol {
  nonisolated(unsafe) private static var routes: [String: (Int, Data)] = [:]
  /// Content-Length を本文の大きさと違う値で知らせる（大きさを偽ったときの確かめ）
  nonisolated(unsafe) private static var lengths: [String: Int] = [:]
  private static let lock = NSLock()

  static func set(_ key: String, _ response: (Int, Data), contentLength: Int? = nil) {
    lock.withLock {
      routes[key] = response
      lengths[key] = contentLength
    }
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    let url = request.url!
    let key = (url.host() ?? "") + url.path()
    let (status, body) = Self.lock.withLock { Self.routes[key] } ?? (404, Data())
    let length = Self.lock.withLock { Self.lengths[key] } ?? body.count
    let response = HTTPURLResponse(
      url: url, statusCode: status, httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": status == 200 && url.pathExtension != "usdz" ? "application/json" : "text/plain",
                     "Content-Length": "\(length)"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: body)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

/// テストの bundle を指すための印
private final class BundleToken {}
