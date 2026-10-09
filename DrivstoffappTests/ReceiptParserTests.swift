import XCTest
@testable import Drivstoffapp

final class ReceiptParserTests: XCTestCase {

    private var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Oslo")!
        return c
    }

    private func assertDate(_ date: Date?, _ y: Int, _ m: Int, _ d: Int, _ h: Int, _ min: Int,
                            file: StaticString = #filePath, line: UInt = #line) {
        guard let date else { return XCTFail("Mangler dato", file: file, line: line) }
        let c = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        XCTAssertEqual([c.year, c.month, c.day, c.hour, c.minute], [y, m, d, h, min], file: file, line: line)
    }

    func testCircleKDieselReceipt() {
        let r = ReceiptParser.parse("""
            Circle K Lillestrøm
            Org.nr 123 456 789 MVA
            Pumpe 4  Miles Diesel
            42,31 l x 21,49 kr/l   909,24
            Total NOK   909,24
            MVA 25%   181,85
            05.10.2026 14:32
            """, calendar: calendar)
        XCTAssertEqual(r.liters, 42.31)
        XCTAssertEqual(r.pricePerLiter, 21.49)
        XCTAssertEqual(r.totalPrice, 909.24)
        XCTAssertEqual(r.fuelType, .diesel)
        XCTAssertEqual(r.station, "Circle K")
        assertDate(r.date, 2026, 10, 5, 14, 32)
    }

    func testAmountOnLineBelowKeyword() {
        let r = ReceiptParser.parse("""
            UNO-X 7-ELEVEN
            KVITTERING
            Dato: 03/09/26 Kl: 08.15
            Produkt: Blyfri 95
            Liter: 35,50
            Pris pr. liter: 22,19
            Å BETALE
            787,75
            """, calendar: calendar)
        XCTAssertEqual(r.liters, 35.50)
        XCTAssertEqual(r.pricePerLiter, 22.19)
        XCTAssertEqual(r.totalPrice, 787.75)
        XCTAssertEqual(r.fuelType, .bensin)
        XCTAssertEqual(r.station, "Uno-X")
        assertDate(r.date, 2026, 9, 3, 8, 15)
    }

    func testThousandSeparatorAndIsoDate() {
        let r = ReceiptParser.parse("""
            Esso Express Sandvika
            Bensin 95 E10
            Antall 40,12 ltr
            Sum kr 1.002,60
            Herav mva 200,52
            2026-08-15 18:05
            """, calendar: calendar)
        XCTAssertEqual(r.liters, 40.12)
        XCTAssertEqual(r.totalPrice, 1002.60)
        XCTAssertEqual(r.pricePerLiter, 24.99) // beregnet fra beløp / liter
        XCTAssertEqual(r.fuelType, .bensin)
        XCTAssertEqual(r.station, "Esso")
        assertDate(r.date, 2026, 8, 15, 18, 5)
    }

    func testSubtotalAndDiscountLines() {
        let r = ReceiptParser.parse("""
            YX Molde
            Diesel
            51,20 ltr @ 20,90
            Subtotal 1 070,08
            Rabatt 0,00
            Totalt 1 070,08
            Dato 01.02.2026
            """, calendar: calendar)
        XCTAssertEqual(r.liters, 51.20)
        XCTAssertEqual(r.pricePerLiter, 20.90)
        XCTAssertEqual(r.totalPrice, 1070.08)
        XCTAssertEqual(r.fuelType, .diesel)
        assertDate(r.date, 2026, 2, 1, 12, 0)
    }

    func testTotalComputedWhenMissing() {
        let r = ReceiptParser.parse("""
            Tanken Vinstra
            Diesel 50,00 l x 20,00 kr/l
            """, calendar: calendar)
        XCTAssertEqual(r.totalPrice, 1000.00)
    }

    func testUnrelatedTextGivesNoValues() {
        let r = ReceiptParser.parse("""
            Hei og velkommen
            Takk for handelen
            """, calendar: calendar)
        XCTAssertNil(r.liters)
        XCTAssertNil(r.totalPrice)
        XCTAssertNil(r.fuelType)
        XCTAssertNil(r.date)
    }

    func testInvalidDateIsIgnored() {
        let r = ReceiptParser.parse("Dato 31.02.2026", calendar: calendar)
        XCTAssertNil(r.date)
    }
}

final class NumberParsingTests: XCTestCase {
    func testFlexibleDecimalParsing() {
        XCTAssertEqual(Double(flexible: "42,31"), 42.31)
        XCTAssertEqual(Double(flexible: "42.31"), 42.31)
        XCTAssertEqual(Double(flexible: "1 234,50"), 1234.50)
        XCTAssertEqual(Double(flexible: "1.234,50"), 1234.50)
        XCTAssertEqual(Double(flexible: "1,234.50"), 1234.50)
        XCTAssertEqual(Double(flexible: " 900 "), 900)
        XCTAssertNil(Double(flexible: ""))
        XCTAssertNil(Double(flexible: "abc"))
    }
}

final class FuelStatisticsTests: XCTestCase {
    func testConsumptionIgnoresFirstFillUp() {
        let d = Date(timeIntervalSince1970: 1_780_000_000)
        let stats = FuelStatistics(entries: [
            .init(date: d, odometer: 1_000, liters: 40, cost: 800),
            .init(date: d.addingTimeInterval(86_400), odometer: 1_500, liters: 35, cost: 700),
            .init(date: d.addingTimeInterval(172_800), odometer: 2_000, liters: 30, cost: 600),
        ])
        XCTAssertEqual(stats.count, 3)
        XCTAssertEqual(stats.totalCost, 2_100)
        XCTAssertEqual(stats.totalLiters, 105)
        XCTAssertEqual(stats.averagePricePerLiter, 20)
        XCTAssertEqual(stats.distance, 1_000)
        XCTAssertEqual(stats.litersPerMil!, 0.65, accuracy: 0.0001)
        XCTAssertEqual(stats.costPerKm!, 1.3, accuracy: 0.0001)
    }

    func testSingleFillUpHasNoConsumption() {
        let stats = FuelStatistics(entries: [.init(date: .now, odometer: 1_000, liters: 40, cost: 800)])
        XCTAssertNil(stats.distance)
        XCTAssertNil(stats.litersPerMil)
    }
}
