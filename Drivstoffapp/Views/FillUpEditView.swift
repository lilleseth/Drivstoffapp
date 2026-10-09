import SwiftUI
import SwiftData
import PhotosUI

/// Skjema for ny eller eksisterende fylling. Kan fylles ut manuelt eller ved å skanne kvitteringen.
struct FillUpEditView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Car.name) private var cars: [Car]
    @Query(sort: \FillUp.date, order: .reverse) private var allFillUps: [FillUp]

    let fillUp: FillUp?
    let preselectedCar: Car?

    @State private var car: Car?
    @State private var fuelType: FuelType = .bensin
    @State private var date: Date = .now
    @State private var litersText = ""
    @State private var totalText = ""
    @State private var odometerText = ""
    @State private var station = ""
    @State private var notes = ""
    @State private var receiptPDF: Data?

    @State private var didLoad = false
    @State private var showScanner = false
    @State private var photoItem: PhotosPickerItem?
    @State private var isProcessing = false
    @State private var scanSummary: String?
    @State private var recognizedText: [String] = []
    @State private var showReceipt = false
    @State private var fuelTypeFromScan = false

    private enum Field { case liters, total, odometer }
    @FocusState private var focusedField: Field?

    // MARK: - Utledede verdier

    private var liters: Double? { Double(flexible: litersText) }
    private var total: Double? { Double(flexible: totalText) }
    private var odometer: Int? {
        Int(odometerText.filter(\.isNumber))
    }
    private var pricePerLiter: Double? {
        guard let liters, let total else { return nil }
        return FillUp.pricePerLiter(liters: liters, totalPrice: total)
    }

    /// Forrige fylling på samme bil (før denne datoen), brukt til validering og forbruk.
    private var previousFillUp: FillUp? {
        guard let car else { return nil }
        return allFillUps.first { $0.car == car && $0 != fillUp && $0.date <= date }
    }

    private var odometerWarning: String? {
        guard let odometer, let previous = previousFillUp, odometer <= previous.odometer else { return nil }
        return "Lavere enn forrige fylling (\(Formatting.kilometers(previous.odometer)))."
    }

    private var canSave: Bool {
        car != nil && (liters ?? 0) > 0 && (total ?? 0) > 0 && (odometer ?? 0) > 0
    }

    // MARK: - Visning

    var body: some View {
        NavigationStack {
            Form {
                receiptSection
                carSection
                fuelSection
                odometerSection
                otherSection
            }
            .navigationTitle(fillUp == nil ? "Ny fylling" : "Endre fylling")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Avbryt") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Lagre", action: save).disabled(!canSave)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Ferdig") { focusedField = nil }
                }
            }
            .onAppear(perform: loadIfNeeded)
            .onChange(of: car) { _, newCar in
                // Ny bil valgt: bruk bilens drivstofftype, med mindre kvitteringen sa noe annet.
                // Ved redigering beholdes lagret drivstofftype.
                if fillUp == nil, let newCar, !fuelTypeFromScan { fuelType = newCar.defaultFuelType }
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task { await loadPhoto(item) }
            }
            .fullScreenCover(isPresented: $showScanner) {
                DocumentScannerView { images in
                    showScanner = false
                    Task { await process(images) }
                } onCancel: {
                    showScanner = false
                }
                .ignoresSafeArea()
            }
            .sheet(isPresented: $showReceipt) {
                if let receiptPDF {
                    ReceiptView(pdfData: receiptPDF, fileName: receiptFileName)
                }
            }
            .overlay {
                if isProcessing {
                    ProgressView("Leser kvittering …")
                        .padding(24)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                }
            }
            .disabled(isProcessing)
        }
    }

    private var receiptSection: some View {
        Section {
            if DocumentScannerView.isSupported {
                Button {
                    showScanner = true
                } label: {
                    Label(receiptPDF == nil ? "Skann kvittering" : "Skann på nytt", systemImage: "doc.viewfinder")
                }
            }
            PhotosPicker(selection: $photoItem, matching: .images) {
                Label("Velg bilde av kvittering", systemImage: "photo.on.rectangle")
            }

            if let scanSummary {
                Label(scanSummary, systemImage: "text.viewfinder")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if receiptPDF != nil {
                Button {
                    showReceipt = true
                } label: {
                    Label("Vis kvittering (PDF)", systemImage: "doc.richtext")
                }
                Button("Fjern kvittering", role: .destructive) {
                    receiptPDF = nil
                    scanSummary = nil
                    recognizedText = []
                }
            }

            if !recognizedText.isEmpty {
                DisclosureGroup("Gjenkjent tekst") {
                    Text(recognizedText.joined(separator: "\n"))
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                }
            }
        } header: {
            Text("Kvittering")
        } footer: {
            Text("Skann kvitteringen for å fylle ut feltene automatisk. Kontroller alltid verdiene før du lagrer.")
        }
    }

    private var carSection: some View {
        Section("Bil") {
            Picker("Bil", selection: $car) {
                if car == nil {
                    Text("Velg bil").tag(Car?.none)
                }
                ForEach(cars) { car in
                    Text(car.displayName).tag(Car?.some(car))
                }
            }
            Picker("Drivstoff", selection: $fuelType) {
                ForEach(FuelType.allCases) { type in
                    Text(type.displayName).tag(type)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    private var fuelSection: some View {
        Section("Fylling") {
            DatePicker("Dato", selection: $date)

            LabeledContent("Antall liter") {
                TextField("0,00", text: $litersText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .focused($focusedField, equals: .liters)
            }
            LabeledContent("Totalpris (kr)") {
                TextField("0,00", text: $totalText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .focused($focusedField, equals: .total)
            }
            LabeledContent("Literpris") {
                Text(pricePerLiter.map(Formatting.pricePerLiter) ?? "–")
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var odometerSection: some View {
        Section {
            LabeledContent("Km-stand ved fylling") {
                TextField("km", text: $odometerText)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .focused($focusedField, equals: .odometer)
            }
        } header: {
            Text("Kilometerstand")
        } footer: {
            if let odometerWarning {
                Label(odometerWarning, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            } else if let previous = previousFillUp {
                if let odometer, odometer > previous.odometer {
                    Text("\(Formatting.kilometers(odometer - previous.odometer)) siden forrige fylling.")
                } else {
                    Text("Forrige fylling: \(Formatting.kilometers(previous.odometer)).")
                }
            }
        }
    }

    private var otherSection: some View {
        Section("Annet") {
            TextField("Stasjon", text: $station)
            TextField("Notat", text: $notes, axis: .vertical)
        }
    }

    private var receiptFileName: String {
        let day = date.formatted(.iso8601.year().month().day())
        return "Kvittering \(car?.name ?? "") \(day).pdf"
    }

    // MARK: - Handlinger

    private func loadIfNeeded() {
        guard !didLoad else { return }
        didLoad = true

        if let fillUp {
            car = fillUp.car
            fuelType = fillUp.fuelType
            date = fillUp.date
            litersText = Self.format(fillUp.liters)
            totalText = Self.format(fillUp.totalPrice)
            odometerText = String(fillUp.odometer)
            station = fillUp.station
            notes = fillUp.notes
            receiptPDF = fillUp.receiptPDF
        } else {
            // Forhåndsvelg filtrert bil, ellers bilen fra siste fylling, ellers første bil.
            car = preselectedCar ?? allFillUps.first?.car ?? cars.first
            fuelType = car?.defaultFuelType ?? .bensin
        }
    }

    private func loadPhoto(_ item: PhotosPickerItem) async {
        defer { photoItem = nil }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else {
            scanSummary = "Kunne ikke lese bildet."
            return
        }
        await process([image])
    }

    private func process(_ images: [UIImage]) async {
        guard !images.isEmpty else { return }
        isProcessing = true
        defer { isProcessing = false }

        receiptPDF = PDFBuilder.makePDF(from: images)
        let lines = await TextRecognizer.recognizeLines(in: images)
        recognizedText = lines
        let parsed = ReceiptParser.parse(lines: lines)
        apply(parsed)
    }

    private func apply(_ parsed: ParsedReceipt) {
        var found: [String] = []
        if let liters = parsed.liters {
            litersText = Self.format(liters)
            found.append("liter")
        }
        if let total = parsed.totalPrice {
            totalText = Self.format(total)
            found.append("beløp")
        }
        if let type = parsed.fuelType {
            fuelType = type
            fuelTypeFromScan = true
            found.append("drivstoff")
        }
        if let date = parsed.date {
            self.date = date
            found.append("dato")
        }
        if let station = parsed.station, self.station.isEmpty {
            self.station = station
            found.append("stasjon")
        }

        scanSummary = found.isEmpty
            ? "Fant ingen verdier automatisk – fyll inn manuelt. Kvitteringen er lagret."
            : "Fant \(ListFormatter.localizedString(byJoining: found)). Kontroller verdiene."
    }

    private func save() {
        guard let car, let liters, let total, let odometer else { return }

        if let fillUp {
            fillUp.car = car
            fillUp.fuelType = fuelType
            fillUp.date = date
            fillUp.liters = liters
            fillUp.totalPrice = total
            fillUp.odometer = odometer
            fillUp.station = station
            fillUp.notes = notes
            fillUp.receiptPDF = receiptPDF
        } else {
            let newFillUp = FillUp(
                date: date,
                liters: liters,
                totalPrice: total,
                odometer: odometer,
                fuelType: fuelType,
                station: station,
                notes: notes,
                receiptPDF: receiptPDF,
                car: car
            )
            modelContext.insert(newFillUp)
        }
        dismiss()
    }

    private static func format(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)).grouping(.never))
    }
}

#Preview {
    FillUpEditView(fillUp: nil, preselectedCar: nil)
        .modelContainer(PreviewData.container)
}
