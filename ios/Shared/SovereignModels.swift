import Foundation

public enum SovereignConstants {
    public static let appGroupId = "group.com.mlmvpn.sovereign"
    public static let syncPrefix = "mlmsync://v1/"
    public static let syncAad = Data("mlmvpn-sovereign-sync-v1".utf8)
    public static let pbkdf2Iterations: Int = 100_000
}

public enum TunnelRunMode: String, Codable, CaseIterable, Identifiable {
    case fullVpn = "full_vpn"
    case cfBypassOnly = "cf_bypass_only"

    public var id: String { rawValue }
    public var titleFa: String {
        switch self {
        case .fullVpn: return "تونل کامل VPN"
        case .cfBypassOnly: return "سپر کلودفلر بدون فیلترشکن"
        }
    }
}

public enum EngineKind: String, Codable, CaseIterable, Identifiable {
    case v2ray, flux, mae, directDpi, warp, masque, wireguard, warpOnWarp
    case psiphon, tor, lantern, geph, urnetwork, fenix, amnezia
    case proton, windscribe, outline, npv, vpngate, openvpn
    case githubTunnel, gst, vodi, tgproxy, cfBypass

    public var id: String { rawValue }

    public var titleFa: String {
        switch self {
        case .cfBypass: return "سپر کلودفلر"
        case .v2ray: return "V2Ray / Xray"
        case .flux: return "FLUX ریسینگ"
        case .mae: return "MAE تطبیقی"
        case .directDpi: return "عبور مستقیم DPI"
        case .warp: return "وارپ (1.1.1.1)"
        case .masque: return "MASQUE HTTP/3"
        case .wireguard: return "وایرگارد"
        case .warpOnWarp: return "وارپ تو وارپ"
        case .psiphon: return "سایفون"
        case .tor: return "تور (Tor)"
        case .lantern: return "لنترن"
        case .geph: return "گِف (Geph)"
        case .urnetwork: return "URnetwork"
        case .fenix: return "فنیکس (Firefox)"
        case .amnezia: return "آمنزیا (AWG/Hy2)"
        case .proton: return "پروتون رایگان"
        case .windscribe: return "ویندسکرایب"
        case .outline: return "اوتلاین (SS)"
        case .npv: return "NPV Tunnel"
        case .vpngate: return "VPN Gate Relay"
        case .openvpn: return "اوپن‌وی‌پی‌ان"
        case .githubTunnel: return "تونل گیت‌هاب"
        case .gst: return "اسکریپت گوگل (GST)"
        case .vodi: return "ودی / ریل‌وی"
        case .tgproxy: return "پروکسی تلگرام"
        }
    }

    public var symbolName: String {
        switch self {
        case .cfBypass: return "cloud.bolt.fill"
        case .v2ray: return "bolt.shield.fill"
        case .flux: return "flame.fill"
        case .mae: return "sparkles"
        case .directDpi: return "scissors"
        case .warp, .masque, .warpOnWarp: return "1.circle.fill"
        case .wireguard, .amnezia, .proton, .windscribe: return "lock.shield.fill"
        case .psiphon, .lantern, .geph, .urnetwork: return "network"
        case .tor: return "eye.slash.fill"
        case .fenix: return "safari.fill"
        case .outline, .npv: return "key.fill"
        case .vpngate, .openvpn: return "globe.asia.australia.fill"
        case .githubTunnel: return "chevron.left.forwardslash.chevron.right"
        case .gst, .vodi: return "paperplane.fill"
        case .tgproxy: return "bubble.left.and.bubble.right.fill"
        }
    }
}

public struct CfAccountModel: Codable, Identifiable, Equatable {
    public var id: String
    public var name: String
    public var email: String
    public var token: String
    public var accountId: String
    public var workerUrl: String
    public var edgWorkerUrl: String
    public var edgUuid: String
    public var mlmWorkerUrl: String
    public var nahanWorkerUrl: String

