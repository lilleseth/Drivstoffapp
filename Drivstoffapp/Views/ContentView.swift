import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            FillUpListView()
                .tabItem { Label("Fyllinger", systemImage: "fuelpump") }
            StatisticsView()
                .tabItem { Label("Statistikk", systemImage: "chart.bar") }
            CarListView()
                .tabItem { Label("Biler", systemImage: "car.2") }
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(PreviewData.container)
}
