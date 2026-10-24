import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

/// 部屋の QR。誤り訂正は最も高い H にし、点は角丸、3 つの目印は角丸の四角で、紫の単色で描く（lobby.md）
struct RoomQRCode: View {
  let text: String
  var color: Color = Theme.accent

  var body: some View {
    let matrix = QRMatrix.make(text)
    Canvas { context, size in
      guard let matrix else { return }
      let n = CGFloat(matrix.size)
      let cell = min(size.width, size.height) / n
      // 3 つの目印（左上・右上・左下の 7×7）
      let finders = [(0, 0), (matrix.size - 7, 0), (0, matrix.size - 7)]
      for y in 0..<matrix.size {
        for x in 0..<matrix.size where matrix[x, y] {
          if finders.contains(where: { x >= $0.0 && x < $0.0 + 7 && y >= $0.1 && y < $0.1 + 7 }) { continue }
          let rect = CGRect(x: CGFloat(x) * cell, y: CGFloat(y) * cell, width: cell, height: cell)
          context.fill(Path(ellipseIn: rect.insetBy(dx: cell * 0.08, dy: cell * 0.08)), with: .color(color))
        }
      }
      for (fx, fy) in finders {
        let origin = CGPoint(x: CGFloat(fx) * cell, y: CGFloat(fy) * cell)
        let outer = CGRect(origin: origin, size: CGSize(width: cell * 7, height: cell * 7))
        context.stroke(
          Path(roundedRect: outer.insetBy(dx: cell / 2, dy: cell / 2), cornerRadius: cell * 1.8),
          with: .color(color), lineWidth: cell)
        context.fill(
          Path(roundedRect: outer.insetBy(dx: cell * 2, dy: cell * 2), cornerRadius: cell * 1.1),
          with: .color(color))
      }
    }
    .aspectRatio(1, contentMode: .fit)
    .accessibilityLabel("部屋の QR")
  }
}

/// QR の点の並び（余白なし）
private struct QRMatrix {
  let size: Int
  private let bits: [Bool]

  subscript(x: Int, y: Int) -> Bool { bits[y * size + x] }

  private static var cache: [String: QRMatrix] = [:]

  static func make(_ text: String) -> QRMatrix? {
    if let hit = cache[text] { return hit }
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(text.utf8)
    filter.correctionLevel = "H"
    guard let image = filter.outputImage,
      let cg = CIContext().createCGImage(image, from: image.extent)
    else { return nil }

    // 1 点 = 1 画素で描き出し、灰色に塗って読む
    let w = cg.width
    let h = cg.height
    var pixels = [UInt8](repeating: 255, count: w * h)
    guard
      let ctx = CGContext(
        data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
    else { return nil }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    let dark = pixels.map { $0 < 128 }

    // まわりの余白を除く
    var minX = w
    var minY = h
    var maxX = -1
    var maxY = -1
    for y in 0..<h {
      for x in 0..<w where dark[y * w + x] {
        minX = min(minX, x)
        maxX = max(maxX, x)
        minY = min(minY, y)
        maxY = max(maxY, y)
      }
    }
    guard maxX >= minX, maxX - minX == maxY - minY else { return nil }
    let size = maxX - minX + 1
    var bits = [Bool](repeating: false, count: size * size)
    for y in 0..<size {
      for x in 0..<size {
        bits[y * size + x] = dark[(minY + y) * w + minX + x]
      }
    }
    let matrix = QRMatrix(size: size, bits: bits)
    cache[text] = matrix
    return matrix
  }
}
