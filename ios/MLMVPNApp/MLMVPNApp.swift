import SwiftUI

@main
public struct MLMVPNSovereignApp: App {
    public init() {}

    public var body: some Scene {
        WindowGroup {
            MainTabRootView()
                .environment(\.layoutDirection, .rightToLeft)
                .preferredColorScheme(.dark)
        }
    }
}

public struct MainTabRootView: View {
    public init() {}

    public var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("خانه", systemImage: "house.fill")
                }

            NavigationStack { CfBypassView() }
                .tabItem {
                    Label("سپر CF", systemImage: "cloud.bolt.fill")
                }

            NavigationStack { EnginesHubView() }
                .tabItem {
                    Label("موتورها", systemImage: "bolt.shield.fill")
                }

            NavigationStack { CleanIPScannerView() }
                .tabItem {
                    Label("اسکنر IP", systemImage: "dot.radiowaves.left.and.right")
                }

            NavigationStack { CloudManagerView() }
                .tabItem {
                    Label("کلودفلر", systemImage: "cloud.fill")
                }
        }
        .tint(SovereignTheme.amberGlow)
    }
}
