import SwiftUI

struct FillUpRow: View {
    let fillUp: FillUp
    var showCar = true

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "fuelpump.fill")
                .foregroundStyle(fillUp.fuelType == .diesel ? Color.orange : Color.green)
                .frame(width: 28, height: 28)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(fillUp.date, format: .dateTime.day().month(.abbreviated).year())
                        .font(.headline)
                    if fillUp.receiptPDF != nil {
                        Image(systemName: "doc.text.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityLabel("Har kvittering")
                    }
                }
                if showCar, let car = fillUp.car {
                    Text(car.displayName).font(.subheadline).foregroundStyle(.secondary)
                }
                Text("\(Formatting.liters(fillUp.liters)) · \(fillUp.fuelType.displayName) · \(Formatting.kilometers(fillUp.odometer))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 3) {
                Text(Formatting.currency(fillUp.totalPrice))
                    .font(.headline)
                    .monospacedDigit()
                if let ppl = fillUp.pricePerLiter {
                    Text(Formatting.pricePerLiter(ppl))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
        }
        .contentShape(Rectangle())
    }
}
