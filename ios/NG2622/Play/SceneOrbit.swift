import Observation
import QuartzCore

/// 3D の向き。回転中は自動で 1 周させ、録音中は指で回す。
/// 横（yaw）は何周でも回せ、縦（見下ろす角度）は minTilt〜maxTilt の間だけ動かせる
@Observable
final class SceneOrbit {
  static let defaultTilt = 28.0
  static let minTilt = 10.0
  static let maxTilt = 75.0

  private(set) var yaw = 0.0
  private(set) var tilt = SceneOrbit.defaultTilt
  private(set) var isResetting = false

  /// 初期の向きから回したか
  var isTurned: Bool {
    abs(yaw) > 0.5 || abs(tilt - Self.defaultTilt) > 0.5
  }

  @ObservationIgnored private var ticker: FrameTicker?

  /// startsAt から duration 秒で 1 周させる
  func spin(from startsAt: Date, duration: TimeInterval) {
    run { [weak self] _ in
      guard let self else { return false }
      let p = min(1, max(0, Date().timeIntervalSince(startsAt) / duration))
      if p >= 1 {
        yaw = 0
        return false
      }
      yaw = p * 360
      return true
    }
  }

  /// 指で動かした量（pt）だけ回す
  func drag(dx: Double, dy: Double) {
    stop()
    yaw += dx * 0.6
    tilt = min(Self.maxTilt, max(Self.minTilt, tilt + dy * 0.4))
  }

  /// 初期の向きに戻す。横は近い向きから戻す
  func reset() {
    guard isTurned else { return }
    yaw = (yaw.truncatingRemainder(dividingBy: 360) + 540).truncatingRemainder(dividingBy: 360) - 180
    isResetting = true
    run { [weak self] dt in
      guard let self else { return false }
      // モックの「1 フレーム（60fps）ごとに 0.8 倍」を、時間に合わせて掛ける
      let frames = dt * 60
      yaw *= pow(0.8, frames)
      tilt += (Self.defaultTilt - tilt) * (1 - pow(0.8, frames))
      if !isTurned {
        yaw = 0
        tilt = Self.defaultTilt
        isResetting = false
        return false
      }
      return true
    }
  }

  func stop() {
    ticker?.invalidate()
    ticker = nil
    isResetting = false
  }

  private func run(_ step: @escaping (TimeInterval) -> Bool) {
    stop()
    ticker = FrameTicker(step)
  }
}

/// 画面の更新ごとに呼ぶ。step が false を返すと止まる
final class FrameTicker {
  private var link: CADisplayLink?
  private let step: (TimeInterval) -> Bool
  private var last: CFTimeInterval?

  init(_ step: @escaping (TimeInterval) -> Bool) {
    self.step = step
    let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  func invalidate() {
    link?.invalidate()
    link = nil
  }

  @objc private func tick(_ link: CADisplayLink) {
    let dt = last.map { link.timestamp - $0 } ?? 1 / 60
    last = link.timestamp
    if !step(dt) { invalidate() }
  }
}
