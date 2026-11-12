import Foundation
import Observation

/// きろくの画面に出す 1 回分。記録と、そこから読んだ場面の配置・振り返りの画面に渡す形を一緒に持つ
/// （記録の場面は JSON のままなので、出すたびに読み直さないよう、読み込みのときに 1 度だけ直す）
struct RecordEntry: Identifiable, Equatable {
  let record: PlayRecord
  /// 記録の場面の配置。知らない版の場面で読めなければ nil
  let layout: SceneLayout?
  /// 振り返りの画面に渡す形（自分 1 人だけ。順位は無い）
  let results: RoundResults

  /// 組んだ 3D を覚える名前（SceneLibrary）。同じ場面で配置も同じ回は、同じ名前にして 3D を使い回す
  /// （組み直すと、出るまでに数秒かかることがある）。RecordScenes.group が決める
  fileprivate(set) var sceneKey: String

  var id: String { record.id }
  var playedAt: Date { record.playedAt }
  var difficulty: SceneDifficulty? { record.difficulty.flatMap(SceneDifficulty.init) }
  var score: PlayerResult.Score? { results.me?.score }
  var content: ContentBreakdown? { results.me?.content }

  init(_ record: PlayRecord) {
    self.record = record
    layout = try? record.sceneLayout()
    results = record.results
    sceneKey = "record:\(record.id)"
  }
}

/// 同じ場面を遊んだ記録のまとまり。きろくの画面の横の並びの 1 つ
struct RecordScene: Identifiable, Equatable {
  /// 場面の ID。場面に ID が無い記録は、その記録だけのまとまりにする
  let id: String
  /// 新しい順。1 つ以上ある
  let entries: [RecordEntry]

  /// 最後に遊んだ回
  var latest: RecordEntry { entries[0] }
  /// 場面の名前と配置は、最後に遊んだ回のものを使う
  var name: String { latest.results.sceneName }
  var layout: SceneLayout? { latest.layout }
  /// 組んだ 3D を覚える名前。最後に遊んだ回が替われば組み直す
  var sceneKey: String { latest.sceneKey }
}

enum RecordScenes {
  /// 記録を場面ごとにまとめる。場面の並びは最後に遊んだのが新しい順、場面の中も新しい順
  static func group(_ records: [PlayRecord]) -> [RecordScene] {
    let entries = records.map(RecordEntry.init).sorted { ($0.playedAt, $0.id) > ($1.playedAt, $1.id) }
    var order: [String] = []
    var groups: [String: [RecordEntry]] = [:]
    for var entry in entries {
      let key = entry.layout?.id ?? "record:\(entry.id)"
      if groups[key] == nil { order.append(key) }
      // 同じ場面の、配置が同じいちばん新しい回の 3D を使い回す
      if let same = groups[key]?.first(where: { $0.layout == entry.layout }) { entry.sceneKey = same.sceneKey }
      groups[key, default: []].append(entry)
    }
    return order.map { RecordScene(id: $0, entries: groups[$0] ?? []) }
  }
}

/// 端末に残した遊んだ記録を、画面（ホーム・きろく・設定）に出すために読んでおく所。
/// 記録が増える・消えるたびに reload して、どの画面の回数も同じになるようにする
@Observable
final class RecordLibrary {
  /// 場面ごとのまとまり（最後に遊んだのが新しい順）
  private(set) var scenes: [RecordScene] = []
  /// 記録の数
  private(set) var count = 0
  /// 録音のある記録の数
  private(set) var audioCount = 0
  /// 「すべて消す」で消すものがあるか。読める記録が 0 件でも、読めなかったファイルが残っていれば true
  private(set) var canDelete = false

  /// アプリ全体で使う 1 つ。Mock では、例の記録（端末には書かない）も一緒に出す
  static let app = RecordLibrary(samples: PlayRecord.samples(count: AppConfig.current.mockSampleRecords))

  private let store: PlayRecordStore
  /// 例の記録（Mock で画面を確かめるためのもの。端末には書かない）。「すべて消す」で一緒に出さなくなる
  private var samples: [PlayRecord]
  /// 読み直しの番号。後から始めた読み直しが先に終わったとき、古い結果で上書きしない
  private var generation = 0

  init(store: PlayRecordStore = .shared, samples: [PlayRecord] = []) {
    self.store = store
    self.samples = samples
  }

  /// 端末の記録を読み直す。ファイルは main の外で読む（記録が増えても画面を止めない）
  func reload() async {
    let store = store
    generation += 1
    let mine = generation
    let (saved, audio, hasFiles) = await Task.detached {
      let saved = store.all()
      return (saved, saved.filter { store.audioURL(of: $0.id) != nil }.count, store.hasFiles())
    }.value
    guard mine == generation else { return }
    scenes = RecordScenes.group(saved + samples)
    count = saved.count + samples.count
    audioCount = audio
    canDelete = hasFiles || !samples.isEmpty
  }

  /// その回の自分の録音。無ければ nil
  func recording(of entry: RecordEntry) -> RecordedAudio? {
    guard let url = store.audioURL(of: entry.id), let info = WAVInfo.read(url) else { return nil }
    return RecordedAudio(url: url, duration: info.duration)
  }

  /// 記録と録音をすべて消す
  func deleteAll() async throws {
    let store = store
    do {
      try await Task.detached { try store.deleteAll() }.value
    } catch {
      // 途中まで消えたかもしれないので、消せなくても今の中身に合わせ直す
      await reload()
      throw error
    }
    samples = []
    SceneLibrary.shared.forgetComposedLayouts()
    await reload()
  }
}
