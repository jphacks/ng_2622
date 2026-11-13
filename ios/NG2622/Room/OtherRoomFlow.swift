/// 待合の「他のルーム」の手順の状態（シートを開く → 確かめたコード → シートを閉じる → 確かめ → 移る）。
/// 画面（LobbyView）から切り離し、順番の決まりを unit test で確かめる
struct OtherRoomFlow: Equatable {
  /// 「他のルームに入る」のシートを開いている
  private(set) var sheetOpen = false
  /// シートで確かめたコード。シートを閉じてから移る
  private(set) var found: String?
  /// ほかの人がいるので、移るかを確かめている部屋のコード
  private(set) var confirming: String?

  /// シートを開く。前に開いたときの確かめは捨てる
  mutating func open() {
    sheetOpen = true
    found = nil
  }

  /// シートの中で、入れそうなコードが分かった。開いている間だけ受け取り、シートを閉じる。
  /// 確かめている途中で下に引いて閉じていたら、受け取らない（後で開いたときに古いコードで移らないように）
  mutating func found(_ code: String) {
    guard sheetOpen else { return }
    found = code
    sheetOpen = false
  }

  /// シートが閉じ始めた（下に引いたときも、found で閉じたときも）
  mutating func close() {
    sheetOpen = false
  }

  /// シートが閉じ終わった。確かめたコードがあれば、ほかの人がいるときは確かめを出し（nil を返す）、
  /// いなければ移る先を返す
  mutating func sheetDismissed(hasOthers: Bool) -> String? {
    sheetOpen = false
    guard let code = found else { return nil }
    found = nil
    if hasOthers {
      confirming = code
      return nil
    }
    return code
  }

  /// 確かめで「入る」。移る先を返す。2 度押しても 2 度目は nil
  mutating func confirm() -> String? {
    defer { confirming = nil }
    return confirming
  }

  /// 確かめで「やめる」
  mutating func cancel() {
    confirming = nil
  }
}
