import Foundation
import Network
import NetworkExtension
import SwiftUI

@MainActor
public final class SovereignCoordinator: ObservableObject {

    public static let shared = SovereignCoordinator()

    @Published public var tunnelStatus: NEVPNStatus = .disconnected
    @Published public var runMode: TunnelRunMode = SovereignAppGroupStore.shared.activeMode
    @Published public var cfBypass: CfBypassConfig = SovereignAppGroupStore.shared.loadCfBypass()
    @Published public var accounts: [CfAccountModel] = SovereignAppGroupStore.shared.loadAccounts()
    @Published public var nodes: [VpnNodeModel] = SovereignAppGroupStore.shared.loadNodes()
    @Published public var cleanIps: [String] = SovereignAppGroupStore.shared.loadCleanIps()
    @Published public var sanctionDomains: [String] = SovereignAppGroupStore.shared.loadSanctionDomains()

    @Published public var activeEngine: EngineKind = .cfBypass
    @Published public var statusMessage: String = ""
    @Published public var isBusy: Bool = false

    private var manager: NETunnelProviderManager?
    private var observer: NSObjectProtocol?

    private init() {
        loadTunnelManager()
        observer = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: nil,
            queue: .main
        ) { [weak self] notif in
            guard let conn = notif.object as? NEVPNConnection else { return }
            self?.tunnelStatus = conn.status
        }
    }

    public func loadTunnelManager() {
        NETunnelProviderManager.loadAllFromPreferences { [weak self] list, _ in
            Task { @MainActor in
                if let existing = list?.first {
                    self?.manager = existing
                    self?.tunnelStatus = existing.connection.status
                }
            }
        }
    }

    public func persistAll() {
        SovereignAppGroupStore.shared.activeMode = runMode
        SovereignAppGroupStore.shared.saveCfBypass(cfBypass)
        SovereignAppGroupStore.shared.saveAccounts(accounts)
        SovereignAppGroupStore.shared.saveNodes(nodes)
        SovereignAppGroupStore.shared.saveCleanIps(cleanIps)
        SovereignAppGroupStore.shared.saveSanctionDomains(sanctionDomains)
    }

    public func toggleTunnel(selectedUri: String? = nil) async {
        if tunnelStatus == .connected || tunnelStatus == .connecting {
            manager?.connection.stopVPNTunnel()
            return
        }

        persistAll()
        let store = SovereignAppGroupStore.shared

        let targetUri: String
        if let selectedUri, !selectedUri.isEmpty {
            targetUri = selectedUri
        } else if !cfBypass.workerUrl.isEmpty {
            let host = cfBypass.workerUrl
                .replacingOccurrences(of: "https://", with: "")
                .replacingOccurrences(of: "http://", with: "")
                .components(separatedBy: "/").first ?? ""
            let server = cfBypass.cleanIp.isEmpty ? host : cfBypass.cleanIp
            targetUri = "vless://\(cfBypass.uuid)@\(server):443?encryption=none&security=tls&sni=\(host)&fp=chrome&type=ws&host=\(host)&path=%2F%3Fed%3D2560#CF-Edge-Pass"
        } else if let firstNode = nodes.first {
            targetUri = firstNode.uri
        } else {
            statusMessage = "ابتدا ورکر کلودفلر بسازید یا یک سرور از مخازن رایگان دریافت کنید."
            return
        }

        guard let outbound = SingBoxConfigBuilder.buildOutbound(from: targetUri) else {
            statusMessage = "لینک سرور نامعتبر است."
            return
        }

        do {
            let json = try SingBoxConfigBuilder.buildConfigJSON(
                outbound: outbound,
                mode: runMode,
                bypassDomains: cfBypass.effectiveDomains,
                cleanIpOverride: cfBypass.cleanIp
            )
            store.activeSingBoxJson = json
            store.activePacScript = SingBoxConfigBuilder.buildPacScript(domains: cfBypass.effectiveDomains)
            try await startNetworkExtension()
            statusMessage = runMode == .cfBypassOnly ? "سپر کلودفلر فعال شد." : "تونل کامل متصل شد."
        } catch {
            statusMessage = "خطا در راه‌اندازی تونل: \(error.localizedDescription)"
        }
    }

    private func startNetworkExtension() async throws {
        let mgr: NETunnelProviderManager
        if let existing = manager {
            mgr = existing
        } else {
            mgr = NETunnelProviderManager()
        }

        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = "com.mlmvpn.sovereign.app.tunnel"
        proto.serverAddress = "MLMVPN Sovereign Edge"
        mgr.protocolConfiguration = proto
        mgr.localizedDescription = runMode == .cfBypassOnly ? "MLMVPN سپر کلودفلر" : "MLMVPN Sovereign"
        mgr.isEnabled = true

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            mgr.saveToPreferences { err in
                if let err { cont.resume(throwing: err); return }
                mgr.loadFromPreferences { loadErr in
                    if let loadErr { cont.resume(throwing: loadErr); return }
                    cont.resume()
                }
            }
        }
        self.manager = mgr
        try mgr.connection.startVPNTunnel()
    }

    // MARK: - Cloudflare Workers API v4

    public func verifyAndAddAccount(token: String, email: String, label: String) async {
        isBusy = true
        defer { isBusy = false }
        let cleanToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)

        do {
            var req = URLRequest(url: URL(string: "https://api.cloudflare.com/client/v4/accounts?per_page=10")!)
            req.httpMethod = "GET"
            if cleanEmail.isEmpty || cleanToken.count != 37 {
                req.setValue("Bearer \(cleanToken)", forHTTPHeaderField: "Authorization")
            } else {
                req.setValue(cleanEmail, forHTTPHeaderField: "X-Auth-Email")
                req.setValue(cleanToken, forHTTPHeaderField: "X-Auth-Key")
            }

            let (data, _) = try await URLSession.shared.data(for: req)
            let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard let success = obj?["success"] as? Bool, success,
                  let results = obj?["result"] as? [[String: Any]],
                  let first = results.first,
                  let accId = first["id"] as? String else {
                statusMessage = "اعتبارسنجی کلودفلر ناموفق بود."
                return
            }

            let acc = CfAccountModel(
                name: label.isEmpty ? ((first["name"] as? String) ?? "Cloudflare") : label,
                email: cleanEmail,
                token: cleanToken,
                accountId: accId
            )
            if !accounts.contains(where: { $0.accountId == accId }) {
                accounts.append(acc)
                persistAll()
            }
            statusMessage = "حساب کلودفلر متصل شد: \(acc.name)"
        } catch {
            statusMessage = "خطای اتصال به کلودفلر: \(error.localizedDescription)"
        }
    }

    public func deployEdgePassWorker(account: CfAccountModel, workerName: String = "mlm-edge-pass") async {
        isBusy = true
        defer { isBusy = false }

        guard let scriptUrl = Bundle.main.url(forResource: "cf_edge_pass_worker", withExtension: "js"),
              let scriptSrc = try? String(contentsOf: scriptUrl, encoding: .utf8) else {
            statusMessage = "فایل cf_edge_pass_worker.js در باندل پیدا نشد."
            return
        }

        let boundary = "----MLMBoundary\(UUID().uuidString.prefix(8))"
        var body = Data()

        let metaDict: [String: Any] = [
            "main_module": "worker.js",
            "compatibility_date": "2024-11-01",
            "bindings": [
                ["name": "UUID", "type": "plain_text", "text": cfBypass.uuid]
            ]
        ]
        let metaData = (try? JSONSerialization.data(withJSONObject: metaDict)) ?? Data("{}".utf8)

        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n".utf8))
        body.append(metaData)
        body.append(Data("\r\n--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"worker.js\"; filename=\"worker.js\"\r\nContent-Type: application/javascript+module\r\n\r\n".utf8))
        body.append(Data(scriptSrc.utf8))
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        do {
            var putReq = URLRequest(url: URL(string: "https://api.cloudflare.com/client/v4/accounts/\(account.accountId)/workers/scripts/\(workerName)")!)
            putReq.httpMethod = "PUT"
            putReq.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            applyAuth(req: &putReq, account: account)
            putReq.httpBody = body
            let (_, resp) = try await URLSession.shared.data(for: putReq)
            guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                statusMessage = "خطا در آپلود ورکر روی کلودفلر."
                return
            }

            // Enable workers.dev route
            var subEn = URLRequest(url: URL(string: "https://api.cloudflare.com/client/v4/accounts/\(account.accountId)/workers/scripts/\(workerName)/subdomain")!)
            subEn.httpMethod = "POST"
            subEn.setValue("application/json", forHTTPHeaderField: "Content-Type")
            applyAuth(req: &subEn, account: account)
            subEn.httpBody = Data("{\"enabled\":true}".utf8)
            _ = try? await URLSession.shared.data(for: subEn)

            // Resolve subdomain prefix
            var subReq = URLRequest(url: URL(string: "https://api.cloudflare.com/client/v4/accounts/\(account.accountId)/workers/subdomain")!)
            applyAuth(req: &subReq, account: account)
            let (sData, _) = try await URLSession.shared.data(for: subReq)
            let sObj = try? JSONSerialization.jsonObject(with: sData) as? [String: Any]
            let subPrefix = (sObj?["result"] as? [String: Any])?["subdomain"] as? String ?? "workers"

            let finalUrl = "https://\(workerName).\(subPrefix).workers.dev"
            cfBypass.workerUrl = finalUrl
            persistAll()
            statusMessage = "ورکر سپر نصب شد: \(finalUrl)"
        } catch {
            statusMessage = "خطای دیپلوی ورکر: \(error.localizedDescription)"
        }
    }

    private func applyAuth(req: inout URLRequest, account: CfAccountModel) {
        if account.email.isEmpty || account.token.count != 37 {
            req.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
        } else {
            req.setValue(account.email, forHTTPHeaderField: "X-Auth-Email")
            req.setValue(account.token, forHTTPHeaderField: "X-Auth-Key")
        }
    }

    // MARK: - Multi-Pool Aggregator

    public func refreshMultiPoolServers() async {
        isBusy = true
        defer { isBusy = false }

        let sources: [(String, String)] = [
            ("0xRadikal", "https://cdn.jsdelivr.net/gh/0xRadikal/Free-v2ray-Configs@main/Sub1.txt"),
            ("MatinGhanbari-VLESS", "https://raw.githubusercontent.com/MatinGhanbari/v2ray-configs/main/subscriptions/filtered/subs/vless.txt"),
            ("MatinGhanbari-Hy2", "https://raw.githubusercontent.com/MatinGhanbari/v2ray-configs/main/subscriptions/filtered/subs/hysteria2.txt"),
            ("OpenRay", "https://raw.githubusercontent.com/sakha1370/OpenRay/main/output/all_valid_proxies.txt"),
            ("barry-far", "https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Sub1.txt"),
            ("Epodonios", "https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Sub1.txt"),
            ("NoMoreWalls", "https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list_raw.txt")
        ]

        var collected: [VpnNodeModel] = []
        await withTaskGroup(of: [VpnNodeModel].self) { group in
            for (name, urlStr) in sources {
                group.addTask {
                    guard let url = URL(string: urlStr),
                          let (data, _) = try? await URLSession.shared.data(from: url),
                          var text = String(data: data, encoding: .utf8) else { return [] }
                    if !text.contains("://"),
                       let decoded = Data(base64Encoded: text.trimmingCharacters(in: .whitespacesAndNewlines)),
                       let plain = String(data: decoded, encoding: .utf8) {
                        text = plain
                    }
                    let lines = text.components(separatedBy: .newlines)
                        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                        .filter { $0.hasPrefix("vless://") || $0.hasPrefix("vmess://") || $0.hasPrefix("trojan://") || $0.hasPrefix("hysteria2://") || $0.hasPrefix("hy2://") || $0.hasPrefix("tuic://") || $0.hasPrefix("ss://") || $0.hasPrefix("anytls://") }
                        .prefix(35)

                    return lines.map { uri in
                        let proto = uri.components(separatedBy: "://").first?.uppercased() ?? "NODE"
                        let tag = uri.components(separatedBy: "#").last?.removingPercentEncoding ?? "\(name) \(proto)"
                        return VpnNodeModel(name: String(tag.prefix(40)), uri: uri, protocolName: proto, source: name)
                    }
                }
            }
            for await batch in group {
                collected.append(contentsOf: batch)
            }
        }

        nodes = Array(collected.prefix(200))
        persistAll()
        statusMessage = "\(nodes.count) سرور چندپروتکلی دریافت شد."
    }

    // MARK: - Concurrent Clean-IP Scanner (NWConnection)

    public func scanCloudflareCleanIps() async {
        isBusy = true
        defer { isBusy = false }

        let candidates = [
            "104.16.132.229", "104.16.248.249", "104.17.147.22", "104.18.32.7",
            "104.21.48.84", "172.64.155.12", "172.67.182.94", "162.159.135.42",
            "162.159.192.1", "162.159.193.5", "188.114.96.3", "188.114.97.7"
        ]

        var working: [(String, Int)] = []
        await withTaskGroup(of: (String, Int?).self) { group in
            for ip in candidates {
                group.addTask {
                    let ms = await self.tcpProbe(host: ip, port: 443)
                    return (ip, ms)
                }
            }
            for await (ip, ms) in group {
                if let ms { working.append((ip, ms)) }
            }
        }

        working.sort { $0.1 < $1.1 }
        cleanIps = working.map { "\($0.0) (\($0.1)ms)" }
        if let best = working.first?.0 {
            cfBypass.cleanIp = best
        }
        persistAll()
        statusMessage = "اسکن کامل شد: \(working.count) آی‌پی تمیز یافت شد."
    }

    private func tcpProbe(host: String, port: UInt16) async -> Int? {
        await withCheckedContinuation { cont in
            let start = Date()
            let conn = NWConnection(
                host: NWEndpoint.Host(host),
                port: NWEndpoint.Port(rawValue: port) ?? 443,
                using: .tcp
            )
            var finished = false
            let lock = NSLock()
            func finish(_ val: Int?) {
                lock.lock()
                defer { lock.unlock() }
                guard !finished else { return }
                finished = true
                conn.cancel()
                cont.resume(returning: val)
            }
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    finish(Int(Date().timeIntervalSince(start) * 1000))
                case .failed, .cancelled:
                    finish(nil)
                default:
                    break
                }
            }
            conn.start(queue: .global(qos: .userInitiated))
            DispatchQueue.global().asyncAfter(deadline: .now() + 2.5) {
                finish(nil)
            }
        }
    }

    // MARK: - Sovereign Sync

    public func exportSyncBundle(passphrase: String) throws -> String {
        let snap = SovereignSnapshot(
            accounts: accounts,
            cfBypass: cfBypass,
            sanctionDomains: sanctionDomains
        )
        return try SovereignCryptoSync.encryptBundle(snapshot: snap, passphrase: passphrase)
    }

    public func importSyncBundle(_ bundle: String, passphrase: String) throws {
        let snap = try SovereignCryptoSync.decryptBundle(bundleString: bundle, passphrase: passphrase)
        for acc in snap.accounts where !accounts.contains(where: { $0.accountId == acc.accountId }) {
            accounts.append(acc)
        }
        if !snap.cfBypass.workerUrl.isEmpty { cfBypass.workerUrl = snap.cfBypass.workerUrl }
        if !snap.cfBypass.cleanIp.isEmpty { cfBypass.cleanIp = snap.cfBypass.cleanIp }
        if !snap.cfBypass.uuid.isEmpty { cfBypass.uuid = snap.cfBypass.uuid }
        let mergedPacks = Set(cfBypass.packs).union(snap.cfBypass.packs)
        cfBypass.packs = Array(mergedPacks)
        let mergedDomains = Set(cfBypass.customDomains).union(snap.cfBypass.customDomains)
        cfBypass.customDomains = Array(mergedDomains).sorted()
        let mergedSanctions = Set(sanctionDomains).union(snap.sanctionDomains)
        sanctionDomains = Array(mergedSanctions).sorted()
        persistAll()
        statusMessage = "همگام‌سازی کامل شد."
    }
}