    public init(
        id: String = UUID().uuidString,
        name: String,
        email: String = "",
        token: String,
        accountId: String,
        workerUrl: String = "",
        edgWorkerUrl: String = "",
        edgUuid: String = "",
        mlmWorkerUrl: String = "",
        nahanWorkerUrl: String = ""
    ) {
        self.id = id
        self.name = name
        self.email = email
        self.token = token
        self.accountId = accountId
        self.workerUrl = workerUrl
        self.edgWorkerUrl = edgWorkerUrl
        self.edgUuid = edgUuid
        self.mlmWorkerUrl = mlmWorkerUrl
        self.nahanWorkerUrl = nahanWorkerUrl
    }
}

public struct CfBypassDomainPack: Identifiable {
    public let id: String
    public let titleFa: String
    public let domains: [String]

    public static let allPacks: [CfBypassDomainPack] = [
        CfBypassDomainPack(
            id: "ai_suite",
            titleFa: "هوش مصنوعی (ChatGPT / Claude / Gemini)",
            domains: [
                "chatgpt.com", "openai.com", "oaistatic.com", "oaiusercontent.com",
                "claude.ai", "anthropic.com", "gemini.google.com", "aistudio.google.com",
                "generativelanguage.googleapis.com", "perplexity.ai", "copilot.microsoft.com"
            ]
        ),
        CfBypassDomainPack(
            id: "dev_cloud",
            titleFa: "توسعه و کلود (GitHub / Docker / npm)",
            domains: [
                "github.com", "api.github.com", "raw.githubusercontent.com", "ghcr.io",
                "registry.npmjs.org", "pypi.org", "hub.docker.com", "registry-1.docker.io",
                "developer.apple.com", "dl.google.com"
            ]
        ),
        CfBypassDomainPack(
            id: "social_media",
            titleFa: "شبکه‌های اجتماعی و رسانه",
            domains: [
                "youtube.com", "youtu.be", "googlevideo.com", "ytimg.com",
                "x.com", "twitter.com", "twimg.com", "instagram.com", "cdninstagram.com",
                "reddit.com", "spotify.com", "soundcloud.com"
            ]
        ),
        CfBypassDomainPack(
            id: "gaming_login",
            titleFa: "لاگین گیمینگ و استور",
            domains: [
                "store.steampowered.com", "steamcommunity.com", "epicgames.com",
                "riotgames.com", "auth.riotgames.com", "discord.com", "gateway.discord.gg",
                "apps.apple.com"
            ]
        )
    ]
}

public struct CfBypassConfig: Codable, Equatable {
    public var workerUrl: String
    public var cleanIp: String
    public var uuid: String
    public var packs: [String]
    public var customDomains: [String]

    public init(
        workerUrl: String = "",
        cleanIp: String = "",
        uuid: String = UUID().uuidString,
        packs: [String] = ["ai_suite"],
        customDomains: [String] = []
    ) {
        self.workerUrl = workerUrl
        self.cleanIp = cleanIp
        self.uuid = uuid
        self.packs = packs
        self.customDomains = customDomains
    }

    public var effectiveDomains: [String] {
        var set = Set<String>()
        for pack in CfBypassDomainPack.allPacks where packs.contains(pack.id) {
            pack.domains.forEach { set.insert($0.lowercased()) }
        }
        customDomains.forEach {
            let trimmed = $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if !trimmed.isEmpty { set.insert(trimmed) }
        }
        return Array(set).sorted()
    }
}

public struct VpnNodeModel: Codable, Identifiable, Equatable {
    public var id: String
    public var name: String
    public var uri: String
    public var protocolName: String
    public var source: String
    public var latencyMs: Int?

    public init(
        id: String = UUID().uuidString,
        name: String,
        uri: String,
        protocolName: String,
        source: String = "pool",
        latencyMs: Int? = nil
    ) {
        self.id = id
        self.name = name
        self.uri = uri
        self.protocolName = protocolName
        self.source = source
        self.latencyMs = latencyMs
    }
}

