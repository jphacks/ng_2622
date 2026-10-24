import AVFoundation
import SwiftUI

/// マイクの許可。カウントダウンの途中で確認が出ないよう、部屋に入る前に聞く
enum MicPermission {
  /// まだ聞いていなければ聞く。許可されているかを返す
  @discardableResult
  static func request() async -> Bool {
    switch AVAudioApplication.shared.recordPermission {
    case .granted: return true
    case .undetermined: return await AVAudioApplication.requestRecordPermission()
    default: return false
    }
  }

  static var isDenied: Bool {
    AVAudioApplication.shared.recordPermission == .denied
  }
}

/// マイクが許可されていないときの知らせ。録音せずに遊べるので、設定を開くボタンだけ添える
struct MicDeniedNotice: View {
  @Environment(\.openURL) private var openURL

  var body: some View {
    HStack(spacing: 12) {
      Text("マイクが許可されていないので、声は録音されません")
        .font(Theme.font(13, .bold))
        .foregroundStyle(Theme.muted)
        .fixedSize(horizontal: false, vertical: true)
      Spacer(minLength: 0)
      Button("設定を開く") {
        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
      }
      .font(Theme.font(14, .heavy))
      .foregroundStyle(Theme.accent)
    }
    .frame(maxWidth: 346)
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
  }
}
