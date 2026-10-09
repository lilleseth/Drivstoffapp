import Foundation

/// Resultatet av å tolke teksten fra en drivstoffkvittering.
/// Alle felt er valgfrie – brukeren kontrollerer og retter før lagring.
struct ParsedReceipt: Equatable {
    var liters: Double?
    var totalPrice: Double?
    var pricePerLiter: Double?
    var fuelType: FuelType?
    var date: Date?
    var station: String?

    var isEmpty: Bool {
        liters == nil && totalPrice == nil && pricePerLiter == nil
            && fuelType == nil && date == nil && station == nil
    }
}

/// Tolker OCR-tekst fra norske drivstoffkvitteringer (Circle K, Esso, Uno-X, YX, Shell, St1 osv.).
///
/// Kvitteringer varierer mye, så parseren bruker flere mønstre og kryssjekker
/// liter × literpris mot totalbeløpet for å velge de mest sannsynlige verdiene.
enum ReceiptParser {

    // MARK: - Gyldige verdiområder

    static let litersRange = 0.5...300.0
    static let pricePerLiterRange = 5.0...60.0
    static let totalRange = 1.0...20_000.0

    // MARK: - Offentlig API

    static func parse(_ text: String, calendar: Calendar = .current) -> ParsedReceipt {
        let lines = text
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        return parse(lines: lines, calendar: calendar)
    }

    static func parse(lines originalLines: [String], calendar: Calendar = .current) -> ParsedReceipt {
        let lines = originalLines.map { $0.lowercased() }
        var result = ParsedReceipt()

        result.pricePerLiter = findPricePerLiter(in: lines)
        result.liters = findLiters(in: lines)
        result.totalPrice = findTotal(in: lines)
        result.fuelType = findFuelType(in: lines)
        result.date = findDate(in: lines, calendar: calendar)
        result.station = findStation(in: originalLines)

        reconcile(&result, lines: lines)
        return result
    }

    // MARK: - Tall

    /// Et tall med 1–3 desimaler, f.eks. "42,31", "21.490".
    private static let decimal = #"(?<![\d.,])\d{1,4}[.,]\d{1,3}"#

    /// Et pengebeløp med nøyaktig to desimaler, ev. med tusenskille: "909,24", "1 234,50", "1.234,50".
    /// Avvises hvis det er en del av en dato som "05.10.2026".
    private static let money = #"(?<![\d.,])(?:\d{1,3}(?:[  .]\d{3})+|\d+)[.,]\d{2}(?![.,]?\d)"#

    // MARK: - Literpris

    private static let pricePerLiterPatterns = [
        // "21,49 kr/l", "21,49/l", "21,49 pr. liter", "21,49 nok/ltr"
        #"(\#(decimal))\s*(?:kr|nok|,-)?\s*(?:/|pr\.?\s*|per\s+)(?:liter|ltr|lit|l)\b"#,
        // "Pris/l: 21,49", "kr pr liter 21,49", "Literpris 21,49", "Enhetspris 21,49"
        #"(?:pris|kr|nok)\s*(?:/|pr\.?\s*|per\s+)\s*(?:liter|ltr|lit|l)\b\.?\s*:?\s*(?:kr|nok)?\s*(\#(decimal))"#,
        #"(?:literpris|enhetspris|à-pris|a-pris)\s*:?\s*(?:kr|nok)?\s*(\#(decimal))"#,
        // "@ 21,49"
        #"@\s*(\#(decimal))"#,
    ]

    private static func findPricePerLiter(in lines: [String]) -> Double? {
        for pattern in pricePerLiterPatterns {
            for line in lines {
                for value in captures(pattern, in: line) {
                    if let v = Double(flexible: value), pricePerLiterRange.contains(v) {
                        return v
                    }
                }
            }
        }
        return nil
    }

    private static func mentionsPricePerLiter(_ line: String) -> Bool {
        pricePerLiterPatterns.contains { !captures($0, in: line).isEmpty }
            || line.contains("pris") || line.contains("kr/")
    }

    // MARK: - Liter

