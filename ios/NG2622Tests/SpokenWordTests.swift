import Testing

@testable import NG2622

/// 振り返りの単語の聞き比べ: 文字起こしの語と Azure の単語の当て方、録音から流す範囲
struct SpokenWordTests {
  private func word(_ w: String, _ accuracy: Int = 90, at offsetMs: Int = 0) -> SpokenWord {
    SpokenWord(word: w, accuracy: accuracy, offsetMs: offsetMs, durationMs: 300)
  }

  /// 大文字・記号つきの文字起こしの語に、記号の無い小文字の単語を前から当てる
  @Test func alignsTokensIgnoringCaseAndPunctuation() {
    let words = [word("there's"), word("a"), word("dog", 40), word("near"), word("the"), word("bench")]
    let tokens = SpokenWord.align(transcript: "There’s a dog, near the bench.", words: words)
    #expect(tokens.map(\.token) == ["There’s", "a", "dog,", "near", "the", "bench."])
    #expect(tokens.map(\.word) == words)
  }

  /// Azure が落とした語は押せない（nil）。そのあとの語は続けて当てる
  @Test func skipsTokensAzureDropped() {
    let words = [word("a"), word("dog"), word("runs")]
    let tokens = SpokenWord.align(transcript: "A, um, dog runs", words: words)
    #expect(tokens.map { $0.word?.word } == ["a", nil, "dog", "runs"])
  }

  /// 同じ語が 2 回出ても、それぞれ自分の位置の単語に当たる
  @Test func repeatedWordsKeepOrder() {
    let words = [word("a", at: 0), word("dog", at: 400), word("and", at: 800), word("a", at: 1200), word("cat", at: 1600)]
    let tokens = SpokenWord.align(transcript: "A dog and a cat", words: words)
    #expect(tokens.compactMap { $0.word?.offsetMs } == [0, 400, 800, 1200, 1600])
  }

  /// 流す範囲は前後に余白を足し、録音の頭より前にはしない
  @Test func segmentAddsMargins() {
    let s = SpokenWord(word: "dog", accuracy: 40, offsetMs: 1000, durationMs: 300).segment
    #expect(abs(s.lowerBound - 0.92) < 0.0001)
    #expect(abs(s.upperBound - 1.42) < 0.0001)
    #expect(SpokenWord(word: "a", accuracy: 90, offsetMs: 20, durationMs: 50).segment.lowerBound == 0)
  }
}
