import Foundation
import SwiftData

@Model
final class Car {
    var name: String = ""
    var licensePlate: String = ""
    var defaultFuelTypeRaw: String = FuelType.bensin.rawValue
    var createdAt: Date = Date.now

    @Relationship(deleteRule: .cascade, inverse: \FillUp.car)
    var fillUps: [FillUp] = []

    init(name: String, licensePlate: String = "", defaultFuelType: FuelType = .bensin) {
        self.name = name
        self.licensePlate = licensePlate
        self.defaultFuelTypeRaw = defaultFuelType.rawValue
        self.createdAt = .now
    }

    var defaultFuelType: FuelType {
        get { FuelType(rawValue: defaultFuelTypeRaw) ?? .bensin }
        set { defaultFuelTypeRaw = newValue.rawValue }
    }

    var displayName: String {
        licensePlate.isEmpty ? name : "\(name) (\(licensePlate))"
    }
}