    private static func findLiters(in lines: [String]) -> Double? {
        // "42,31 l", "42,31 ltr", "42.31 liter" – men ikke "kr/l".
        let suffix = #"(?<![\d.,])(\#(decimal))\s*(?:liter|ltr|lit|l)\b(?!\s*/)"#
        // "Liter: 42,31", "Volum 42,31", "Antall 42,31 l"
        let prefix = #"(?:liter|ltr|volum|mengde|antall|ant\.?)\s*:?\s*(\#(decimal))"#

        for line in lines {
            for value in captures(suffix, in: line) {
                if let v = Double(flexible: value), litersRange.contains(v) { return v }
            }
        }
        for line in lines where !mentionsPricePerLiter(line) {
            for value in captures(prefix, in: line) {
                if let v = Double(flexible: value), litersRange.contains(v) { return v }
            }
        }
        return nil
    }

    // MARK: - Totalbeløp

    private static let totalKeywords = [
        "å betale", "a betale", "å betal", "total", "sum", "beløp", "belop", "bel0p",
        "kortbeløp", "betalt", "kjøp", "purchase", "amount",
    ]
    private static let excludedTotalKeywords = [
        "mva", "moms", "netto", "rabatt", "tilbake", "veksel", "grunnlag", "avgift", "vat",
    ]

    private static func findTotal(in lines: [String]) -> Double? {
        var candidates: [Double] = []
        for (index, line) in lines.enumerated() {
            guard totalKeywords.contains(where: { line.contains($0) }),
                  !excludedTotalKeywords.contains(where: { line.contains($0) }) else { continue }

            var amounts = moneyValues(in: line)
            // OCR deler ofte opp kolonner, slik at beløpet havner på linjen under.
            if amounts.isEmpty, index + 1 < lines.count {
                let next = lines[index + 1]
                if !excludedTotalKeywords.contains(where: { next.contains($0) }) {
                    amounts = moneyValues(in: next)
                }
            }
            candidates.append(contentsOf: amounts.filter { totalRange.contains($0) })
        }
        // Totalen er normalt det største av beløpene ved nøkkelordene (sum ≥ delsum).
        return candidates.max()
    }

    private static func moneyValues(in line: String) -> [Double] {
        matches(money, in: line).compactMap(Double.init(flexible:))
    }

    // MARK: - Drivstofftype

