import Foundation

/// 配置の JSON（scenenglish.scene/1）。docs/design/scene-protocol.md の「配置の JSON」。
/// アプリが並べるのに使う項目だけを読む（採点の description・elements はバックエンドが使う）
nonisolated struct SceneLayout: Decodable, Sendable, Equatable {
  static let protocolName = "scenenglish.scene/1"

  /// 形の版。`scenenglish.scene/1` 以外は読まない
  let `protocol`: String
  let id: String?
  /// 日本語の名前（待合と結果に出す）
  let name: String
  let difficulty: String?
  /// 置く部品。上から順に置く。読めない item は飛ばす（1 件が壊れていても、ほかは置く）
  let items: [Item]

  enum CodingKeys: String, CodingKey {
    case `protocol`, id, name, difficulty, items
  }

  init(protocol: String, id: String?, name: String, difficulty: String?, items: [Item]) {
    self.protocol = `protocol`
    self.id = id
    self.name = name
    self.difficulty = difficulty
    self.items = items
  }

  init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    var list = try c.nestedUnkeyedContainer(forKey: .items)
    var items: [Item] = []
    while !list.isAtEnd {
      let index = list.currentIndex
      do {
        items.append(try list.decode(Item.self))
      } catch {
        sceneLog.notice("配置の item を飛ばしました（\(index) 番目）: \(error, privacy: .public)")
        // 読めなかった item は、中身を見ない値として読み、次へ進む（進めなければ残りもあきらめる）
        guard (try? list.decode(Skipped.self)) != nil else { break }
      }
    }
    self.init(
      protocol: try c.decode(String.self, forKey: .protocol),
      id: try c.decodeIfPresent(String.self, forKey: .id),
      name: try c.decode(String.self, forKey: .name),
      difficulty: try c.decodeIfPresent(String.self, forKey: .difficulty),
      items: items)
  }

  /// 読めなかった item を読み飛ばすための、どんな値も受け取る型
  private struct Skipped: Decodable {
    init(from decoder: any Decoder) throws {}
  }

  nonisolated struct Item: Decodable, Sendable, Equatable {
    /// シーンの中で重ならない名前
    let key: String
    /// 部品の ID。版を固定するときは `apple@1`
    let part: String
    /// 部品の原点（底面の中心）を置く位置（m）
    let position: SIMD3<Float>
    /// Y 軸まわりの回転（度、上から見て反時計回り。0 で正面が +Z）
    let yaw: Double
    /// 一様な拡大（0.25〜4 に収める）
    let scale: Float
    let motion: Motion?

    enum CodingKeys: String, CodingKey {
      case key, part, position, yaw, scale, motion
    }

    init(key: String, part: String, position: SIMD3<Float>, yaw: Double = 0, scale: Float = 1, motion: Motion? = nil) {
      self.key = key
      self.part = part
      self.position = position
      self.yaw = yaw
      self.scale = min(4, max(0.25, scale))
      self.motion = motion
    }

    init(from decoder: any Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      self.init(
        key: try c.decode(String.self, forKey: .key),
        part: try c.decode(String.self, forKey: .part),
        position: try Self.vector(c.decode([Float].self, forKey: .position)),
        yaw: try c.decodeIfPresent(Double.self, forKey: .yaw) ?? 0,
        scale: try c.decodeIfPresent(Float.self, forKey: .scale) ?? 1,
        // 知らない動き・壊れた動きは、動かさずに置く
        motion: try? c.decodeIfPresent(Motion.self, forKey: .motion))
    }

    static func vector(_ values: [Float]) throws -> SIMD3<Float> {
      guard values.count == 3 else {
        throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "[x, y, z] ではありません"))
      }
      return SIMD3(values[0], values[1], values[2])
    }

    /// part を ID と版に分ける。版が書かれていなければ nil（その時点の最新の版）
    var partRef: PartRef { PartRef(part) }
  }

  /// 部品ごとに 1 つだけ付けられる簡単な動き。時刻はラウンドの startAt から数える
  nonisolated struct Motion: Decodable, Sendable, Equatable {
    enum Kind: String, Decodable, Sendable {
      /// 置いた位置から真下の地面（y = 0）まで落ちる
      case fall
      /// 置いた位置から to までまっすぐ動く
      case move
      /// Y 軸まわりに回る（duration は 1 回転の秒数）
      case rotate
      /// 左右に揺れる（duration は 1 往復の秒数）
      case sway
    }

    let type: Kind
    /// 秒。0 以下は動かさない
    let duration: Double
    /// 動き始めるまでの秒数
    let delay: Double
    /// 終わったら初めの位置に戻って繰り返す
    let loop: Bool
    /// move の行き先
    let to: SIMD3<Float>?
    /// sway の揺れの角度（度）
    let angle: Double

    enum CodingKeys: String, CodingKey {
      case type, duration, delay, loop, to, angle
    }

    init(type: Kind, duration: Double, delay: Double = 0, loop: Bool = true, to: SIMD3<Float>? = nil, angle: Double = 10) {
      self.type = type
      self.duration = duration
      self.delay = delay
      self.loop = loop
      self.to = to
      self.angle = angle
    }

    init(from decoder: any Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      let type = try c.decode(Kind.self, forKey: .type)
      let to = try c.decodeIfPresent([Float].self, forKey: .to).map(Item.vector)
      if type == .move && to == nil {
        throw DecodingError.keyNotFound(CodingKeys.to, .init(codingPath: c.codingPath, debugDescription: "move に to が無い"))
      }
      self.init(
        type: type,
        duration: try c.decode(Double.self, forKey: .duration),
        delay: try c.decodeIfPresent(Double.self, forKey: .delay) ?? 0,
        loop: try c.decodeIfPresent(Bool.self, forKey: .loop) ?? true,
        to: to,
        angle: try c.decodeIfPresent(Double.self, forKey: .angle) ?? 10)
    }
  }

  /// 配置の JSON を読む。知らない版の形なら throw する
  static func decode(_ data: Data) throws -> SceneLayout {
    let layout = try JSONDecoder().decode(SceneLayout.self, from: data)
    guard layout.protocol == protocolName else {
      throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "知らない形: \(layout.protocol)"))
    }
    return layout
  }
}

/// 部品の ID と版（`apple@1` → apple と 1、`apple` → apple と nil）
nonisolated struct PartRef: Hashable, Sendable {
  let id: String
  let version: Int?

  init(id: String, version: Int?) {
    self.id = id
    self.version = version
  }

  init(_ text: String) {
    let pieces = text.split(separator: "@", maxSplits: 1).map(String.init)
    id = pieces.first ?? text
    version = pieces.count == 2 ? Int(pieces[1]) : nil
  }
}

/// AI で作った場面か（同梱の 6 シーンは焼き込んだ USDZ を出す）
enum GeneratedScene {
  static let prefix = "gen-"

  static func isGenerated(_ sceneID: String) -> Bool {
    sceneID.hasPrefix(prefix)
  }
}
