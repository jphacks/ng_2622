import SwiftUI

/// 英文の一部に付ける印（振り返りの「あなたの描写」の下線と、「見本の答え」のまだ言えていない所の強調）
enum TextMark: Hashable, Sendable {
  /// チェックの項目に当たった描写（濃い下線）
  case hit
  /// 項目に一部だけ当たった描写（濃い破線）
  case partial
  /// 一覧に無い正しい描写（おまけ。細い灰色の下線）
  case bonus
  /// 場面と合わない描写（赤の波線）
  case mismatch
  /// まだ言えていない所（薄い色の地）
  case highlight
}

/// 文の中の印の付いた範囲
struct MarkedRange: Equatable {
  let range: Range<String.Index>
  let mark: TextMark
}

/// 印の付いた範囲を Text にする。範囲は重ならず、前から順に並んでいること
func markedText(_ text: String, marks: [MarkedRange]) -> Text {
  var result = Text(verbatim: "")
  var cursor = text.startIndex
  for m in marks where m.range.lowerBound >= cursor {
    if cursor < m.range.lowerBound {
      let plain = Text(verbatim: String(text[cursor..<m.range.lowerBound]))
      result = Text("\(result)\(plain)")
    }
    let marked = Text(verbatim: String(text[m.range])).customAttribute(TextMarkAttribute(mark: m.mark))
    result = Text("\(result)\(marked)")
    cursor = m.range.upperBound
  }
  if cursor < text.endIndex {
    let rest = Text(verbatim: String(text[cursor...]))
    result = Text("\(result)\(rest)")
  }
  return result
}

struct TextMarkAttribute: TextAttribute {
  let mark: TextMark
}

/// TextMarkAttribute の付いた所に、下線・破線・波線・地の色を描く。地は文字の下に、線は文字の後に描く
struct MarkedTextRenderer: TextRenderer {
  var displayPadding: EdgeInsets { EdgeInsets(top: 2, leading: 2, bottom: 6, trailing: 2) }

  func draw(layout: Text.Layout, in ctx: inout GraphicsContext) {
    for line in layout {
      for run in line {
        let mark = run[TextMarkAttribute.self]?.mark
        let rect = run.typographicBounds.rect
        if mark == .highlight {
          let box = rect.insetBy(dx: -3, dy: -1)
          ctx.fill(Path(roundedRect: box, cornerRadius: 6), with: .color(Theme.accentSoft))
        }
        ctx.draw(run)
        guard let mark, mark != .highlight else { continue }
        let y = rect.maxY + 1.5
        var line = Path()
        switch mark {
        case .mismatch:
          line = Self.wave(from: rect.minX, to: rect.maxX, y: y + 0.5)
          ctx.stroke(line, with: .color(Theme.red), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
        case .hit, .partial:
          line.move(to: CGPoint(x: rect.minX, y: y))
          line.addLine(to: CGPoint(x: rect.maxX, y: y))
          let dash: [CGFloat] = mark == .partial ? [5, 3.5] : []
          ctx.stroke(line, with: .color(Theme.accent), style: StrokeStyle(lineWidth: 2.4, lineCap: .round, dash: dash))
        case .bonus:
          line.move(to: CGPoint(x: rect.minX, y: y))
          line.addLine(to: CGPoint(x: rect.maxX, y: y))
          ctx.stroke(line, with: .color(Theme.gray), style: StrokeStyle(lineWidth: 1.3, lineCap: .round))
        case .highlight:
          break
        }
      }
    }
  }

  /// 波線（振れ幅 1.6pt・1 周 6pt）
  static func wave(from x0: CGFloat, to x1: CGFloat, y: CGFloat) -> Path {
    var path = Path()
    let amplitude: CGFloat = 1.6
    let period: CGFloat = 6
    var x = x0
    path.move(to: CGPoint(x: x, y: y))
    while x < x1 {
      x = min(x1, x + 0.75)
      path.addLine(to: CGPoint(x: x, y: y + amplitude * sin((x - x0) / period * 2 * .pi)))
    }
    return path
  }
}

// MARK: - 下線と強調の位置

enum TranscriptMarks {
  /// 描写の印。描写を話した順に、前の描写が終わった位置から先で quote をそのまま探す。見つからない描写には線を引かない
  static func marks(transcript: String, claims: [ContentBreakdown.Claim]) -> [MarkedRange] {
    var cursor = transcript.startIndex
    var result: [MarkedRange] = []
    for claim in claims where !claim.quote.isEmpty {
      guard let range = transcript.range(of: claim.quote, range: cursor..<transcript.endIndex) else { continue }
      result.append(MarkedRange(range: range, mark: mark(of: claim)))
      cursor = range.upperBound
    }
    return result
  }