    private static func findFuelType(in lines: [String]) -> FuelType? {
        let text = lines.joined(separator: "\n")
        if matchesAny([#"diesel"#, #"\bhvo\b"#, #"\bd-?ultra\b"#], in: text) {
            return .diesel
        }
        if matchesAny([
            #"bensin"#, #"blyfri"#, #"\be10\b"#, #"\be5\b"#, #"v-?power"#,
            #"\b(?:miles|uno-?x|best|ultra|yx|ren|bensin|blyfri|super|premium|v-?power|e10|e5)\s*(?:\+|plus)?\s*(?:95|98)\b(?![.,]\d)"#,
            #"oktan"#, #"petrol"#, #"gasoline"#,
        ], in: text) {
            return .bensin
        }
        return nil
    }

    // MARK: - Dato

    private static func findDate(in lines: [String], calendar: Calendar) -> Date? {
        let dmy = #"(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)"#
        let ymd = #"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)"#
        let time = #"(?<!\d)([01]?\d|2[0-3])[:.]([0-5]\d)(?![.,]?\d)"#

        for line in lines {
            var components: DateComponents?
            var remainder = line

            if let g = groups(ymd, in: line) {
                components = DateComponents(year: Int(g[0]), month: Int(g[1]), day: Int(g[2]))
                remainder = line.replacingOccurrences(of: g[0] + "-" + g[1] + "-" + g[2], with: " ")
            } else if let g = groups(dmy, in: line), var year = Int(g[2]) {
                if year < 100 { year += 2000 }
                components = DateComponents(year: year, month: Int(g[1]), day: Int(g[0]))
                if let range = line.range(of: dmy, options: .regularExpression) {
                    remainder.replaceSubrange(range, with: " ")
                }
            }

            guard var c = components,
                  let y = c.year, (2000...2100).contains(y),
                  let m = c.month, (1...12).contains(m),
                  let d = c.day, (1...31).contains(d) else { continue }

            if let t = groups(time, in: remainder) {
                c.hour = Int(t[0])
                c.minute = Int(t[1])
            } else {
                c.hour = 12
            }
            if let date = calendar.date(from: c),
               calendar.component(.day, from: date) == d {
                return date
            }
        }
        return nil
    }

    // MARK: - Stasjon

    static let knownStations = [
        "Circle K", "Uno-X", "Esso", "Shell", "YX", "St1", "Best", "Tanken", "Automat1",
        "Driv", "Bunker Oil", "Haltbakk", "Trønder Oil", "Preem", "Statoil", "Uno X",
    ]

    private static func findStation(in lines: [String]) -> String? {
        let text = lines.prefix(8).joined(separator: "\n").lowercased()
        for name in knownStations {
            let escaped = NSRegularExpression.escapedPattern(for: name.lowercased())
            if matchesAny([#"(?<![\p{L}\d])"# + escaped + #"(?![\p{L}\d])"#], in: text) {
                return name == "Uno X" ? "Uno-X" : name
            }
        }
        // Ellers: første linje som ser ut som et navn (ikke bare tall/tegn).
        let generic = ["kvittering", "receipt", "kopi", "salg", "velkommen"]
        return lines.prefix(3).first { line in
            let lower = line.lowercased()
            return line.unicodeScalars.filter(CharacterSet.letters.contains).count >= 3
                && !generic.contains(where: { lower.contains($0) })
        }
    }

    // MARK: - Kryssjekk

    private static func reconcile(_ r: inout ParsedReceipt, lines: [String]) {
        switch (r.liters, r.pricePerLiter, r.totalPrice) {
        case let (l?, p?, nil):
            r.totalPrice = round2(l * p)

        case let (nil, p?, t?):
            let l = round2(t / p)
            if litersRange.contains(l) { r.liters = l }

        case let (l?, nil, t?):
            let p = t / l
            if pricePerLiterRange.contains(p) { r.pricePerLiter = round2(p) }

        case let (l?, p?, t?) where abs(l * p - t) > 1.0:
            // Totalen stemmer ikke med liter × literpris. Se om et annet beløp på kvitteringen gjør det.
            let expected = l * p
            let all = lines.flatMap(moneyValues(in:))
            if let match = all.min(by: { abs($0 - expected) < abs($1 - expected) }),
               abs(match - expected) <= 1.0 {
                r.totalPrice = match
            }

        case (nil, nil, nil):
            // Ingen nøkkelord funnet – bruk største plausible beløp som et forslag.
            r.totalPrice = lines.flatMap(moneyValues(in:)).filter { totalRange.contains($0) }.max()

        default:
            break
        }
    }

    private static func round2(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }

    // MARK: - Regex-hjelpere

    private static func regex(_ pattern: String) -> NSRegularExpression? {
        try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
    }

    /// Alle treff på hele mønsteret.
    private static func matches(_ pattern: String, in text: String) -> [String] {
        guard let re = regex(pattern) else { return [] }
        let ns = text as NSString
        return re.matches(in: text, range: NSRange(location: 0, length: ns.length))
            .map { ns.substring(with: $0.range) }
    }

    /// Første fangstgruppe for hvert treff.
    private static func captures(_ pattern: String, in text: String) -> [String] {
        guard let re = regex(pattern) else { return [] }
        let ns = text as NSString
        return re.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap { m in
            guard m.numberOfRanges > 1, m.range(at: 1).location != NSNotFound else { return nil }
            return ns.substring(with: m.range(at: 1))
        }
    }

    /// Alle fangstgrupper for første treff.
    private static func groups(_ pattern: String, in text: String) -> [String]? {
        guard let re = regex(pattern) else { return nil }
        let ns = text as NSString
        guard let m = re.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (1..<m.numberOfRanges).map { i in
            m.range(at: i).location == NSNotFound ? "" : ns.substring(with: m.range(at: i))
        }
    }

    private static func matchesAny(_ patterns: [String], in text: String) -> Bool {
        patterns.contains { !matches($0, in: text).isEmpty }
    }
}
