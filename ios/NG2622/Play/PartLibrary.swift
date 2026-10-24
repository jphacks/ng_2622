import Foundation
import RealityKit
import os

let sceneLog = Logger(subsystem: "jp.jphacks.ng2622", category: "Scene")

/// 場面を組み立てる部品（USDZ）を読む所。同じ部品は 1 度だけ読み、使うたびに複製して渡す。
/// 探す順は、同梱（assets/parts → アプリの parts/<id>/<version>.usdz）→ 端末のキャッシュ → バックエンドの
/// GET /parts/{id}/{version}.usdz（docs/design/scene-protocol.md の「アプリの組み立て」）。
/// Hack Day では同梱だけで足りる。バックエンドから取るのは、同梱に無い部品が届いたときだけ
final class PartLibrary {
  static let shared = PartLibrary(
    bundle: .main,
    remoteBaseURL: AppConfig.current.mode == .live ? AppConfig.current.backendURL : nil)

  private let bundle: Bundle
  /// 部品を取りに行くバックエンド。nil なら同梱とキャッシュだけ（Mock）
  private let remoteBaseURL: URL?
  /// 同梱の部品の版（parts/index.json）。版を書かない部品はこの版を使う
  private let bundledVersions: [String: Int]
  private var loads: [PartRef: Task<Entity?, Never>] = [:]

  init(bundle: Bundle, remoteBaseURL: URL?) {
    self.bundle = bundle
    self.remoteBaseURL = remoteBaseURL
    bundledVersions = Self.readIndex(in: bundle)
  }

  /// 同梱の部品の ID
  var bundledIDs: Set<String> { Set(bundledVersions.keys) }

  /// 版を決める。書かれていなければ同梱の版。どちらも無ければ nil（GET /parts の一覧はまだ読まない）
  func resolve(_ ref: PartRef) -> PartRef? {
    guard let version = ref.version ?? bundledVersions[ref.id] else { return nil }
    return PartRef(id: ref.id, version: version)
  }

  func preload(_ ref: PartRef) {
    _ = load(ref)
  }

  /// 部品の複製。見つからない・読めないときは nil
  func instance(of ref: PartRef) async -> Entity? {
    await load(ref)?.value?.clone(recursive: true)
  }

  private func load(_ ref: PartRef) -> Task<Entity?, Never>? {
    guard let ref = resolve(ref), let version = ref.version else { return nil }
    if let task = loads[ref] { return task }
    let task = Task { () -> Entity? in
      guard let url = await self.locate(id: ref.id, version: version) else { return nil }
      do {
        return try await Entity(contentsOf: url)
      } catch {
        sceneLog.error("部品を読めませんでした: \(ref.id, privacy: .public)@\(version) \(error, privacy: .public)")
        return nil
      }
    }
    loads[ref] = task
    Task {
      // 読めなかったものは覚えず、次に頼まれたときにまた探す
      if await task.value == nil { loads[ref] = nil }
    }
    return task
  }

  /// USDZ のある場所。同梱 → キャッシュ → バックエンドから取ってキャッシュに置く
  private func locate(id: String, version: Int) async -> URL? {
    if let url = bundle.url(forResource: "\(version)", withExtension: "usdz", subdirectory: "parts/\(id)") {
      return url
    }
    let cached = Self.cacheURL(id: id, version: version)
    if FileManager.default.fileExists(atPath: cached.path) { return cached }
    guard let remoteBaseURL else { return nil }
    return await download(from: remoteBaseURL.appending(path: "parts/\(id)/\(version).usdz"), to: cached)
  }

  /// 版ごとに中身が変わらないので、取ってきたものは消さずに使い続ける
  private func download(from url: URL, to destination: URL) async -> URL? {
    do {
      let (file, response) = try await URLSession.shared.download(from: url)
      guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
        sceneLog.notice("部品を取れませんでした: \(url.path(), privacy: .public)")
        return nil
      }
      let fm = FileManager.default
      try fm.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
      if fm.fileExists(atPath: destination.path) { try fm.removeItem(at: destination) }
      try fm.moveItem(at: file, to: destination)
      return destination
    } catch {
      sceneLog.error("部品を取れませんでした: \(url.path(), privacy: .public) \(error, privacy: .public)")
      return nil
    }
  }

  private static func cacheURL(id: String, version: Int) -> URL {
    URL.cachesDirectory.appending(path: "parts/\(id)/\(version).usdz")
  }

  private static func readIndex(in bundle: Bundle) -> [String: Int] {
    struct Entry: Decodable {
      let id: String
      let version: Int
    }
    guard let url = bundle.url(forResource: "index", withExtension: "json", subdirectory: "parts"),
      let data = try? Data(contentsOf: url),
      let entries = try? JSONDecoder().decode([Entry].self, from: data)
    else {
      sceneLog.error("同梱の部品の一覧（parts/index.json）を読めませんでした")
      return [:]
    }
    // 同じ ID が何度も出るときは、新しい版を使う
    return entries.reduce(into: [:]) { result, entry in
      result[entry.id] = max(result[entry.id] ?? 0, entry.version)
    }
  }
}
