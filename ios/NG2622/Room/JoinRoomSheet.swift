import SwiftUI

/// 待合（ホスト）の「他のルーム」で開くシート。QR を読み取るか、ほかの部屋の 4 桁のコードを打つと、
/// そろったところで自動で、その部屋に入れそうかを確かめる。入れそうなら onFound を呼ぶ（移るのは待合が行う）
struct JoinRoomSheet: View {
  /// コードの部屋に入れそうかを確かめる。入れないと投げる
  let check: (String) async throws -> Void
  /// 確かめたコード
  let onFound: (String) -> Void

  @State private var code = ""
  @State private var checking = false
  /// 入れなかった理由
  @State private var failure: String?
  /// 間違えたときに横に揺らす回数
  @State private var shakes = 0
  @State private var scanning = false
  /// QR から読めたコード。カメラを閉じてから入れる
  @State private var scannedCode: String?
  /// QR を読めた回数（手ざわりで知らせる）
  @State private var scans = 0
  /// この端末で QR を読めないときの一言
  @State private var scanNote: String?

  private static let length = RoomLink.codeLength

  var body: some View {
    VStack(spacing: 0) {
      Text("他のルームに入る")
        .font(Theme.font(24, .black))
        .padding(.top, 30)
        .padding(.bottom, 20)
      scanButton
      Text("部屋のコード")
        .font(Theme.font(17, .heavy))
        .foregroundStyle(Theme.muted)
        .padding(.top, 22)
        .padding(.bottom, 12)
      codeBoxes
        .modifier(Shake(amount: CGFloat(shakes)))
        .animation(.linear(duration: 0.35), value: shakes)
      ZStack {
        if let failure {
          Text(failure)
            .foregroundStyle(Theme.red)
        } else if checking {
          ProgressView().tint(Theme.accent)
        } else if let scanNote {
          Text(scanNote)
            .foregroundStyle(Theme.muted)
        }
      }
      .font(Theme.font(15, .heavy))
      .frame(height: 40)
      Spacer(minLength: 0)
      keypad
        .padding(.bottom, 12)
    }
    .frame(width: 346)
    .frame(maxWidth: .infinity)
    .fullScreenCover(isPresented: $scanning, onDismiss: enterScanned) {
      QRScannerView(
        onCode: { code in
          scannedCode = code
          scans += 1
          scanning = false
        },
        onCancel: { scanning = false }
      )
    }
    .sensoryFeedback(.success, trigger: scans)
  }

  /// 入れなかった理由の一言
  static func message(for error: any Error) -> String {
    switch error {
    case RoomSession.MoveError.sameRoom: "いまいる部屋です"
    case GameError.roomFull: "満員で入れません"
    case GameError.alreadyStarted: "ゲーム中で入れません"
    case GameError.connectionFailed: "つながりませんでした"
    default: "部屋が見つかりません"
    }
  }

  /// 「QR を読み取る」。読めない端末では、押したときに理由を出す
  private var scanButton: some View {
    Button {
      failure = nil
      scanNote = QRScannerView.unavailableReason
      if scanNote == nil { scanning = true }
    } label: {
      Label("QR を読み取る", systemImage: "qrcode.viewfinder")
        .font(Theme.font(17, .heavy))
        .foregroundStyle(Theme.accent)
        .frame(maxWidth: .infinity)
        .frame(height: 52)
        .background(.white, in: Capsule())
        .overlay { Capsule().strokeBorder(Theme.accent, lineWidth: 2.5) }
    }
    .disabled(checking)
  }

  /// QR から読めたコードを、打ったときと同じように確かめる
  private func enterScanned() {
    guard let scanned = scannedCode else { return }
    scannedCode = nil
    failure = nil
    code = scanned
    submit()
  }

  private var codeBoxes: some View {
    HStack(spacing: 12) {
      ForEach(0..<Self.length, id: \.self) { i in
        let digit = i < code.count ? String(Array(code)[i]) : ""
        let isCursor = i == code.count && !checking
        Text(digit)
          .font(Theme.font(44, .black))
          .monospacedDigit()
          .frame(maxWidth: .infinity)
          .frame(height: 84)
          .background(.white, in: RoundedRectangle(cornerRadius: 20))
          .overlay {
            RoundedRectangle(cornerRadius: 20)
              .strokeBorder(failure != nil ? Theme.red : isCursor ? Theme.accent : Theme.line, lineWidth: 2.5)
          }
          .animation(.spring(duration: 0.2, bounce: 0.4), value: digit)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("部屋のコード \(code)")
  }

  private var keypad: some View {
    let rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "del"]]
    return VStack(spacing: 10) {
      ForEach(rows, id: \.self) { row in
        HStack(spacing: 10) {
          ForEach(row, id: \.self) { key in
            if key.isEmpty {
              Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
              Button {
                press(key)
              } label: {
                Group {
                  if key == "del" {
                    Image(systemName: "delete.left").font(.system(size: 22, weight: .bold))
                  } else {
                    Text(key).font(Theme.font(28, .heavy))
                  }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
              }
              .buttonStyle(KeyStyle(isSub: key == "del"))
              .accessibilityLabel(key == "del" ? "1 文字消す" : key)
            }
          }
        }
        .frame(height: 58)
      }
    }
    .disabled(checking)
  }

  private func press(_ key: String) {
    failure = nil
    scanNote = nil
    if key == "del" {
      if !code.isEmpty { code.removeLast() }
      return
    }
    guard code.count < Self.length else { return }
    code.append(key)
    if code.count == Self.length { submit() }
  }

  private func submit() {
    checking = true
    let entered = code
    Task {
      do {
        try await check(entered)
        onFound(entered)
      } catch {
        failure = Self.message(for: error)
        shakes += 1
        code = ""
      }
      checking = false
    }
  }
}

/// テンキーの 1 つのキー
private struct KeyStyle: ButtonStyle {
  let isSub: Bool

  func makeBody(configuration: Configuration) -> some View {
    let pressed = configuration.isPressed
    configuration.label
      .foregroundStyle(isSub ? Theme.muted : Theme.ink)
      .background(
        isSub ? Color.clear : pressed ? Theme.accentSoft : .white,
        in: RoundedRectangle(cornerRadius: 16)
      )
      .background {
        if !isSub {
          RoundedRectangle(cornerRadius: 16).fill(Theme.line).offset(y: pressed ? 0 : 3)
        }
      }
      .offset(y: pressed && !isSub ? 2 : 0)
  }
}

/// 横に揺らす（amount が 1 増えるごとに 1 回）
private struct Shake: GeometryEffect {
  var amount: CGFloat
  var animatableData: CGFloat {
    get { amount }
    set { amount = newValue }
  }

  func effectValue(size: CGSize) -> ProjectionTransform {
    ProjectionTransform(CGAffineTransform(translationX: 6 * sin(amount * .pi * 4), y: 0))
  }
}
