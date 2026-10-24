import Foundation

/// ホームで決める自分の名前と色。端末に覚えておく
struct PlayerProfile: Sendable, Equatable {
  var name: String
  /// アバターの色（0xRRGGBB）
  var color: UInt32

  /// 名前の長さの上限
  static let maxNameLength = 10
  /// ホームで選べる色
  static let colors: [UInt32] = [0x5B5BE6, 0xF07AA8, 0x2FAE9B, 0xF29A3A, 0xB06AD9, 0x3AA0E8]

  private static let nameKey = "player.name"
  private static let colorKey = "player.color"

  static func load() -> PlayerProfile {
    let defaults = UserDefaults.standard
    let name = defaults.string(forKey: nameKey) ?? ""
    let saved = UInt32(truncatingIfNeeded: defaults.integer(forKey: colorKey))
    return PlayerProfile(name: name, color: colors.contains(saved) ? saved : colors[0])
  }

  func save() {
    UserDefaults.standard.set(name, forKey: Self.nameKey)
    UserDefaults.standard.set(Int(color), forKey: Self.colorKey)
  }
}
