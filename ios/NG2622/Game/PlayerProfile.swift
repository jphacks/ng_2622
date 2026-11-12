import Foundation

/// 自分の名前と色。初めて開いたときに名前を決め（色は自動）、設定で変える。端末に覚えておく
struct PlayerProfile: Sendable, Equatable {
  var name: String
  /// アバターの色（0xRRGGBB）
  var color: UInt32

  /// 名前の長さの上限
  static let maxNameLength = 10
  /// 選べる色
  static let colors: [UInt32] = [0x5B5BE6, 0xF07AA8, 0x2FAE9B, 0xF29A3A, 0xB06AD9, 0x3AA0E8]

  private static let nameKey = "player.name"
  private static let colorKey = "player.color"

  /// 名前がまだ無い。初めて開いたときの画面で決めてもらう
  var needsName: Bool {
    Self.trimmed(name).isEmpty
  }

  /// 最初の画面で決めた名前の profile。色は選べる色から自動で決める
  static func first(name: String, color: UInt32 = colors.randomElement() ?? colors[0]) -> PlayerProfile {
    PlayerProfile(name: trimmed(name), color: color)
  }

  /// 前後の空白を除いた名前
  static func trimmed(_ name: String) -> String {
    name.trimmingCharacters(in: .whitespaces)
  }

  /// 打っている名前を上限の長さで切る
  static func limited(_ name: String) -> String {
    name.count > maxNameLength ? String(name.prefix(maxNameLength)) : name
  }

  static func load(from defaults: UserDefaults = .standard) -> PlayerProfile {
    let name = defaults.string(forKey: nameKey) ?? ""
    let saved = UInt32(truncatingIfNeeded: defaults.integer(forKey: colorKey))
    return PlayerProfile(name: name, color: colors.contains(saved) ? saved : colors[0])
  }

  func save(to defaults: UserDefaults = .standard) {
    defaults.set(name, forKey: Self.nameKey)
    defaults.set(Int(color), forKey: Self.colorKey)
  }
}
