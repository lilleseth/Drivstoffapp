import SwiftUI
import SwiftData

struct CarEditView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let car: Car?

    @State private var name = ""
    @State private var licensePlate = ""
    @State private var fuelType: FuelType = .bensin

    private var trimmedName: String { name.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Navn (f.eks. «Familiebilen» eller «Tesla»)", text: $name)
                    TextField("Registreringsnummer", text: $licensePlate)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                }
                Section {
                    Picker("Drivstoff", selection: $fuelType) {
                        ForEach(FuelType.allCases) { Text($0.displayName).tag($0) }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Standard drivstoff")
                } footer: {
                    Text("Velges automatisk når du registrerer en fylling på denne bilen.")
                }
            }
            .navigationTitle(car == nil ? "Ny bil" : "Endre bil")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Avbryt") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Lagre", action: save).disabled(trimmedName.isEmpty)
                }
            }
            .onAppear {
                if let car {
                    name = car.name
                    licensePlate = car.licensePlate
                    fuelType = car.defaultFuelType
                }
            }
        }
    }

    private func save() {
        let plate = licensePlate.trimmingCharacters(in: .whitespaces).uppercased()
        if let car {
            car.name = trimmedName
            car.licensePlate = plate
            car.defaultFuelType = fuelType
        } else {
            modelContext.insert(Car(name: trimmedName, licensePlate: plate, defaultFuelType: fuelType))
        }
        dismiss()
    }
}