  static func mark(of claim: ContentBreakdown.Claim) -> TextMark {
    guard claim.verdict == .correct else { return .mismatch }
    guard claim.item != nil else { return .bonus }
    return claim.level == .partial ? .partial : .hit
  }
}

/// 見本の答え（場面の description）を 1 文ずつに分け、チェックリストの項目と結ぶ
enum ModelAnswerLines {
  struct Line: Identifiable, Equatable {
    let id: Int
    let text: String
    /// 文に結んだ項目の達成をまとめた印。全部 full なら full、全部 none なら none、ほかは partial。項目が無ければ nil
    let level: ContentBreakdown.Level?
    /// まだ言えていない所（薄い色の地）
    let marks: [MarkedRange]
  }

  /// 文に分ける。. ! ? のあとに空白が続く所で切る
  static func sentences(_ text: String) -> [String] {
    var result: [String] = []
    var current = ""
    var previous: Character?
    for ch in text {
      if ch.isWhitespace, let p = previous, ".!?".contains(p) {
        let s = current.trimmingCharacters(in: .whitespaces)
        if !s.isEmpty { result.append(s) }
        current = ""
      } else {
        current.append(ch)
      }
      previous = ch
    }
    let last = current.trimmingCharacters(in: .whitespacesAndNewlines)
    if !last.isEmpty { result.append(last) }
    return result
  }

  /// 単語（英字・数字・アポストロフィの続き）と、その範囲。大文字小文字は小文字にそろえる
  static func words(_ text: String) -> [(word: String, range: Range<String.Index>)] {
    var result: [(String, Range<String.Index>)] = []
    var start: String.Index?
    var i = text.startIndex
    func isWordChar(_ c: Character) -> Bool { c.isLetter || c.isNumber || c == "'" || c == "’" }
    while i < text.endIndex {
      if isWordChar(text[i]) {
        if start == nil { start = i }
      } else if let s = start {
        result.append((text[s..<i].lowercased(), s..<i))
        start = nil
      }
      i = text.index(after: i)
    }
    if let s = start { result.append((text[s...].lowercased(), s..<text.endIndex)) }
    return result
  }

  /// accept の単語の並びが、文の中で続けて出てくる範囲（大文字小文字と句読点は見ない）
  static func find(_ phrase: String, in sentence: String) -> (range: Range<String.Index>, words: [(word: String, range: Range<String.Index>)])? {
    let target = words(phrase).map(\.word)
    let all = words(sentence)
    guard !target.isEmpty, all.count >= target.count else { return nil }
    for start in 0...(all.count - target.count) where all[start].word == target[0] {
      let slice = Array(all[start..<(start + target.count)])
      if slice.map(\.word) == target {
        return (slice[0].range.lowerBound..<slice[slice.count - 1].range.upperBound, slice)
      }
    }
    return nil
  }

  /// 理由・つながりの項目で、一部だけ言えたときに強調し始める言葉
  static let connectives: Set<String> = ["because", "so", "since", "then"]

  /// 見本の答えの行。items は自分の項目ごとの達成（無ければ全部 none とみなす）
  static func lines(
    description: String, checklist: [SceneLayout.ChecklistItem], items: [ContentBreakdown.Item]
  ) -> [Line] {
    let levels = Dictionary(items.map { ($0.id, $0.level) }, uniquingKeysWith: { a, _ in a })
    return sentences(description).enumerated().map { index, sentence in
      var matched: [ContentBreakdown.Level] = []
      var marks: [MarkedRange] = []
      for item in checklist {
        guard let found = find(item.firstAccept, in: sentence) else { continue }
        let level = levels[item.id] ?? ContentBreakdown.Level.none
        matched.append(level)
        guard level != .full else { continue }
        var range = found.range
        // 理由・つながりは、because などのあと（理由の所）だけを強調する
        if item.kind == .reason || item.kind == .link,
          let c = found.words.first(where: { connectives.contains($0.word) })
        {
          range = c.range.lowerBound..<found.range.upperBound
        }
        marks.append(MarkedRange(range: range, mark: .highlight))
      }
      let level: ContentBreakdown.Level? =
        if matched.isEmpty { nil }
        else if matched.allSatisfy({ $0 == .full }) { .full }
        else if matched.allSatisfy({ $0 == .none }) { ContentBreakdown.Level.none }
        else { .partial }
      return Line(id: index, text: sentence, level: level, marks: merge(marks))
    }
  }

  /// 重なる範囲をつなげ、前から順に並べる
  static func merge(_ marks: [MarkedRange]) -> [MarkedRange] {
    let sorted = marks.sorted { $0.range.lowerBound < $1.range.lowerBound }
    var result: [MarkedRange] = []
    for m in sorted {
      if let last = result.last, m.range.lowerBound <= last.range.upperBound {
        let upper = max(last.range.upperBound, m.range.upperBound)
        result[result.count - 1] = MarkedRange(range: last.range.lowerBound..<upper, mark: last.mark)
      } else {
        result.append(m)
      }
    }
    return result
  }
}
