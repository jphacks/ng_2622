import Foundation
import Testing

@testable import NG2622

/// ホームの 3D の重なり（TitleLayers）。入れ替えの手順を、描かれた知らせ（settle）の順を変えて確かめる
struct TitleLayersTests {
  let a = URL(filePath: "/tmp/title/jphacks-2026-aaaaaaaa.usdz")
  let b = URL(filePath: "/tmp/title/other-2026-bbbbbbbb.usdz")
  let t0 = Date(timeIntervalSince1970: 1_794_700_000)

  /// 最初の 3D は、描かれるまで見えていないものとして扱う（札を 3D より先に出さない）
  @Test func firstLayerShownAfterSettle() {
    var layers = TitleLayers(.advert(a, caption: "JPHACKS"), now: t0)
    #expect(layers.shown == nil)
    #expect(!layers.top.settled)
    let r1 = layers.settle(layers.top.id)
    #expect(r1)
    #expect(layers.shown == .advert(a, caption: "JPHACKS"))
  }

  /// 最初の 3D が公園なら、札が無いので待たずに見えているものとして扱う
  @Test func firstParkIsShownAtOnce() {
    let layers = TitleLayers(.park, now: t0)
    #expect(layers.top.settled)
    #expect(layers.shown == .park)
  }

  /// A → B → A: 置き直した A は新しい層になり、それが描かれたら下の層（前の A と B）をすべて外す。
  /// B の知らせが後から届いても、何もしない（層が取り残されない）
  @Test func backAndForthLeavesOneLayer() {
    var layers = TitleLayers(.park, now: t0)
    let first = layers.top.id
    let r2 = layers.settle(first)
    #expect(r2)
    let r3 = layers.show(.advert(a, caption: "JPHACKS"), now: t0 + 1)
    #expect(r3 == .added)
    let advert = layers.top.id
    let r4 = layers.show(.park, now: t0 + 2)
    #expect(r4 == .added)
    let again = layers.top.id
    #expect(again != first)
    #expect(layers.layers.count == 3)
    // 前の 2 つの知らせは、いちばん上ではないので無視する
    let r5 = layers.settle(advert)
    #expect(!r5)
    let r6 = layers.settle(first)
    #expect(!r6)
    #expect(layers.shown == .park)
    let r7 = layers.settle(again)
    #expect(r7)
    #expect(layers.layers.map(\.id) == [again])
    #expect(layers.shown == .park)
    #expect(layers.top.start == t0 + 2)
  }

  /// 広告の 3D が読めず公園に戻したとき: 描かれなかった広告の層の上に公園の層を置き、それが描かれたら広告の層ごと外す
  @Test func failedAdvertFallsBackToPark() {
    var layers = TitleLayers(.park, now: t0)
    let r8 = layers.settle(layers.top.id)
    #expect(r8)
    let r9 = layers.show(.advert(b, caption: "ほかの会社"), now: t0 + 1)
    #expect(r9 == .added)
    let failed = layers.top.id
    // 札は、広告の 3D が描かれるまで出さない
    #expect(layers.shown == .park)
    let r10 = layers.show(.park, now: t0 + 2)
    #expect(r10 == .added)
    let r11 = layers.settle(layers.top.id)
    #expect(r11)
    #expect(layers.layers.count == 1)
    #expect(layers.shown == .park)
    let r12 = layers.settle(failed)
    #expect(!r12)
  }

  /// 字だけが替わったら、層を増やさず、いちばん上の層の字だけを替える（向きの 0 秒も引き継ぐ）
  @Test func captionOnlyChangeRetitles() {
    var layers = TitleLayers(.advert(a, caption: "広告の見本：JPHACKS"), now: t0)
    let id = layers.top.id
    let r13 = layers.settle(id)
    #expect(r13)
    let r14 = layers.show(.advert(a, caption: "JPHACKS"), now: t0 + 5)
    #expect(r14 == .retitled)
    #expect(layers.layers.count == 1)
    #expect(layers.top.id == id)
    #expect(layers.top.start == t0)
    #expect(layers.top.settled)
    #expect(layers.shown == .advert(a, caption: "JPHACKS"))
    // 同じものなら何もしない
    let r15 = layers.show(.advert(a, caption: "JPHACKS"), now: t0 + 6)
    #expect(r15 == .none)
    // 3D が違えば新しい層
    let r16 = layers.show(.advert(b, caption: "JPHACKS"), now: t0 + 7)
    #expect(r16 == .added)
  }