public struct SovereignSnapshot: Codable {
    public var schema: Int = 1
    public var platform: String = "ios"
    public var exportedAt: Int64
    public var accounts: [CfAccountModel]
    public var cfBypass: CfBypassConfig
    public var sanctionDomains: [String]

    public init(
        exportedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        accounts: [CfAccountModel],
        cfBypass: CfBypassConfig,
        sanctionDomains: [String]
    ) {
        self.exportedAt = exportedAt
        self.accounts = accounts
        self.cfBypass = cfBypass
        self.sanctionDomains = sanctionDomains
    }
}

public final class SovereignAppGroupStore {
    public static let shared = SovereignAppGroupStore()
    private let defaults: UserDefaults

    private init() {
        self.defaults = UserDefaults(suiteName: SovereignConstants.appGroupId) ?? .standard
    }

    private enum Keys {
        static let activeMode = "sv_active_mode"
        static let activeSingBoxJson = "sv_active_singbox_json"
        static let activePacScript = "sv_active_pac_script"
        static let cfBypass = "sv_cf_bypass_config"
        static let cfAccounts = "sv_cf_accounts"
        static let sanctionDomains = "sv_sanction_domains"
        static let savedNodes = "sv_saved_nodes"
        static let cleanIps = "sv_clean_ips"
    }

    public var activeMode: TunnelRunMode {
        get { TunnelRunMode(rawValue: defaults.string(forKey: Keys.activeMode) ?? "") ?? .cfBypassOnly }
        set { defaults.set(newValue.rawValue, forKey: Keys.activeMode) }
    }

    public var activeSingBoxJson: String {
        get { defaults.string(forKey: Keys.activeSingBoxJson) ?? "" }
        set { defaults.set(newValue, forKey: Keys.activeSingBoxJson) }
    }

    public var activePacScript: String {
        get { defaults.string(forKey: Keys.activePacScript) ?? "" }
        set { defaults.set(newValue, forKey: Keys.activePacScript) }
    }

    public func loadCfBypass() -> CfBypassConfig {
        guard let data = defaults.data(forKey: Keys.cfBypass),
              let cfg = try? JSONDecoder().decode(CfBypassConfig.self, from: data) else {
            return CfBypassConfig()
        }
        return cfg
    }

    public func saveCfBypass(_ cfg: CfBypassConfig) {
        if let data = try? JSONEncoder().encode(cfg) {
            defaults.set(data, forKey: Keys.cfBypass)
        }
    }

    public func loadAccounts() -> [CfAccountModel] {
        guard let data = defaults.data(forKey: Keys.cfAccounts),
              let list = try? JSONDecoder().decode([CfAccountModel].self, from: data) else {
            return []
        }
        return list
    }

    public func saveAccounts(_ accounts: [CfAccountModel]) {
        if let data = try? JSONEncoder().encode(accounts) {
            defaults.set(data, forKey: Keys.cfAccounts)
        }
    }

    public func loadSanctionDomains() -> [String] {
        defaults.stringArray(forKey: Keys.sanctionDomains) ?? ["openai.com", "gemini.google.com", "claude.ai"]
    }

    public func saveSanctionDomains(_ list: [String]) {
        defaults.set(list, forKey: Keys.sanctionDomains)
    }

    public func loadNodes() -> [VpnNodeModel] {
        guard let data = defaults.data(forKey: Keys.savedNodes),
              let list = try? JSONDecoder().decode([VpnNodeModel].self, from: data) else {
            return []
        }
        return list
    }

    public func saveNodes(_ nodes: [VpnNodeModel]) {
        if let data = try? JSONEncoder().encode(nodes) {
            defaults.set(data, forKey: Keys.savedNodes)
        }
    }

    public func loadCleanIps() -> [String] {
        defaults.stringArray(forKey: Keys.cleanIps) ?? []
    }

    public func saveCleanIps(_ ips: [String]) {
        defaults.set(ips, forKey: Keys.cleanIps)
    }
}
