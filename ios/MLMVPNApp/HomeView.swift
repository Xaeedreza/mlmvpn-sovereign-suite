import NetworkExtension
import SwiftUI

public struct HomeView: View {
    @ObservedObject var coordinator = SovereignCoordinator.shared

    let columns = [GridItem(.adaptive(minimum: 84), spacing: 14)]

    public init() {}

    public var body: some View {
        NavigationStack {
            ZStack {
                SovereignTheme.velvetGradient.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        headerBar

                        SovereignOrbButton(
                            isConnected: coordinator.tunnelStatus == .connected,
                            isConnecting: coordinator.tunnelStatus == .connecting,
                            title: statusLabel,
                            subtitle: coordinator.runMode.titleFa
                        ) {
                            Task { await coordinator.toggleTunnel() }
                        }

                        modePickerCard

                        if !coordinator.statusMessage.isEmpty {
                            Text(coordinator.statusMessage)
                                .font(.caption)
                                .foregroundStyle(SovereignTheme.champagne)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(SovereignTheme.glassCard, in: Capsule())
                        }

                        quickLaunchGrid
                    }
                    .padding()
                }
            }
            .navigationBarHidden(true)
        }
    }

    private var statusLabel: String {
        switch coordinator.tunnelStatus {
        case .connected: return "متصل و ایمن"
        case .connecting: return "در حال اتصال..."
        case .disconnecting: return "در حال قطع..."
        default: return "اتصال فوری"
        }
    }

    private var headerBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("MLMVPN Sovereign")
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
                Text("معماری یکپارچه ویندوز • اندروید • iOS")
                    .font(.caption)
                    .foregroundStyle(SovereignTheme.champagne.opacity(0.75))
            }
            Spacer()
            NavigationLink(destination: SovereignSyncView()) {
                Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(SovereignTheme.amberGlow)
            }
        }
    }

    private var modePickerCard: some View {
        VelvetGlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("حالت عبور ترافیک")
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)

                Picker("حالت", selection: $coordinator.runMode) {
                    ForEach(TunnelRunMode.allCases) { mode in
                        Text(mode.titleFa).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .onChange(of: coordinator.runMode) { _ in
                    coordinator.persistAll()
                }

                Text(coordinator.runMode == .cfBypassOnly
                     ? "فقط سایت‌ها و دامنه‌های سپر کلودفلر عبور می‌کنند؛ سایت‌های داخلی و بانکی مستقیم می‌مانند."
                     : "تمام ترافیک دستگاه با هسته sing-box از تونل رمزنگاری‌شده عبور می‌کند.")
                    .font(.caption)
                    .foregroundStyle(Color.white.opacity(0.72))
            }
        }
    }

    private var quickLaunchGrid: some View {
        VelvetGlassCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("موتورها و ابزارهای Sovereign")
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)

                LazyVGrid(columns: columns, spacing: 14) {
                    ForEach(EngineKind.allCases) { engine in
                        NavigationLink(destination: destinationView(for: engine)) {
                            VStack(spacing: 6) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .fill(
                                            LinearGradient(
                                                colors: [SovereignTheme.roseGold.opacity(0.75), SovereignTheme.amberGlow.opacity(0.65)],
                                                startPoint: .topLeading,
                                                endPoint: .bottomTrailing
                                            )
                                        )
                                        .frame(width: 56, height: 56)
                                    Image(systemName: engine.symbolName)
                                        .font(.system(size: 22, weight: .semibold))
                                        .foregroundStyle(.white)
                                }
                                Text(engine.titleFa)
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(.white)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func destinationView(for engine: EngineKind) -> some View {
        switch engine {
        case .cfBypass:
            CfBypassView()
        case .githubTunnel, .gst, .vodi, .tgproxy:
            CloudManagerView()
        default:
            EnginesHubView(selectedEngine: engine)
        }
    }
}
