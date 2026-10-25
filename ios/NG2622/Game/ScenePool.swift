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

/// 待合でホストがシーンを選ぶ形。Config/*.xcconfig の SCENE_PICK（既定は Mock が difficulty、Live が list）
enum ScenePick: String, Sendable {
  /// 難易度だけを選ぶ。場面は作り置きの中から選ばれ、名前もサムネイルもスタートまで見せない
  case difficulty
  /// 手作りのシーンの一覧（サムネイルと名前）から選ぶ
  case list
}

/// 作り置きの場面から、難易度で 1 つ選ぶ。その部屋でまだ出ていないものからランダムに選び、全部出たら最初に戻る。
/// 難易度ごとに 1 つを「例」にして、待合のホストに絵だけ見せる。例はホストだけが先に見た場面なので、出題しない。
/// 1 部屋に 1 つ持つ（出た場面は部屋ごとに数える）。docs/design/scene-protocol.md の「待合での出し方」。
/// 今は Mock がアプリの中で選び、sceneId でラウンドを始める。Live でバックエンドの部屋が選ぶようになったら、
/// 選ぶのはバックエンドに任せ、start で難易度を送る形に差し替える（LiveGameClient.startRound(difficulty:)）
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

  /// アプリに同梱した作り置きの場面（pool/<sceneId>.json）。Mock で使う
  static let bundled = ScenePool(bundle: .main, examples: bundledExamples)

  /// 同梱の場面のうち、待合で例に見せるもの（リンゴが落ちる公園・スーパーのレジ・朝の駅のホーム）。
  /// 配置の JSON は作った中身のまま変えないので、どれを例にするかはここで決める
  static let bundledExamples: [SceneDifficulty: String] = [
    .easy: "gen-is8k2455rz",
    .normal: "gen-wj9zltvuug",
    .hard: "gen-0cv84arpzw",
  ]

  /// bundle の pool/*.json を、配置の JSON の difficulty で分ける。読めないものと、difficulty の無いものは入れない
  init(bundle: Bundle, examples: [SceneDifficulty: String] = [:]) {
    let urls = bundle.urls(forResourcesWithExtension: "json", subdirectory: Self.directory) ?? []
    var scenes: [SceneDifficulty: [String]] = [:]
    for url in urls.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) where url.lastPathComponent != "index.json" {
      guard let data = try? Data(contentsOf: url), let layout = try? SceneLayout.decode(data),
        let difficulty = layout.difficulty.flatMap(SceneDifficulty.init(rawValue:))
      else {
        sceneLog.notice("作り置きの場面に入れませんでした: \(url.lastPathComponent, privacy: .public)")
        continue
      }
      // MockSceneLayoutClient はファイルの名前で探すので、ID もファイルの名前にする
      scenes[difficulty, default: []].append(url.deletingPathExtension().lastPathComponent)
    }
    self.init(scenes: scenes, examples: examples)
  }
}
