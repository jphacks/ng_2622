import Foundation

/// 形を決めずに持つ JSON の値。遊んだ記録に、場面の配置の JSON をまるごと（アプリが読まない項目も）入れるのに使う
nonisolated enum JSONValue: Codable, Sendable, Equatable {
  case null
  case bool(Bool)
  case int(Int)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  init(from decoder: any Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let value = try? c.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? c.decode(Int.self) {
      self = .int(value)
    } else if let value = try? c.decode(Double.self) {
      self = .number(value)
    } else if let value = try? c.decode(String.self) {
      self = .string(value)
    } else if let value = try? c.decode([JSONValue].self) {
      self = .array(value)
    } else {
      self = .object(try c.decode([String: JSONValue].self))
    }
  }

  func encode(to encoder: any Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let value): try c.encode(value)
    case .int(let value): try c.encode(value)
    case .number(let value): try c.encode(value)
    case .string(let value): try c.encode(value)
    case .array(let value): try c.encode(value)
    case .object(let value): try c.encode(value)
    }
  }

  /// JSON のバイト列から読む
  init(data: Data) throws {
    self = try JSONDecoder().decode(JSONValue.self, from: data)
  }
}
