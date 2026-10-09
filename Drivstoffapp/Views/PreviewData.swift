import Foundation
import SwiftData

@MainActor
enum PreviewData {
    static let container: ModelContainer = {
        let container = try! ModelContainer(
            for: Car.self, FillUp.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        let context = container.mainContext
        let golf = Car(name: "VW Golf", licensePlate: "EL 12345", defaultFuelType: .bensin)
        let hilux = Car(name: "Toyota Hilux", licensePlate: "DN 98765", defaultFuelType: .diesel)
        context.insert(golf)
        context.insert(hilux)

        let calendar = Calendar.current
        for i in 0..<6 {
            let date = calendar.date(byAdding: .day, value: -i * 14, to: .now)!
            context.insert(FillUp(date: date, liters: 38 + Double(i), totalPrice: (38 + Double(i)) * 21.9,
                                  odometer: 45_000 - i * 600, fuelType: .bensin, station: "Circle K", car: golf))
            context.insert(FillUp(date: date, liters: 62 - Double(i), totalPrice: (62 - Double(i)) * 20.4,
                                  odometer: 120_000 - i * 800, fuelType: .diesel, station: "Uno-X", car: hilux))
        }
        return container
    }()
}
