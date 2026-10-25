import Foundation

/// 作り置きの場面の難しさ。docs/design/scene-protocol.md の「難易度の中身」。配置の JSON の difficulty と同じ値
enum SceneDifficulty: String, CaseIterable, Identifiable, Sendable {
  case easy
  case normal
  case hard

  var id: String { rawValue }

  var label: String {
    switch self {
    case .easy: "かんたん"
    case .normal: "ふつう"
    case .hard: "むずかしい"
    }
  }
}

/// 待合でホストがシーンを選ぶ形。Config/*.xcconfig の SCENE_PICK（Mock も Live も difficulty）
enum ScenePick: String, Sendable {
  /// 難易度だけを選ぶ。場面は作り置きの中から選ばれ、名前もサムネイルもスタートまで見せない
  case difficulty
  /// 手作りのシーンの一覧（サムネイルと名前）から選ぶ
  case list
}

/// 作り置きの場面から、難易度で 1 つ選ぶ。その部屋でまだ出ていないものからランダムに選び、全部出たら最初に戻る。
/// 難易度ごとに 1 つを「例」にして、待合のホストに絵だけ見せる。例はホストだけが先に見た場面なので、出題しない。
/// 1 部屋に 1 つ持つ（出た場面は部屋ごとに数える）。docs/design/scene-protocol.md の「待合での出し方」。
/// Mock はアプリの中で選び、sceneId でラウンドを始める。Live は選ぶのをバックエンドの部屋に任せ、
/// start で難易度だけを送る（LiveGameClient.startRound(difficulty:)）。例はどちらも同梱の一覧から出す
struct ScenePool {
  /// 難易度ごとの sceneId（例も入る）
  let scenes: [SceneDifficulty: [String]]
  /// 難易度ごとの例の sceneId。待合で見せ、出題しない
  let examples: [SceneDifficulty: String]
  /// この部屋で出た sceneId
  private(set) var played: Set<String> = []
  /// 直前に出た sceneId。全部出て最初に戻ったとき、同じ場面が続けて出ないようにする
  private var last: String?

  init(scenes: [SceneDifficulty: [String]], examples: [SceneDifficulty: String] = [:]) {
    self.scenes = scenes
    self.examples = examples
  }

  /// 出題できる場面が 1 つ以上ある難易度
  var difficulties: [SceneDifficulty] {
    SceneDifficulty.allCases.filter { !candidates(of: $0).isEmpty }
  }

  /// 待合で見せる例。その難易度の場面に入っていなければ nil
  func example(of difficulty: SceneDifficulty) -> String? {
    examples[difficulty].flatMap { (scenes[difficulty] ?? []).contains($0) ? $0 : nil }
  }

  /// 出題の候補。例は外す
  func candidates(of difficulty: SceneDifficulty) -> [String] {
    (scenes[difficulty] ?? []).filter { $0 != examples[difficulty] }
  }

  /// その難易度の場面を 1 つ選び、出たことにする。出題できる場面が無ければ nil
  mutating func draw(_ difficulty: SceneDifficulty) -> String? {
    var random = SystemRandomNumberGenerator()
    return draw(difficulty, using: &random)
  }

  mutating func draw(_ difficulty: SceneDifficulty, using random: inout some RandomNumberGenerator) -> String? {
    let all = candidates(of: difficulty)
    guard !all.isEmpty else { return nil }
    var fresh = all.filter { !played.contains($0) }
    if fresh.isEmpty {
      // 全部出たので、この難易度の分だけ最初に戻る
      played.subtract(all)
      fresh = all.count > 1 ? all.filter { $0 != last } : all
    }
    guard let id = fresh.randomElement(using: &random) else { return nil }
    played.insert(id)
    last = id
    return id
  }

  /// アプリの中で作り置きの場面を置くフォルダ。ビルドのときに backend/src/scenes/pool から写す（project.yml の Copy scene pool）
  static let directory = "pool"

  /// アプリに同梱した作り置きの場面（pool/index.json と pool/<sceneId>.json）。Mock の出題と、待合の例に使う
  static let bundled = ScenePool(bundle: .main)

  /// 作り置きの場面の一覧（backend/src/scenes/pool/index.json）の、1 つの難易度の分。
  /// example は待合で見せる例、scenes は出題の候補（例は入れない）。形は backend/src/scenes/pool/README.md
  struct IndexEntry: Decodable, Sendable {
    let example: String?
    let scenes: [String]
  }

  /// index.json の中身から作る。知らない難易度は飛ばす。exists が false を返す ID（JSON の無い場面）は入れない
  init(index data: Data, exists: (String) -> Bool = { _ in true }) throws {
    let index = try JSONDecoder().decode([String: IndexEntry].self, from: data)
    var scenes: [SceneDifficulty: [String]] = [:]
    var examples: [SceneDifficulty: String] = [:]
    for (key, entry) in index {
      guard let difficulty = SceneDifficulty(rawValue: key) else {
        sceneLog.notice("作り置きの場面の一覧に、知らない難易度があります: \(key, privacy: .public)")
        continue
      }
      // ScenePool の scenes は例も入れて持つ（例が場面の中にあるときだけ example(of:) が返す）
      let ids = ([entry.example].compactMap { $0 } + entry.scenes).filter { id in
        if exists(id) { return true }
        sceneLog.notice("作り置きの場面の JSON がありません: \(id, privacy: .public)")
        return false
      }
      scenes[difficulty] = ids
      if let example = entry.example { examples[difficulty] = example }
    }
    self.init(scenes: scenes, examples: examples)
  }

  /// bundle の pool/index.json から作る。読めなければ場面は空（難易度を選べない）
  init(bundle: Bundle) {
    let directory = Self.directory
    guard let url = bundle.url(forResource: "index", withExtension: "json", subdirectory: directory),
      let data = try? Data(contentsOf: url),
      let pool = try? ScenePool(index: data, exists: {
        bundle.url(forResource: $0, withExtension: "json", subdirectory: directory) != nil
      })
    else {
      sceneLog.error("作り置きの場面の一覧（\(directory, privacy: .public)/index.json）を読めませんでした")
      self.init(scenes: [:])
      return
    }
    self = pool
  }
}
