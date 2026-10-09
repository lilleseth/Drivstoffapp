import Foundation

enum Formatting {
    static let nok = FloatingPointFormatStyle<Double>.Currency(code: "NOK")

    static func currency(_ value: Double) -> String {
        value.formatted(nok)
    }

    static func liters(_ value: Double) -> String {
        "\(value.formatted(.number.precision(.fractionLength(2)))) l"
    }

    static func pricePerLiter(_ value: Double) -> String {
        "\(value.formatted(.number.precision(.fractionLength(2)))) kr/l"
    }

    static func kilometers(_ value: Int) -> String {
        "\(value.formatted(.number.grouping(.automatic))) km"
    }
}

extension Double {
    /// Tolker tall skrevet både med komma og punktum som desimalskille,
    /// og tåler mellomrom/punktum som tusenskille (f.eks. "1 234,50" eller "1.234,50").
    init?(flexible text: String) {
        var s = text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\u{00A0}", with: "")
            .replacingOccurrences(of: "\u{202F}", with: "")
            .replacingOccurrences(of: " ", with: "")
        guard !s.isEmpty else { return nil }

        let lastComma = s.lastIndex(of: ",")
        let lastDot = s.lastIndex(of: ".")
        switch (lastComma, lastDot) {
        case let (c?, d?):
            // Det siste skilletegnet er desimalskillet, det andre er tusenskille.
            if c > d {
                s = s.replacingOccurrences(of: ".", with: "").replacingOccurrences(of: ",", with: ".")
            } else {
                s = s.replacingOccurrences(of: ",", with: "")
            }
        case (_?, nil):
            s = s.replacingOccurrences(of: ",", with: ".")
        default:
            break
        }
        guard let value = Double(s), value.isFinite else { return nil }
        self = value
    }
}