  /// もう読み込み済みの広告（きろく・設定から戻ったとき）は、描かれた状態から始め、3D と札をすぐ一緒に出す
  @Test func readyAdvertStartsShown() {
    let layers = TitleLayers(.advert(a, caption: "JPHACKS"), ready: true, now: t0)
    #expect(layers.top.settled)
    #expect(layers.shown == .advert(a, caption: "JPHACKS"))
    #expect(layers.opacity(of: layers.top) == 1)
    // 読み込み済みでなければ、描かれるまで薄く、札も出さない
    let cold = TitleLayers(.advert(a, caption: "JPHACKS"), ready: false, now: t0)
    #expect(cold.opacity(of: cold.top) == TitleLayers.pendingOpacity)
    #expect(cold.shown == nil)
  }

  /// 濃さの決まり: 描かれる前の広告は薄く、公園はすぐ濃く出す
  @Test func opacityRule() {
    var layers = TitleLayers(.park, now: t0)
    #expect(layers.opacity(of: layers.top) == 1)
    _ = layers.show(.advert(a, caption: "JPHACKS"), now: t0 + 1)
    #expect(layers.opacity(of: layers.top) == TitleLayers.pendingOpacity)
    let id = layers.top.id
    _ = layers.settle(id)
    #expect(layers.opacity(of: layers.top) == 1)
  }

  /// 広告の 3D は札より先に見えない: A（描かれた広告）→ 公園 → B（広告）で、公園の知らせが B より後に届いても、
  /// B は描かれるまで薄く、札は A のまま。B が描かれたら B だけが残り、札も B になる
  @Test func advertNeverVisibleBeforeLabel() {
    var layers = TitleLayers(.advert(a, caption: "JPHACKS"), ready: true, now: t0)
    _ = layers.show(.park, now: t0 + 1)
    let park = layers.top.id
    _ = layers.show(.advert(b, caption: "ほかの会社"), now: t0 + 2)
    let advertB = layers.top.id
    func checkInvariant() {
      // 濃く見えている広告の層は、どれも描かれている（札がその層の前の札か、その層の札になっている）
      for layer in layers.layers where layer.title != .park && layers.opacity(of: layer) == 1 {
        #expect(layer.settled)
      }
    }
    checkInvariant()
    #expect(layers.opacity(of: layers.top) == TitleLayers.pendingOpacity)
    #expect(layers.shown == .advert(a, caption: "JPHACKS"))
    let lateSettle = layers.settle(park)
    #expect(!lateSettle)
    checkInvariant()
    #expect(layers.shown == .advert(a, caption: "JPHACKS"))
    let settled = layers.settle(advertB)
    #expect(settled)
    checkInvariant()
    #expect(layers.layers.map(\.id) == [advertB])
    #expect(layers.shown == .advert(b, caption: "ほかの会社"))
  }

  /// まだ描かれていない層で字だけが替わってから描かれたら、出す字は新しい方
  @Test func retitleBeforeSettleUsesNewCaption() {
    var layers = TitleLayers(.park, now: t0)
    _ = layers.show(.advert(a, caption: "広告の見本：JPHACKS"), now: t0 + 1)
    let r = layers.show(.advert(a, caption: "JPHACKS"), now: t0 + 2)
    #expect(r == .retitled)
    #expect(layers.layers.count == 2)
    let id = layers.top.id
    _ = layers.settle(id)
    #expect(layers.shown == .advert(a, caption: "JPHACKS"))
  }

  /// 同じ 3D かは、URL の書き方の違い（./ など）を問わず、字は見ない
  @Test func sameModelIgnoresCaption() {
    #expect(HomeTitle.park.sameModel(as: .park))
    #expect(HomeTitle.advert(a, caption: "x").sameModel(as: .advert(URL(filePath: "/tmp/title/./jphacks-2026-aaaaaaaa.usdz"), caption: "y")))
    #expect(!HomeTitle.advert(a, caption: "x").sameModel(as: .advert(b, caption: "x")))
    #expect(!HomeTitle.park.sameModel(as: .advert(a, caption: "x")))
  }

  /// 先に読めない 3D は、入れ替える前に分かる（HomeView の follow は、入れ替えずに消す）
  @Test func preloadFailsForMissingModel() async {
    let missing = URL.temporaryDirectory.appending(path: "missing-\(UUID().uuidString).usdz")
    #expect(await SceneLibrary.shared.preload(usdzAt: missing) == false)
    let bundled = TitleDiorama.hackathon.url()
    #expect(bundled != nil)
    if let bundled { #expect(await SceneLibrary.shared.preload(usdzAt: bundled)) }
  }
}
