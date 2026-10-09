import SwiftUI
import SwiftData
import Charts

struct StatisticsView: View {
    @Query(sort: \Car.name) private var cars: [Car]
    @Query(sort: \FillUp.date) private var fillUps: [FillUp]

    @State private var selectedCar: Car?

    private var selection: [FillUp] {
        guard let selectedCar else { return fillUps }
        return fillUps.filter { $0.car == selectedCar }
    }

    private var entries: [FuelStatistics.Entry] {
        selection.map { .init(date: $0.date, odometer: $0.odometer, liters: $0.liters, cost: $0.totalPrice) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if fillUps.isEmpty {
                    ContentUnavailableView("Ingen data ennå", systemImage: "chart.bar",
                                           description: Text("Statistikk vises når du har registrert fyllinger."))
                } else {
                    content
                }
            }
            .navigationTitle("Statistikk")
        }
    }

    private var content: some View {
        List {
            if cars.count > 1 {
                Picker("Bil", selection: $selectedCar) {
                    Text("Alle biler").tag(Car?.none)
                    ForEach(cars) { Text($0.displayName).tag(Car?.some($0)) }
                }
            }

            Section("Kostnad per måned") {
                MonthlyChart(data: FuelStatistics.monthlyCost(entries))
                    .frame(height: 180)
                    .padding(.vertical, 8)
            }

            if let selectedCar {
                summarySection(FuelStatistics(fillUps: selection), title: selectedCar.displayName, showConsumption: true)
            } else if cars.count == 1, let car = cars.first {
                summarySection(FuelStatistics(fillUps: selection), title: car.displayName, showConsumption: true)
            } else {
                summarySection(FuelStatistics(fillUps: selection), title: "Alle biler", showConsumption: false)
                ForEach(cars) { car in
                    summarySection(FuelStatistics(fillUps: car.fillUps), title: car.displayName, showConsumption: true)
                }
            }
        }
    }

    @ViewBuilder
    private func summarySection(_ stats: FuelStatistics, title: String, showConsumption: Bool) -> some View {
        Section(title) {
            LabeledContent("Totalt brukt", value: Formatting.currency(stats.totalCost))
            LabeledContent("Liter totalt", value: Formatting.liters(stats.totalLiters))
            LabeledContent("Antall fyllinger", value: "\(stats.count)")
            if let ppl = stats.averagePricePerLiter {
                LabeledContent("Snitt literpris", value: Formatting.pricePerLiter(ppl))
            }
            if showConsumption {
                if let distance = stats.distance {
                    LabeledContent("Kjørt", value: Formatting.kilometers(distance))
                }
                if let lpm = stats.litersPerMil {
                    LabeledContent("Forbruk", value: "\(lpm.formatted(.number.precision(.fractionLength(2)))) l/mil")
                }
                if let cpk = stats.costPerKm {
                    LabeledContent("Drivstoff per km", value: "\(cpk.formatted(.number.precision(.fractionLength(2)))) kr")
                }
            }
        }
        .monospacedDigit()
    }
}

private struct MonthlyChart: View {
    let data: [FuelStatistics.MonthlyCost]

    var body: some View {
        Chart(data) { item in
            BarMark(
                x: .value("Måned", item.month, unit: .month),
                y: .value("Kroner", item.cost)
            )
            .foregroundStyle(Color.accentColor)
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .month, count: 2)) { _ in
                AxisValueLabel(format: .dateTime.month(.abbreviated))
            }
        }
    }
}

#Preview {
    StatisticsView()
        .modelContainer(PreviewData.container)
}
