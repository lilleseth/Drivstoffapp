import SwiftUI
import PDFKit

/// Viser en lagret kvittering og lar brukeren dele/eksportere PDF-en (Filer, e-post, AirDrop …).
struct ReceiptView: View {
    @Environment(\.dismiss) private var dismiss
    let pdfData: Data
    let fileName: String

    @State private var fileURL: URL?

    var body: some View {
        NavigationStack {
            PDFKitView(data: pdfData)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Kvittering")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Lukk") { dismiss() }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        if let fileURL {
                            ShareLink(item: fileURL)
                        }
                    }
                }
        }
        .task { fileURL = writeTemporaryFile() }
    }

    private func writeTemporaryFile() -> URL? {
        let safeName = fileName
            .components(separatedBy: CharacterSet(charactersIn: "/\\:?%*|\"<>"))
            .joined(separator: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
        do {
            try pdfData.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}

struct PDFKitView: UIViewRepresentable {
    let data: Data

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.document = PDFDocument(data: data)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {}
}
