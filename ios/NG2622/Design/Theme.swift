import SwiftUI

// 見た目の色と文字。docs/design/ui/mocks/play.html の :root の値に合わせる
enum Theme {
  static let accent = Color(hex: 0x5B5BE6)
  static let accentShadow = Color(hex: 0x4343B8)
  static let accentSoft = Color(hex: 0xE3E3FB)
  static let background = Color(hex: 0xF7F7FB)
  static let ink = Color(hex: 0x14163A)
  static let muted = Color(hex: 0x6B6F8A)
  static let gray = Color(hex: 0x9A9DB3)
  static let line = Color(hex: 0xEEF0F5)
  static let offlineIcon = Color(hex: 0xE3E4EE)
  static let disabledBorder = Color(hex: 0xC9CBE0)
  static let red = Color(hex: 0xEF2B2B)
  static let card = Color.white

  /// 丸い太字（モックの Hiragino Maru Gothic の代わり）
  static func font(_ size: CGFloat, _ weight: Font.Weight = .heavy) -> Font {
    .system(size: size, weight: weight, design: .rounded)
  }
}

extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }
}

/// 横いっぱいの大きなボタン（「話し終えた」「締め切って発表する」など）
struct BigButtonStyle: ButtonStyle {
  enum Kind { case primary, outlined, plain }
  var kind: Kind = .primary

  func makeBody(configuration: Configuration) -> some View {
    BigButtonBody(configuration: configuration, kind: kind)
  }

  private struct BigButtonBody: View {
    let configuration: Configuration
    let kind: Kind
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
      let pressed = configuration.isPressed
      configuration.label
        .font(Theme.font(24, .heavy))
        .tracking(1)
        .frame(maxWidth: .infinity)
        .frame(height: 64)
        .foregroundStyle(foreground)
        .background(background)
        .overlay {
          if kind == .outlined {
            Capsule().strokeBorder(isEnabled ? Theme.accent : Theme.disabledBorder, lineWidth: 2.5)
          }
        }
        .clipShape(Capsule())
        .background {
          // primary だけ、下に濃い影を付けて押せるボタンに見せる
          if kind == .primary {
            Capsule().fill(Theme.accentShadow).offset(y: pressed ? 3 : 6)
          }
        }
        .offset(y: kind == .primary && pressed ? 3 : 0)
        .animation(.easeOut(duration: 0.08), value: pressed)
    }

    private var foreground: Color {
      switch kind {
      case .primary: .white
      case .outlined: isEnabled ? Theme.accent : Theme.gray
      case .plain: Theme.ink
      }
    }

    @ViewBuilder private var background: some View {
      switch kind {
      case .primary: Theme.accent
      case .outlined: Color.white
      case .plain: Theme.line
      }
    }
  }
}
