import Foundation
import Testing

@testable import NG2622

/// 振り返りの下線（あなたの描写）と、見本の答えの印と強調
struct ReviewMarksTests {
  typealias Claim = ContentBreakdown.Claim

  func texts(_ text: String, _ marks: [MarkedRange]) -> [String] {
    marks.map { String(text[$0.range]) }
  }

  /// 描写を話した順に、前の描写が終わった位置から先で探す。同じ言い方が 2 回あっても、2 つ目は 2 つ目の場所に引く
  @Test func underlinesInOrder() {
    let transcript = "A man is reading. A cat is here. A man is reading. It is sunny."
    let claims = [
      Claim(quote: "A man is reading.", verdict: .correct, item: "a", level: .full, note: nil),
      Claim(quote: "A cat is here.", verdict: .absent, item: nil, level: nil, note: "猫はいません"),
      Claim(quote: "A man is reading.", verdict: .correct, item: "b", level: .partial, note: nil),
      Claim(quote: "It is sunny.", verdict: .correct, item: nil, level: nil, note: nil),
    ]
    let marks = TranscriptMarks.marks(transcript: transcript, claims: claims)
    #expect(marks.map(\.mark) == [.hit, .mismatch, .partial, .bonus])
    #expect(marks[2].range.lowerBound > marks[1].range.upperBound)
  }

  func marked(_ text: String, _ marks: [MarkedRange]) -> [String] {
    marks.map { "\(text[$0.range])=\($0.mark)" }
  }

  /// 文字起こしに無い描写には線を引かない
  @Test func skipsMissingQuotes() {
    let transcript = "A boy is running."
    let claims = [
      Claim(quote: "A girl is dancing.", verdict: .absent, item: nil, level: nil, note: nil),
      Claim(quote: "A boy is running.", verdict: .correct, item: "run", level: .full, note: nil),
    ]
    let marks = TranscriptMarks.marks(transcript: transcript, claims: claims)
    #expect(marked(transcript, marks) == ["A boy is running.=hit"])
  }

