import Foundation

enum FuelType: String, CaseIterable, Identifiable, Codable {
    case bensin
    case diesel

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .bensin: "Bensin"
        case .diesel: "Diesel"
        }
    }
}
