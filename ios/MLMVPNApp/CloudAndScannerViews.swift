import SwiftUI

public struct CloudManagerView: View {
    @ObservedObject var coordinator = SovereignCoordinator.shared
    @State private var token = ""
    @State private var email = ""
    @State private var label = ""

    public init() {}

    public var body: some View {
        ZStack {
            SovereignTheme.velvetGradient.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 16) {
                    VelvetGlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("افزودن حساب کلودفلر (Workers & KV)")
                                .font(.subheadline.bold())
                                .foregroundStyle(.white)
                            TextField("نام دلخواه (مثلاً Main)", text: $label)
                                .padding(10)
                                .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
                                .foregroundStyle(.white)
                            TextField("Cloudflare API Token یا Global Key", text: $token)
                                .textInputAutocapitalization(.never)
                                .padding(10)
                                .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
                                .foregroundStyle(.white)
                            TextField("ایمیل (فقط برای Global API Key)", text: $email)
                                .textInputAutocapitalization(.never)
                                .padding(10)
                                .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
                                .foregroundStyle(.white)

                            Button {
                                Task {
                                    await coordinator.verifyAndAddAccount(token: token, email: email, label: label)
                                    token = ""; email = ""; label = ""
                                }
                            } label: {
                                HStack {
                                    if coordinator.isBusy { ProgressView().tint(.black) }
                                    Text("اعتبارسنجی و ذخیره حساب کلودفلر").bold()
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(SovereignTheme.amberGlow, in: RoundedRectangle(cornerRadius: 12))
                                .foregroundStyle(.black)
                            }
                        }
                    }

                    ForEach(coordinator.accounts) { acc in
                        VelvetGlassCard {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Image(systemName: "cloud.fill").foregroundStyle(SovereignTheme.amberGlow)
                                    Text(acc.name).font(.headline).foregroundStyle(.white)
                                    Spacer()
                                    Text(acc.accountId.prefix(8) + "...").font(.caption2).foregroundStyle(.white.opacity(0.6))
                                }
                                if !acc.edgWorkerUrl.isEmpty {
                                    Text("EDG: \(acc.edgWorkerUrl)").font(.caption).foregroundStyle(SovereignTheme.champagne)
                                }
                                Button {
                                    Task { await coordinator.deployEdgePassWorker(account: acc) }
                                } label: {
                                    Text("دیپلوی / بروزرسانی ورکر سپر کلودفلر")
                                        .font(.caption.bold())
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 8)
                                        .background(SovereignTheme.roseGold, in: RoundedRectangle(cornerRadius: 10))
                                        .foregroundStyle(.white)
                                }
                            }
                        }
                    }
                }
                .padding()
            }
        }
        .navigationTitle("ابر کلودفلر و ورکرها")
        .navigationBarTitleDisplayMode(.inline)
    }
}

public struct CleanIPScannerView: View {
    @ObservedObject var coordinator = SovereignCoordinator.shared

    public init() {}

    public var body: some View {
        ZStack {
            SovereignTheme.velvetGradient.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 16) {
                    VelvetGlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("اسکنر هوشمند آی‌پی تمیز کلودفلر (NWConnection)")
                                .font(.subheadline.bold())
                                .foregroundStyle(.white)
                            Text("تست همزمان پینگ TCP/TLS روی رنج‌های Edge کلودفلر و انتخاب سریع‌ترین آی‌پی برای سپر بدون فیلترشکن و V2Ray")
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.75))

                            Button {
                                Task { await coordinator.scanCloudflareCleanIps() }
                            } label: {
                                HStack {
                                    if coordinator.isBusy { ProgressView().tint(.black) }
                                    Image(systemName: "dot.radiowaves.left.and.right")
                                    Text("شروع اسکن سریع").bold()
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 11)
                                .background(SovereignTheme.amberGlow, in: RoundedRectangle(cornerRadius: 12))
                                .foregroundStyle(.black)
                            }
                        }
                    }

                    VelvetGlassCard {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("نتایج اسکن")
                                .font(.subheadline.bold())
                                .foregroundStyle(.white)
                            ForEach(coordinator.cleanIps, id: \.self) { row in
                                Button {
                                    let ipOnly = row.components(separatedBy: " ").first ?? row
                                    coordinator.cfBypass.cleanIp = ipOnly
                                    coordinator.persistAll()
                                    coordinator.statusMessage = "آی‌پی تمیز انتخاب شد: \(ipOnly)"
                                } label: {
                                    HStack {
                                        Image(systemName: "checkmark.seal.fill").foregroundStyle(SovereignTheme.emeraldConnected)
                                        Text(row).foregroundStyle(.white).font(.callout.monospaced())
                                        Spacer()
                                        Text("انتخاب").font(.caption).foregroundStyle(SovereignTheme.champagne)
                                    }
                                    .padding(.vertical, 4)
                                }
                                Divider().overlay(Color.white.opacity(0.1))
                            }
                        }
                    }
                }
                .padding()
            }
        }
        .navigationTitle("اسکنر آی‌پی تمیز")
        .navigationBarTitleDisplayMode(.inline)
    }
}
