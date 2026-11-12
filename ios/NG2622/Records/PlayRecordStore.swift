import Foundation
import os

nonisolated let recordLog = Logger(subsystem: "jp.jphacks.ng2622", category: "Record")

/// 遊んだ記録を端末の中に置く所。1 ラウンドが <id>.json（PlayRecord）と、同じ id の自分の録音 <id>.wav の 2 つ。
/// docs/design/play-record.md。サーバーには送らない。
///
/// 録音は記録と同じ寿命にする。録音だけが残る状態を作らないよう、書くときは json → wav、消すときは wav → json の順にする
/// （途中で止まっても、残るのは「録音なしの記録」で、記録を消せば録音も消える）
nonisolated struct PlayRecordStore: Sendable {
  /// 記録を置くフォルダ
  let directory: URL

  /// アプリ用の領域（Application Support）の下の records/
  static let shared = PlayRecordStore(
    directory: URL.applicationSupportDirectory.appending(path: "records", directoryHint: .isDirectory))

  /// 記録の ID を新しく作る
  static func newID() -> String {
    UUID().uuidString.lowercased()
  }

  // MARK: - 保存

  /// 記録を保存する。audio があれば <id>.wav に写す（元のファイルは消さない）。
  /// 同じ ID の記録がもうあれば何もせず false を返す（同じラウンドを 2 回保存しない）
  @discardableResult
  func save(_ record: PlayRecord, audio: URL? = nil) throws -> Bool {
    let json = try jsonURL(of: record.id)
    let files = FileManager.default
    guard !files.fileExists(atPath: json.path) else { return false }
    try prepareDirectory()
    try record.encoded().write(to: json, options: .atomic)
    if let audio {
      do {
        try files.copyItem(at: audio, to: json.deletingPathExtension().appendingPathExtension("wav"))
      } catch {
        // 録音が写せなくても、録音なしの記録として残す
        recordLog.notice("録音を記録に写せませんでした（\(record.id, privacy: .public)）: \(error, privacy: .public)")
      }
    }
    return true
  }

  // MARK: - 読み出し

  /// 全部の記録。新しい順。壊れたファイルと、知らない版の形（protocol）の記録は飛ばす
  func all() -> [PlayRecord] {
    let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    return urls.filter { $0.pathExtension == "json" }
      .compactMap { read($0) }
      // 同じ時刻のときも並びが変わらないよう、ID でも比べる
      .sorted { ($0.playedAt, $0.id) > ($1.playedAt, $1.id) }
  }

  /// records/ に何かファイルがあるか（読めなかった記録や、知らない版の記録も数える）。「すべて消す」で消すものがあるかを見る
  func hasFiles() -> Bool {
    !((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []).isEmpty
  }

  /// その ID の記録。無い・読めないときは nil
  func record(id: String) -> PlayRecord? {
    (try? jsonURL(of: id)).flatMap { read($0) }
  }

  /// その記録の自分の録音（WAV）。録音が無い記録は nil
  func audioURL(of id: String) -> URL? {
    guard let url = try? audioFileURL(of: id), FileManager.default.fileExists(atPath: url.path) else { return nil }
    return url
  }

  private func read(_ url: URL) -> PlayRecord? {
    do {
      let record = try PlayRecord.decode(Data(contentsOf: url))
      // ファイルの名前と中の ID が違う記録は、録音と結べないので読まない
      guard record.id == url.deletingPathExtension().lastPathComponent else {
        recordLog.notice("記録を飛ばしました（ID が名前と違う）: \(url.lastPathComponent, privacy: .public)")
        return nil
      }
      return record
    } catch {
      recordLog.notice("記録を飛ばしました（\(url.lastPathComponent, privacy: .public)）: \(error, privacy: .public)")
      return nil
    }
  }

  // MARK: - 消去

  /// 1 つの記録を、録音ごと消す
  func delete(id: String) throws {
    let files = FileManager.default
    for url in [try audioFileURL(of: id), try jsonURL(of: id)] where files.fileExists(atPath: url.path) {
      try files.removeItem(at: url)
    }
  }

  /// すべて消す。記録と録音を、読めなかったファイルも含めてまとめて消す
  func deleteAll() throws {
    let files = FileManager.default
    guard files.fileExists(atPath: directory.path) else { return }
    // 途中で止まっても録音だけが残らないよう、録音を先に消す
    for url in try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) where url.pathExtension == "wav" {
      try files.removeItem(at: url)
    }
    try files.removeItem(at: directory)
  }

  // MARK: - 置き場所

  private func prepareDirectory() throws {
    var directory = directory
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    // 端末の中だけに置く。iCloud や Mac へのバックアップには入れない
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
  }

  private func jsonURL(of id: String) throws -> URL {
    try fileURL(of: id, extension: "json")
  }

  private func audioFileURL(of id: String) throws -> URL {
    try fileURL(of: id, extension: "wav")
  }

  /// ID はファイルの名前になるので、英数字と - だけを受け付ける（フォルダの外を指させない）
  private func fileURL(of id: String, extension ext: String) throws -> URL {
    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")
    guard !id.isEmpty, id.unicodeScalars.allSatisfy(allowed.contains) else { throw PlayRecordStoreError.invalidID }
    return directory.appending(path: "\(id).\(ext)", directoryHint: .notDirectory)
  }
}

nonisolated enum PlayRecordStoreError: Error, Equatable {
  /// ID に使えない文字がある
  case invalidID
}
