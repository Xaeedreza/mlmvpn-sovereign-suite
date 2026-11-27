import SwiftUI

public struct CfBypassView: View {
    @ObservedObject var coordinator = SovereignCoordinator.shared
    @State private var newDomain = ""
    @State private var workerInput = ""
    @State private var cleanIpInput = ""

    public init() {}

    public var body: some View {
        ZStack {
            SovereignTheme.velvetGradient.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 16) {
                    heroHeader

                    packsSection

                    customDomainsSection

                    workerSection
                }
                .padding()
            }
        }
        .navigationTitle("سپر کلودفلر بدون فیلترشکن")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            workerInput = coordinator.cfBypass.workerUrl
            cleanIpInput = coordinator.cfBypass.cleanIp
        }
    }

    private var heroHeader: some View {
        VelvetGlassCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "cloud.bolt.fill")
                        .font(.title2)
                        .foregroundStyle(SovereignTheme.amberGlow)
                    Text("Zero-VPN Cloudflare Edge Pass")
                        .font(.headline)
                        .foregroundStyle(.white)
                    Spacer()
                    Text("\(coordinator.cfBypass.effectiveDomains.count) دامنه")
                        .font(.caption.bold())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(SovereignTheme.amberGlow.opacity(0.25), in: Capsule())
                        .foregroundStyle(SovereignTheme.champagne)
                }
                Text("بدون روشن کردن VPN کل گوشی، فقط دامنه‌های تحریمی از روی Edge Worker و آی‌پی تمیز کلودفلر باز می‌شوند.")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.75))

                Button {
                    coordinator.runMode = .cfBypassOnly
                    Task { await coordinator.toggleTunnel() }
                } label: {
                    HStack {
                        Image(systemName: coordinator.tunnelStatus == .connected ? "stop.circle.fill" : "play.circle.fill")
                        Text(coordinator.tunnelStatus == .connected ? "خاموش کردن سپر" : "روشن کردن سپر بدون فیلترشکن")
                            .bold()
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(SovereignTheme.amberGlow, in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(.black)
                }
            }
        }
    }

    private var packsSection: some View {
        VelvetGlassCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("بسته‌های آماده دامنه‌ها")
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)

                ForEach(CfBypassDomainPack.allPacks) { pack in
                    Toggle(isOn: Binding(
                        get: { coordinator.cfBypass.packs.contains(pack.id) },
                        set: { enabled in
                            if enabled {
                                if !coordinator.cfBypass.packs.contains(pack.id) {
                                    coordinator.cfBypass.packs.append(pack.id)
                                }
                            } else {
                                coordinator.cfBypass.packs.removeAll { $0 == pack.id }
                            }
                            coordinator.persistAll()
                        }
                    )) {
                        VStack(alignment: .leading) {
                            Text(pack.titleFa).foregroundStyle(.white).font(.subheadline)
                            Text("\(pack.domains.count) دامنه").foregroundStyle(.white.opacity(0.6)).font(.caption2)
                        }
                    }
                    .tint(SovereignTheme.amberGlow)
                }
            }
        }
    }

    private var customDomainsSection: some View {
        VelvetGlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("دامنه‌های دلخواه شما")
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)

                HStack {
                    TextField("مثلاً chatgpt.com", text: $newDomain)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(10)
                        .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
                        .foregroundStyle(.white)
                    Button("افزودن") {
                        let clean = newDomain.trimmingCharacters(in: .whitespacesAndNewlines)
                            .lowercased()
                            .replacingOccurrences(of: "https://", with: "")
                            .replacingOccurrences(of: "http://", with: "")
                            .components(separatedBy: "/").first ?? ""
                        if clean.contains(".") {
                            if !coordinator.cfBypass.customDomains.contains(clean) {
                                coordinator.cfBypass.customDomains.append(clean)
                                coordinator.persistAll()
                            }
                            newDomain = ""
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(SovereignTheme.roseGold)
                }

                ForEach(coordinator.cfBypass.customDomains, id: \.self) { dom in
                    HStack {
                        Text(dom).foregroundStyle(.white).font(.callout)
                        Spacer()
                        Button(role: .destructive) {
                            coordinator.cfBypass.customDomains.removeAll { $0 == dom }
                            coordinator.persistAll()
                        } label: {
                            Image(systemName: "trash")
                        }
                    }
                }
            }
        }
    }

    private var workerSection: some View {
        VelvetGlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("تنظیمات Worker و آی‌پی تمیز")
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)

                TextField("https://mlm-edge-pass.xxx.workers.dev", text: $workerInput)
                    .textInputAutocapitalization(.never)
                    .padding(10)
                    .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(.white)
                    .onChange(of: workerInput) { val in
                        coordinator.cfBypass.workerUrl = val.trimmingCharacters(in: .whitespacesAndNewlines)
                        coordinator.persistAll()
                    }

                TextField("آی‌پی تمیز (اختیاری)", text: $cleanIpInput)
                    .textInputAutocapitalization(.never)
                    .padding(10)
                    .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(.white)
                    .onChange(of: cleanIpInput) { val in
                        coordinator.cfBypass.cleanIp = val.trimmingCharacters(in: .whitespacesAndNewlines)
                        coordinator.persistAll()
                    }

                if let firstAcc = coordinator.accounts.first {
                    Button {
                        Task {
                            await coordinator.deployEdgePassWorker(account: firstAcc)
                            workerInput = coordinator.cfBypass.workerUrl
                        }
                    } label: {
                        HStack {
                            if coordinator.isBusy { ProgressView().tint(.white) }
                            Text("نصب خودکار ورکر روی کلودفلر (\(firstAcc.name))")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(SovereignTheme.roseGold, in: RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(.white)
                    }
                }
            }
        }
    }
}
