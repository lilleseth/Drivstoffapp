import Foundation
import SwiftData

@Model
final class FillUp {
    var date: Date = Date.now
    var liters: Double = 0
    var totalPrice: Double = 0
    var odometer: Int = 0
    var fuelTypeRaw: String = FuelType.bensin.rawValue
    var station: String = ""
    var notes: String = ""

    /// Kvitteringen lagret som PDF. Lagres utenfor databasefilen.
    @Attribute(.externalStorage)
    var receiptPDF: Data?

    var car: Car?

    init(
        date: Date = .now,
        liters: Double,
        totalPrice: Double,
        odometer: Int,
        fuelType: FuelType,
        station: String = "",
        notes: String = "",
        receiptPDF: Data? = nil,
        car: Car?
    ) {
        self.date = date
        self.liters = liters
        self.totalPrice = totalPrice
        self.odometer = odometer
        self.fuelTypeRaw = fuelType.rawValue
        self.station = station
        self.notes = notes
        self.receiptPDF = receiptPDF
        self.car = car
    }

    var fuelType: FuelType {
        get { FuelType(rawValue: fuelTypeRaw) ?? .bensin }
        set { fuelTypeRaw = newValue.rawValue }
    }

    var pricePerLiter: Double? {
        FillUp.pricePerLiter(liters: liters, totalPrice: totalPrice)
    }

    static func pricePerLiter(liters: Double, totalPrice: Double) -> Double? {
        guard liters > 0 else { return nil }
        return totalPrice / liters
    }
}
