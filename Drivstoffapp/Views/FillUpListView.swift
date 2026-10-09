import SwiftUI
import SwiftData

struct FillUpListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \FillUp.date, order: .reverse) private var fillUps: [FillUp]
    @Query(sort: \Car.name) private var cars: [Car]

    @State private var carFilter: Car?
    @State private var editorTarget: EditorTarget?

    private var filtered: [FillUp] {
        guard let carFilter else { return fillUps }
        return fillUps.filter { $0.car == carFilter }
    }

    var body: some View {
        NavigationStack {
            Group {
                if cars.isEmpty {
                    ContentUnavailableView(
                        "Ingen biler",
                        systemImage: "car",
                        description: Text("Legg til en bil under «Biler» før du registrerer fyllinger.")
                    )
                } else if filtered.isEmpty {
                    ContentUnavailableView {
                        Label("Ingen fyllinger", systemImage: "fuelpump")
                    } description: {
                        Text("Trykk + for å registrere en fylling, eller skann en kvittering.")
                    } actions: {
                        Button("Ny fylling") { editorTarget = .new }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    list
                }
            }
            .navigationTitle("Fyllinger")
            .toolbar {
                if cars.count > 1 {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            Picker("Bil", selection: $carFilter) {
                                Text("Alle biler").tag(Car?.none)
                                ForEach(cars) { car in
                                    Text(car.displayName).tag(Car?.some(car))
                                }
                            }
                        } label: {
                            Label("Filter", systemImage: carFilter == nil
                                  ? "line.3.horizontal.decrease.circle"
                                  : "line.3.horizontal.decrease.circle.fill")
                        }
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        editorTarget = .new
                    } label: {
                        Label("Ny fylling", systemImage: "plus")
                    }
                    .disabled(cars.isEmpty)
                }
            }
            .sheet(item: $editorTarget) { target in
                switch target {
                case .new:
                    FillUpEditView(fillUp: nil, preselectedCar: carFilter)
                case .edit(let fillUp):
                    FillUpEditView(fillUp: fillUp, preselectedCar: nil)
                }
            }
        }
    }

    private var list: some View {
        List {
            Section {
                HStack {
                    SummaryValue(title: "Totalt", value: Formatting.currency(filtered.reduce(0) { $0 + $1.totalPrice }))
                    Divider()
                    SummaryValue(title: "Liter", value: Formatting.liters(filtered.reduce(0) { $0 + $1.liters }))
                    Divider()
                    SummaryValue(title: "Fyllinger", value: "\(filtered.count)")
                }
                .padding(.vertical, 4)
            }

            Section {
                ForEach(filtered) { fillUp in
                    Button {
                        editorTarget = .edit(fillUp)
                    } label: {
                        FillUpRow(fillUp: fillUp, showCar: carFilter == nil && cars.count > 1)
                    }
                    .buttonStyle(.plain)
                }
                .onDelete { offsets in
                    for index in offsets {
                        modelContext.delete(filtered[index])
                    }
                }
            }
        }
    }
}

enum EditorTarget: Identifiable {
    case new
    case edit(FillUp)

    var id: AnyHashable {
        switch self {
        case .new: AnyHashable("new")
        case .edit(let fillUp): AnyHashable(fillUp.persistentModelID)
        }
    }
}

struct SummaryValue: View {
    let title: String
    let value: String

    var body: some View {
        VStack(spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }
}

#Preview {
    FillUpListView()
        .modelContainer(PreviewData.container)
}
