import Foundation

/// Nøkkeltall for en samling fyllinger. Holdes fri for SwiftData slik at den er lett å teste.
struct FuelStatistics: Equatable {
    struct Entry: Equatable {
        var date: Date
        var odometer: Int
        var liters: Double
        var cost: Double
    }

    let count: Int
    let totalCost: Double
    let totalLiters: Double
    /// Gjennomsnittlig literpris vektet etter antall liter.
    let averagePricePerLiter: Double?
    /// Kjørte kilometer mellom første og siste registrerte fylling.
    let distance: Int?
    /// Forbruk i liter per mil (10 km).
    let litersPerMil: Double?
    /// Drivstoffkostnad per kilometer.
    let costPerKm: Double?

    init(entries: [Entry]) {
        count = entries.count
        totalCost = entries.reduce(0) { $0 + $1.cost }
        totalLiters = entries.reduce(0) { $0 + $1.liters }
        averagePricePerLiter = totalLiters > 0 ? totalCost / totalLiters : nil

        // Forbruk: drivstoffet fylt ved første fylling ble brukt før registreringene startet,
        // så det telles ikke med. Resten fordeles på kjørt distanse.
        let sorted = entries.sorted { ($0.odometer, $0.date) < ($1.odometer, $1.date) }
        if let first = sorted.first, let last = sorted.last, last.odometer > first.odometer {
            let km = last.odometer - first.odometer
            let usedLiters = sorted.dropFirst().reduce(0) { $0 + $1.liters }
            let usedCost = sorted.dropFirst().reduce(0) { $0 + $1.cost }
            distance = km
            litersPerMil = usedLiters / Double(km) * 10
            costPerKm = usedCost / Double(km)
        } else {
            distance = nil
            litersPerMil = nil
            costPerKm = nil
        }
    }

    init(fillUps: [FillUp]) {
        self.init(entries: fillUps.map {
            Entry(date: $0.date, odometer: $0.odometer, liters: $0.liters, cost: $0.totalPrice)
        })
    }

    struct MonthlyCost: Identifiable, Equatable {
        var month: Date
        var cost: Double
        var id: Date { month }
    }

    /// Sum kostnad per måned, de siste `months` månedene (inkludert inneværende).
    static func monthlyCost(_ entries: [Entry], months: Int = 12, now: Date = .now,
                            calendar: Calendar = .current) -> [MonthlyCost] {
        guard let thisMonth = calendar.dateInterval(of: .month, for: now)?.start else { return [] }
        return (0..<months).reversed().compactMap { offset in
            guard let start = calendar.date(byAdding: .month, value: -offset, to: thisMonth),
                  let end = calendar.date(byAdding: .month, value: 1, to: start) else { return nil }
            let cost = entries.filter { $0.date >= start && $0.date < end }.reduce(0) { $0 + $1.cost }
            return MonthlyCost(month: start, cost: cost)
        }
    }
}
