import AVFoundation
import SwiftUI
import UIKit
import VisionKit

/// 部屋の QR を読む全画面のカメラ。部屋の QR が読めたら、そのコードを渡す（room.html の読み取りの画面）
struct QRScannerView: View {
  /// 読めた部屋のコード（4 桁）
  let onCode: (String) -> Void
  let onCancel: () -> Void

  @State private var camera = AVCaptureDevice.authorizationStatus(for: .video)
  /// 部屋の QR ではないものを読んだときの一言
  @State private var hint: String?
  @State private var hintTask: Task<Void, Never>?
  @State private var done = false

  private static let ink = Color(hex: 0x0D0F24)

  var body: some View {
    ZStack {
      Self.ink.ignoresSafeArea()
      switch camera {
      case .denied, .restricted:
        deniedNotice
      default:
        // 許可を待つ間は枠だけを出し、許可されたらカメラを映す
        if camera == .authorized {
          DataScanner(onPayload: read).ignoresSafeArea()
        }
        overlay
      }
    }
    .foregroundStyle(.white)
    .task {
      // まだ聞いていなければ、ここでカメラの許可を聞く
      if camera == .notDetermined {
        let granted = await AVCaptureDevice.requestAccess(for: .video)
        camera = granted ? .authorized : .denied
      }
    }
  }

  private var overlay: some View {
    VStack(spacing: 0) {
      Text("QR を枠に合わせてください")
        .font(Theme.font(20, .heavy))
        .padding(.top, 70)
      Text("ホストの待合の画面に出ている QR")
        .font(Theme.font(14, .bold))
        .foregroundStyle(.white.opacity(0.7))
        .padding(.top, 8)

      RoundedRectangle(cornerRadius: 28)
        .strokeBorder(Theme.accent, lineWidth: 5)
        .shadow(color: Theme.accent.opacity(0.8), radius: 12)
        .frame(width: 250, height: 250)
        .padding(.top, 50)
        .accessibilityHidden(true)

      ZStack {
        if let hint {
          Text(hint)
            .font(Theme.font(15, .heavy))
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Theme.red, in: Capsule())
            .transition(.scale(scale: 0.8).combined(with: .opacity))
        }
      }
      .frame(height: 60)
      .padding(.top, 16)
      .animation(.spring(duration: 0.25, bounce: 0.4), value: hint)

      Spacer()
      cancelButton
        .padding(.bottom, 30)
    }
  }

  /// カメラを断られているときの案内
  private var deniedNotice: some View {
    VStack(spacing: 16) {
      Spacer()
      Image(systemName: "camera.fill")
        .font(.system(size: 44, weight: .bold))
        .foregroundStyle(Theme.accentSoft)
      Text("カメラが使えません")
        .font(Theme.font(22, .heavy))
      Text("QR を読み取るには、設定でカメラを許可してください")
        .font(Theme.font(15, .bold))
        .foregroundStyle(.white.opacity(0.7))
        .multilineTextAlignment(.center)
      Button("設定を開く") {
        if let url = URL(string: UIApplication.openSettingsURLString) {
          UIApplication.shared.open(url)
        }
      }
      .buttonStyle(BigButtonStyle())
      .padding(.top, 12)
      Spacer()
      cancelButton
        .padding(.bottom, 30)
    }
    .padding(.horizontal, 32)
  }

  private var cancelButton: some View {
    Button("キャンセル", action: onCancel)
      .font(Theme.font(17, .bold))
      .foregroundStyle(.white)
      .padding(.horizontal, 30)
      .padding(.vertical, 12)
      .background(.white.opacity(0.15), in: RoundedRectangle(cornerRadius: 16))
  }

  private func read(_ payload: String) {
    guard !done else { return }
    if let code = RoomLink.code(from: payload) {
      done = true
      onCode(code)
      return
    }
    hint = "ScenEnglish の部屋の QR ではありません"
    hintTask?.cancel()
    hintTask = Task {
      try? await Task.sleep(for: .seconds(2))
      if !Task.isCancelled { hint = nil }
    }
  }
}

extension QRScannerView {
  /// この端末で QR を読めるか。読めないときは理由の一言
  static var unavailableReason: String? {
    if !DataScannerViewController.isSupported { return "この端末では QR を読み取れません" }
    // 許可をまだ聞いていない・断られたときは、開いた先で聞く・案内する
    let status = AVCaptureDevice.authorizationStatus(for: .video)
    if status == .authorized, !DataScannerViewController.isAvailable { return "いまはカメラを使えません" }
    if status == .restricted { return "この端末ではカメラが制限されています" }
    return nil
  }
}

/// VisionKit の DataScannerViewController を SwiftUI で使う。QR だけを読む
private struct DataScanner: UIViewControllerRepresentable {
  let onPayload: (String) -> Void

  func makeUIViewController(context: Context) -> DataScannerViewController {
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: [.qr])],
      qualityLevel: .balanced,
      isHighlightingEnabled: false
    )
    scanner.delegate = context.coordinator
    return scanner
  }

  func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
    context.coordinator.onPayload = onPayload
    if !scanner.isScanning { try? scanner.startScanning() }
  }

  static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
    scanner.stopScanning()
  }

  func makeCoordinator() -> Coordinator { Coordinator(onPayload: onPayload) }

  final class Coordinator: NSObject, DataScannerViewControllerDelegate {
    var onPayload: (String) -> Void

    init(onPayload: @escaping (String) -> Void) {
      self.onPayload = onPayload
    }

    func dataScanner(
      _ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem],
      allItems: [RecognizedItem]
    ) {
      for item in addedItems {
        if case .barcode(let barcode) = item, let payload = barcode.payloadStringValue {
          onPayload(payload)
        }
      }
    }
  }
}
