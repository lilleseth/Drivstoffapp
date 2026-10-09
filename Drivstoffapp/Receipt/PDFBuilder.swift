import UIKit

/// Lager en PDF av ett eller flere kvitteringsbilder (én side per bilde).
enum PDFBuilder {

    /// A4 i punkter (72 dpi).
    private static let pageSize = CGSize(width: 595.2, height: 841.8)
    private static let margin: CGFloat = 24

    static func makePDF(from images: [UIImage], title: String = "Kvittering") -> Data? {
        guard !images.isEmpty else { return nil }

        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = [
            kCGPDFContextTitle as String: title,
            kCGPDFContextCreator as String: "Drivstoffapp",
        ]
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: pageSize), format: format)

        return renderer.pdfData { context in
            for image in images {
                context.beginPage()
                let scaled = downscaled(image, maxDimension: 2000)
                let available = CGRect(origin: .zero, size: pageSize).insetBy(dx: margin, dy: margin)
                let scale = min(available.width / scaled.size.width, available.height / scaled.size.height)
                let size = CGSize(width: scaled.size.width * scale, height: scaled.size.height * scale)
                let origin = CGPoint(x: available.midX - size.width / 2, y: available.minY)
                scaled.draw(in: CGRect(origin: origin, size: size))
            }
        }
    }

    /// Holder filstørrelsen nede – en kvittering trenger ikke 12 MP.
    private static func downscaled(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let largest = max(image.size.width, image.size.height)
        guard largest > maxDimension else { return image }
        let scale = maxDimension / largest
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let jpegData = UIGraphicsImageRenderer(size: size, format: format)
            .jpegData(withCompressionQuality: 0.7) { _ in
                image.draw(in: CGRect(origin: .zero, size: size))
            }
        return UIImage(data: jpegData) ?? image
    }
}
