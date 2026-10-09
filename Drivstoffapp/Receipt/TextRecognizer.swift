import UIKit
import Vision

/// Leser tekst fra kvitteringsbilder med Apples Vision-rammeverk (kjører lokalt på telefonen).
enum TextRecognizer {

    /// Returnerer tekstlinjene fra alle bildene, sortert ovenfra og ned per side.
    static func recognizeLines(in images: [UIImage]) async -> [String] {
        var lines: [String] = []
        for image in images {
            lines += await recognizeLines(in: image)
        }
        return lines
    }

    static func recognizeLines(in image: UIImage) async -> [String] {
        guard let cgImage = image.cgImage else { return [] }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)

        return await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = false // tall og koder skal ikke "rettes"
                // Bruk bare språk som støttes på denne iOS-versjonen; ukjente språk gir feil.
                let wanted = ["nb-NO", "no-NO", "da-DK", "sv-SE", "de-DE", "en-US"]
                let supported = (try? request.supportedRecognitionLanguages()) ?? []
                let languages = wanted.filter(supported.contains)
                if !languages.isEmpty { request.recognitionLanguages = languages }

                let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation)
                do {
                    try handler.perform([request])
                    continuation.resume(returning: mergeIntoLines(request.results ?? []))
                } catch {
                    continuation.resume(returning: [])
                }
            }
        }
    }

    /// Vision gir ofte venstre og høyre kolonne ("Total" ... "909,24") som separate observasjoner.
    /// Her slås observasjoner på samme høyde sammen til én linje, slik at parseren ser dem sammen.
    private static func mergeIntoLines(_ observations: [VNRecognizedTextObservation]) -> [String] {
        struct Item { let text: String; let box: CGRect }
        let items = observations.compactMap { obs -> Item? in
            guard let text = obs.topCandidates(1).first?.string else { return nil }
            return Item(text: text, box: obs.boundingBox)
        }
        // Vision-koordinater har origo nederst til venstre.
        let sorted = items.sorted { $0.box.midY > $1.box.midY }

        var rows: [[Item]] = []
        for item in sorted {
            if let last = rows.last?.last,
               abs(last.box.midY - item.box.midY) < min(last.box.height, item.box.height) * 0.5 {
                rows[rows.count - 1].append(item)
            } else {
                rows.append([item])
            }
        }
        return rows.map { row in
            row.sorted { $0.box.minX < $1.box.minX }.map(\.text).joined(separator: "  ")
        }
    }
}

private extension CGImagePropertyOrientation {
    init(_ orientation: UIImage.Orientation) {
        switch orientation {
        case .up: self = .up
        case .upMirrored: self = .upMirrored
        case .down: self = .down
        case .downMirrored: self = .downMirrored
        case .left: self = .left
        case .leftMirrored: self = .leftMirrored
        case .right: self = .right
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
