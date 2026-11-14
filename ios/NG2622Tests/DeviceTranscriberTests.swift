import Foundation
import Synchronization
import Testing

@testable import NG2622

/// 文字起こしの時間切れ（DeviceTranscriber.first）。文字起こし（SpeechAnalyzer）が取り消しに応じなくても、
/// 時間切れで必ず戻ること（戻らないと音声を送らず、サーバーの締め切りで「採点できませんでした」になる）
struct DeviceTranscriberTests {
  /// 取り消しに応じずに seconds 秒待つ。取り消しに応じない SpeechAnalyzer の代わり
  nonisolated static func waitIgnoringCancellation(_ seconds: Double) async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      DispatchQueue.global().asyncAfter(deadline: .now() + seconds) { continuation.resume() }
    }
  }

  /// 取り消されたかを覚えておく
  nonisolated final class Flag: Sendable {
    private let value = Mutex(false)
    var isSet: Bool { value.withLock { $0 } }
    func set() { value.withLock { $0 = true } }
  }

  /// 取り消しを無視して 10 秒かかる仕事でも、時間切れ（0.2 秒）の少し後に nil で戻る
  @Test func returnsNilOnTimeoutEvenIfWorkIgnoresCancellation() async {
    let clock = ContinuousClock()
    let started = clock.now
    let text = await DeviceTranscriber.first(within: .milliseconds(200)) {
      await Self.waitIgnoringCancellation(10)
      return "too late"
    }
    let elapsed = clock.now - started
    #expect(text == nil)
    #expect(elapsed >= .milliseconds(200))
    #expect(elapsed < .seconds(2))
  }

  /// 時間切れのときは、仕事を取り消す（文字起こしを止めさせる）
  @Test func cancelsWorkOnTimeout() async {
    let cancelled = Flag()
    let text = await DeviceTranscriber.first(within: .milliseconds(100)) {
      await withTaskCancellationHandler {
        await Self.waitIgnoringCancellation(10)
        return "too late"
      } onCancel: {
        cancelled.set()
      }
    }
    #expect(text == nil)
    // 仕事が時間切れより後に始まっても、始まったところで取り消しに気づく。少し待ちながら確かめる
    let deadline = ContinuousClock.now + .seconds(2)
    while !cancelled.isSet, ContinuousClock.now < deadline {
      try? await Task.sleep(for: .milliseconds(10))
    }
    #expect(cancelled.isSet)
  }

  /// 時間切れより早く返る仕事は、その値を返す。時間切れまで待たない
  @Test func returnsValueOfFastWork() async {
    let clock = ContinuousClock()
    let started = clock.now
    let text = await DeviceTranscriber.first(within: .seconds(5)) {
      try? await Task.sleep(for: .milliseconds(50))
      return "A boy is reading a book."
    }
    #expect(text == "A boy is reading a book.")
    #expect(clock.now - started < .seconds(2))
  }

  /// 早く nil を返した（聞き取れなかった・使えない）ときも、時間切れまで待たずに nil を返す
  @Test func returnsNilOfFastWorkWithoutWaiting() async {
    let clock = ContinuousClock()
    let started = clock.now
    let text = await DeviceTranscriber.first(within: .seconds(5)) { nil }
    #expect(text == nil)
    #expect(clock.now - started < .seconds(2))
  }
}
