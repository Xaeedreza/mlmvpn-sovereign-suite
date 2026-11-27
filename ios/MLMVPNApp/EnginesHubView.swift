import SwiftUI

public struct EnginesHubView: View {
    @ObservedObject var coordinator = SovereignCoordinator.shared
    public var selectedEngine: EngineKind

    @State private var customUri = ""

    public init(selectedEngine: EngineKind = .v2ray) {
        self.selectedEngine = selectedEngine
    }

    public var body: some View {
        ZStack {
            SovereignTheme.velvetGradient.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 16) {
                    VelvetGlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Image(systemName: selectedEngine.symbolName)
                                    .font(.title2)
                                    .foregroundStyle(SovereignTheme.amberGlow)
                                Text(selectedEngine.titleFa)
                                    .font(.headline)
                                    .foregroundStyle(.white)
                            }
                            Text("پشتیبانی از هسته یکپارچه VLESS، VMess، Trojan، Hysteria2، TUIC، AnyTLS، WireGuard و استخرهای زنده Multi-Pool")
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.75))

                            HStack {
                                TextField("لینک سرور (vless:// / hy2:// / tuic:// ...)", text: $customUri)
                                    .textInputAutocapitalization(.never)
                                    .padding(10)
                                    .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
                                    .foregroundStyle(.white)
                                Button("اتصال") {
                                    coordinator.runMode = .fullVpn
                                    Task { await coordinator.toggleTunnel(selectedUri: customUri) }
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(SovereignTheme.amberGlow)
                            }

                            Button {
                                Task { await coordinator.refreshMultiPoolServers() }
                            } label: {
                                HStack {
                                    if coordinator.isBusy { ProgressView().tint(.black) }
                                    Image(systemName: "arrow.clockwise.circle.fill")
                                    Text("به‌روزرسانی مخازن جهانی سرور (\(coordinator.nodes.count) نود)")
                                        .bold()
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(SovereignTheme.champagne, in: RoundedRectangle(cornerRadius: 12))
                                .foregroundStyle(.black)
                            }
                        }
                    }

                    VelvetGlassCard {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("سرورهای آماده استخر")
                                .font(.subheadline.bold())
                                .foregroundStyle(.white)
                            if coordinator.nodes.isEmpty {
                                Text("دکمه به‌روزرسانی را بزنید تا از ۷ مخزن گیت‌هاب سرور دریافت شود.")
                                    .font(.caption)
                                    .foregroundStyle(.white.opacity(0.65))
                            }
                            ForEach(coordinator.nodes.prefix(40)) { node in
                                Button {
                                    coordinator.runMode = .fullVpn
                                    Task { await coordinator.toggleTunnel(selectedUri: node.uri) }
                                } label: {
                                    HStack {
                                        Text(node.protocolName)
                                            .font(.caption2.bold())
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 3)
                                            .background(SovereignTheme.roseGold.opacity(0.35), in: Capsule())
                                            .foregroundStyle(SovereignTheme.champagne)
                                        Text(node.name)
                                            .font(.callout)
                                            .foregroundStyle(.white)
                                            .lineLimit(1)
                                        Spacer()
                                        Text(node.source)
                                            .font(.caption2)
                                            .foregroundStyle(.white.opacity(0.55))
                                    }
                                    .padding(.vertical, 6)
                                }
                                Divider().overlay(Color.white.opacity(0.1))
                            }
                        }
                    }
                }
                .padding()
            }
        }
        .navigationTitle(selectedEngine.titleFa)
        .navigationBarTitleDisplayMode(.inline)
    }
}