  /// 前の描写の内側に入る短い引用（始まりの位置で並ぶ）でも、後ろの描写が消えない。
  /// 探す順はバックエンドと同じ（前の描写の終わりから → 前の描写の始まりから → 頭から）
  @Test func quotesInsidePreviousClaim() {
    let transcript = "A woman is sitting on the bench because she is tired. A man is reading on the bench."
    let claims = [
      Claim(
        quote: "A woman is sitting on the bench because she is tired", verdict: .correct, item: "why", level: .partial,
        note: nil),
      Claim(quote: "A woman is sitting", verdict: .correct, item: "sit", level: .full, note: nil),
      Claim(quote: "on the bench", verdict: .correct, item: nil, level: nil, note: nil),
      Claim(quote: "A man is reading", verdict: .correct, item: "read", level: .full, note: nil),
      Claim(quote: "on the bench", verdict: .correct, item: "bench", level: .full, note: nil),
    ]
    let marks = TranscriptMarks.marks(transcript: transcript, claims: claims)
    #expect(
      marked(transcript, marks) == [
        "A woman is sitting=hit", " on the bench because she is tired=partial", "A man is reading=hit",
        "on the bench=hit",
      ])
  }

  /// 中心 → 理由の順で重なっても、中心の所は中心の線、because から先に理由の線が付く
  @Test func centerThenReason() {
    let transcript = "A boy is running because it is raining."
    let claims = [
      Claim(quote: "A boy is running", verdict: .correct, item: "run", level: .full, note: nil),
      Claim(quote: "A boy is running because it is raining", verdict: .correct, item: "why", level: .partial, note: nil),
    ]
    let marks = TranscriptMarks.marks(transcript: transcript, claims: claims)
    #expect(marked(transcript, marks) == ["A boy is running=hit", " because it is raining=partial"])
  }

  /// 同じ言い回しが前の引用の内側と後ろの両方にあるとき、後ろの方を先に探す（バックエンドと同じ）。
  /// 内側の分は前の描写の線に覆われるので、どちらの線も消えない
  @Test func sameWordsInsideAndAfter() {
    let transcript = "A dog is sleeping under the tree. A cat is under the tree."
    let claims = [
      Claim(quote: "A dog is sleeping under the tree", verdict: .correct, item: "dog", level: .full, note: nil),
      Claim(quote: "under the tree", verdict: .correct, item: nil, level: nil, note: nil),
      Claim(quote: "A cat is", verdict: .absent, item: nil, level: nil, note: "猫はいません"),
    ]
    let marks = TranscriptMarks.marks(transcript: transcript, claims: claims)
    #expect(
      marked(transcript, marks) == ["A dog is sleeping under the tree=hit", "A cat is=mismatch", "under the tree=bonus"])
  }

  /// 見本の答えの強調は、重なればつなぎ、前から順に並べる
  @Test func mergeHighlights() {
    let text = "A boy is running because it is raining."
    func r(_ a: Int, _ b: Int) -> MarkedRange {
      MarkedRange(range: text.index(text.startIndex, offsetBy: a)..<text.index(text.startIndex, offsetBy: b), mark: .highlight)
    }
    let merged = ModelAnswerLines.merge([r(17, 38), r(0, 16), r(10, 20)])
    #expect(texts(text, merged) == ["A boy is running because it is raining"])
    #expect(texts(text, ModelAnswerLines.merge([r(17, 24), r(0, 5)])) == ["A boy", "because"])
  }

  /// accept の " / " の 2 つ目以降の言い方でも文と結ぶ。’ と ' は同じとみなす
  @Test func otherAcceptsAndApostrophe() {
    let checklist = [
      SceneLayout.ChecklistItem(
        id: "why", kind: .reason, label: "理由", accept: "because it is raining / because he doesn't have an umbrella")
    ]
    let lines = ModelAnswerLines.lines(
      description: "The boy is running because he doesn’t have an umbrella.", checklist: checklist,
      items: [.init(id: "why", kind: .reason, label: "", level: .partial)])
    #expect(lines.first?.level == .partial)
    #expect(texts(lines[0].text, lines[0].marks) == ["because he doesn’t have an umbrella"])
  }

  @Test func sentences() {
    #expect(
      ModelAnswerLines.sentences("It is raining. A boy is running! Is he late? Yes.")
        == ["It is raining.", "A boy is running!", "Is he late?", "Yes."])
    #expect(ModelAnswerLines.sentences("Mr. Tanaka") == ["Mr.", "Tanaka"])
  }

  /// accept の 1 つ目の言い方で文と項目を結ぶ。大文字小文字と句読点は見ない。
  /// 印は、全部 full なら full・全部 none なら none・ほかは partial、項目が無ければ nil。
  /// まだ言えていない項目の所を強調し、理由（reason・link）は because からを強調する
  @Test func modelAnswerLines() {
    let checklist = [
      SceneLayout.ChecklistItem(id: "girl", kind: .center, label: "女の子", accept: "a girl is holding an umbrella"),
      SceneLayout.ChecklistItem(id: "run", kind: .center, label: "男の子", accept: "a boy is running"),
      SceneLayout.ChecklistItem(
        id: "why", kind: .reason, label: "理由",
        accept: "a boy is running to the bus stop because it is raining / because he has no umbrella"),
      SceneLayout.ChecklistItem(id: "man", kind: .center, label: "男の人", accept: "a man is reading a book"),
    ]
    let items: [ContentBreakdown.Item] = [
      .init(id: "girl", kind: .center, label: "", level: .full),
      .init(id: "run", kind: .center, label: "", level: .full),
      .init(id: "why", kind: .reason, label: "", level: .partial),
      .init(id: "man", kind: .center, label: "", level: .none),
    ]
    let description =
      "It is raining at the bus stop. A girl is holding an umbrella. A boy is running to the bus stop, because it is raining. A MAN is reading a book."
    let lines = ModelAnswerLines.lines(description: description, checklist: checklist, items: items)
    #expect(lines.map(\.level) == [nil, .full, .partial, Optional(ContentBreakdown.Level.none)])
    #expect(lines[0].marks.isEmpty)
    #expect(lines[1].marks.isEmpty)
    #expect(texts(lines[2].text, lines[2].marks) == ["because it is raining"])
    #expect(texts(lines[3].text, lines[3].marks) == ["A MAN is reading a book"])
    // 自分の達成が無い（採点の内訳が無い）ときは、どの項目も none とみなす
    let none = ModelAnswerLines.lines(description: description, checklist: checklist, items: [])
    let noneLevel: ContentBreakdown.Level? = ContentBreakdown.Level.none
    #expect(none.map(\.level) == [nil, noneLevel, noneLevel, noneLevel])
  }

  /// 同梱の場面で作る Mock の結果: 自分は下線・チップ・合わない描写・次の一つ・言い直し・話し方が全部そろい、
  /// 描写の引用はどれも文字起こしの中に見つかる。3 語未満の人と、採点できなかった人もいる
  @Test func mockResults() throws {
    let sceneID = try #require(ScenePool.bundled.randomCandidate())
    let results = RoundResults.mock(
      sceneID: sceneID,
      players: [
        ("me", "ゆうき", 0x5B5BE6, true, true),
        ("p0", "たろう", 0xF29A3A, false, true),
        ("p1", "はなこ", 0xB06AD9, false, true),
        ("p2", "けん", 0x2FAE9B, false, true),
        ("p3", "みさき", 0xE5568A, false, false),
      ])
    let me = try #require(results.me)
    let content = try #require(me.content)
    let marks = TranscriptMarks.marks(transcript: me.transcript, claims: content.claims)
    #expect(marks.count == content.claims.count)
    #expect(Set(marks.map(\.mark)).isSuperset(of: [.hit, .partial, .bonus, .mismatch]))
    #expect(content.fullCount > 0 && content.partialCount > 0 && content.mismatchCount > 0)
    #expect(content.items.contains { $0.level == .none })
    let review = try #require(results.myReview)
    #expect(review.nextStep.badge != nil)
    #expect(review.rewrite != nil)
    // 3 語未満の人は、描写が空で項目が全部 none
    let short = try #require(results.players.first { $0.transcript.split(separator: " ").count < 3 && $0.score != nil })
    #expect(short.content?.claims.isEmpty == true)
    #expect(short.content?.items.allSatisfy { $0.level == .none } == true)
    #expect(results.players.last?.content == nil)
    #expect(results.players.last?.score == nil)
    // 見本の答えには、言えた文も、まだの所の強調もある
    let layout = try MockSceneLayoutClient.read(sceneID)
    let lines = ModelAnswerLines.lines(description: layout.description ?? "", checklist: layout.checklist, items: content.items)
    #expect(lines.contains { $0.level == .full })
    #expect(lines.contains { !$0.marks.isEmpty })
  }
}
