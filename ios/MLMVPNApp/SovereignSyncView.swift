import SwiftUI

public struct SovereignSyncView: View {
    @ObservedObject var coordinator = SovereignCoordinator.shared
    @State private var passphrase = ""
    @State private var bundleText = ""
    @State private var alertMsg = ""

    public init() {}

    public var body: some View {
        ZStack {
            SovereignTheme.velvetGradient.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 16) {
                    VelvetGlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Image(systemName: "lock.rotation").foregroundStyle(SovereignTheme.amberGlow)
                                Text("همگام‌سازی یکپارچه با ویندوز و اندروید")
                                    .font(.headline)
                                    .foregroundStyle(.white)
                            }
                            Text("بسته‌های رمزنگاری‌شده با استاندارد مشترک AES-256-GCM و PBKDF2-SHA256 (فرمت mlmsync://v1/) ساخته می‌شوند.")
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.75))

                            SecureField("رمز مشترک همگام‌سازی (حداقل ۶ کاراکتر)", text: $passphrase)
                                .padding(10)
                                .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
                                .foregroundStyle(.white)

                            TextEditor(text: $bundleText)
                                .frame(minHeight: 110)
                                .scrollContentBackground(.hidden)
                                .padding(8)
                                .background(Color.black.opacity(0.3), in: RoundedRectangle(cornerRadius: 12))
                                .foregroundStyle(SovereignTheme.champagne)
                                .font(.caption.monospaced())

                            HStack(spacing: 10) {
                                Button("خروجی و کپی") {
                                    do {
                                        let code = try coordinator.exportSyncBundle(passphrase: passphrase)
                                        bundleText = code
                                        UIPasteboard.general.string = code
                                        alertMsg = "بسته همگام‌سازی تولید و کپی شد."
                                    } catch {
                                        alertMsg = error.localizedDescription
                                    }
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(SovereignTheme.amberGlow, in: RoundedRectangle(cornerRadius: 12))
                                .foregroundStyle(.black)

                                Button("ورود از کد") {
                                    do {
                                        try coordinator.importSyncBundle(bundleText, passphrase: passphrase)
                                        alertMsg = "همه حساب‌ها و دامنه‌ها با موفقیت همگام شدند."
                                    } catch {
                                        alertMsg = error.localizedDescription
                                    }
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(SovereignTheme.emeraldConnected, in: RoundedRectangle(cornerRadius: 12))
                                .foregroundStyle(.white)
                            }

                            if !alertMsg.isEmpty {
                                Text(alertMsg)
                                    .font(.caption)
                                    .foregroundStyle(SovereignTheme.champagne)
                            }
                        }
                    }
                }
                .padding()
            }
        }
        .navigationTitle("همگام‌سازی دستگاه‌ها")
        .navigationBarTitleDisplayMode(.inline)
    }
}
