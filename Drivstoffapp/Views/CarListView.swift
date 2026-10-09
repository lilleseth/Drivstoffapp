import SwiftUI
import SwiftData

struct CarListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Car.name) private var cars: [Car]

    @State private var editingCar: Car?
    @State private var showNewCar = false
    @State private var carToDelete: Car?

    var body: some View {
        NavigationStack {
            Group {
                if cars.isEmpty {
                    ContentUnavailableView {
                        Label("Ingen biler", systemImage: "car")
                    } description: {
                        Text("Legg til bilene du vil føre drivstoffutgifter for.")
                    } actions: {
                        Button("Legg til bil") { showNewCar = true }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    List {
                        ForEach(cars) { car in
                            Button {
                                editingCar = car
                            } label: {
                                CarRow(car: car)
                            }
                            .buttonStyle(.plain)
                            .swipeActions {
                                Button("Slett", role: .destructive) { carToDelete = car }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Biler")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showNewCar = true
                    } label: {
                        Label("Legg til bil", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $showNewCar) { CarEditView(car: nil) }
            .sheet(item: $editingCar) { car in CarEditView(car: car) }
            .confirmationDialog(
                "Slette \(carToDelete?.name ?? "bil")?",
                isPresented: Binding(get: { carToDelete != nil }, set: { if !$0 { carToDelete = nil } }),
                titleVisibility: .visible
            ) {
                Button("Slett bil og alle fyllinger", role: .destructive) {
                    if let carToDelete { modelContext.delete(carToDelete) }
                    carToDelete = nil
                }
            } message: {
                Text("Alle \(carToDelete?.fillUps.count ?? 0) fyllinger og kvitteringer for bilen blir også slettet.")
            }
        }
    }
}

private struct CarRow: View {
    let car: Car

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(car.name).font(.headline)
                Text([car.licensePlate, car.defaultFuelType.displayName]
                        .filter { !$0.isEmpty }
                        .joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text(Formatting.currency(car.fillUps.reduce(0) { $0 + $1.totalPrice }))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                Text("\(car.fillUps.count) fyllinger")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
    }
}

#Preview {
    CarListView()
        .modelContainer(PreviewData.container)
}
