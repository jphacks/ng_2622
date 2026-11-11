import Foundation
import Testing

@testable import NG2622

/// きろくの推移の数え方と、Mock のきろく
struct PlayRecordTests {
  @Test("最初と最近は、最初の 3 回と最後の 3 回の平均")
  func firstAndRecentUsesWindow() throws {
    let trend = try #require(RecordTrend.firstAndRecent([50, 52, 54, 60, 70, 71, 72]))
    #expect(trend.first == 52)
    #expect(trend.recent == 71)
  }

  @Test("6 回に満たないときは、重ならないよう半分ずつにする")
  func firstAndRecentSplitsShortHistory() throws {
    let trend = try #require(RecordTrend.firstAndRecent([40, 50, 60, 70, 80]))
    #expect(trend.first == 45)
    #expect(trend.recent == 75)
  }

  @Test("1 回だけなら最近は無く、0 回なら何も出さない")
  func firstAndRecentWithFewRounds() throws {
    let one = try #require(RecordTrend.firstAndRecent([64]))
    #expect(one.first == 64)
    #expect(one.recent == nil)
    #expect(RecordTrend.firstAndRecent([]) == nil)
  }

  @Test("遊んだ日は、同じ日の何回かを 1 日と数える")
  func daysCountsDistinctDays() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = try #require(TimeZone(identifier: "Asia/Tokyo"))
    let base = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 20, hour: 10)))
    let records = [0.0, 3600, 86_400].map { offset in
      record(at: base.addingTimeInterval(offset))
    }
    #expect(RecordTrend.days(records, calendar: calendar) == 2)
  }

  @Test("Mock で採点できたラウンドは、きろくの先頭に足す。採点できなかったら足さない")
  @MainActor
  func mockAppendsGradedRounds() async throws {
    let client = MockPlayRecordClient()
    let before = try await client.myRecords().count
    let sceneID = try #require(ScenePool.bundled.randomCandidate())
    let graded = RoundResults.mock(
      sceneID: sceneID, players: [(id: "me", name: "わたなべ", color: 0, isSelf: true, graded: true)])
    client.append(graded, layout: nil)
    let ungraded = RoundResults.mock(
      sceneID: sceneID, players: [(id: "me", name: "わたなべ", color: 0, isSelf: true, graded: false)])
    client.append(ungraded, layout: nil)
    let after = try await client.myRecords()
    #expect(after.count == before + 1)
    #expect(after.first?.sceneID == sceneID)
    #expect(after.first?.me.score == graded.me?.score)
  }

  private func record(at date: Date) -> PlayRecord {
    PlayRecord(
      id: 1, playedAt: date, sceneID: "s", words: 5, layout: nil,
      me: PlayerResult(
        id: "me", name: "", color: 0, isSelf: true,
        score: .init(content: 50, expression: 50, speaking: 50, total: 50), transcript: "", content: nil),
      review: RoundResults.Review(
        nextStep: .init(kind: .content, text: "", item: nil, gain: nil), rewrite: nil,
        speechTip: .init(aspect: .fluency, text: "")))
  }
}
