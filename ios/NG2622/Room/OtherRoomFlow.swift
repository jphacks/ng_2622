/// 待合の「他のルーム」のシートの状態。開くたびに番号（ticket）を新しくし、いま開いているシートからの
/// 「移る」だけを受け付ける（閉じたシートの古い操作で移らないように）。順番の決まりは unit test で確かめる
struct OtherRoomFlow: Equatable {
  /// 「他のルームに入る」のシートを開いている
  private(set) var sheetOpen = false
  /// シートを開くたびに増やす番号。シートに渡し、移るときに付けて返してもらう
  private(set) var ticket = 0

  /// シートを開く。番号を新しくする
  mutating func open() {
    ticket += 1
    sheetOpen = true
  }

  /// シートが閉じた（下に引いたときも、移って待合が替わったときも）
  mutating func close() {
    sheetOpen = false
  }

  /// その番号のシートからの「移る」を受け付けるか。いま開いているシートのときだけ
  func accepts(_ ticket: Int) -> Bool {
    sheetOpen && ticket == self.ticket
  }
}
