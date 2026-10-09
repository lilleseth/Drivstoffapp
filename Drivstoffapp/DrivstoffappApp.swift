import SwiftUI
import SwiftData

@main
struct DrivstoffappApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: [Car.self, FillUp.self])
    }
}
