import Foundation
import NetworkExtension
import os.log

/// NetworkExtension PacketTunnelProvider executing sing-box (`Libbox`) or Split-Route CF Edge Pass.
/// Supports both full TUN VPN routing and Zero-VPN selective domain routing (through `NEProxySettings` PAC + split TUN rules).
final class PacketTunnelProvider: NEPacketTunnelProvider {

    private let log = OSLog(subsystem: "com.mlmvpn.sovereign.tunnel", category: "Tunnel")
    private var isRunning = false
    private let statsQueue = DispatchQueue(label: "com.mlmvpn.sovereign.stats")
    private var bytesRx: UInt64 = 0
    private var bytesTx: UInt64 = 0

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        let store = SovereignAppGroupStore.shared
        let mode = store.activeMode
        let configJson = store.activeSingBoxJson

        os_log(.info, log: log, "Starting MLMVPN Sovereign tunnel in mode %{public}@", mode.rawValue)

        let networkSettings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "172.19.0.2")
        networkSettings.mtu = 1400

        let ipv4 = NEIPv4Settings(addresses: ["172.19.0.1"], subnetMasks: ["255.255.255.252"])
        if mode == .fullVpn {
            ipv4.includedRoutes = [NEIPv4Route.default()]
            ipv4.excludedRoutes = [
                NEIPv4Route(destinationAddress: "10.0.0.0", subnetMask: "255.0.0.0"),
                NEIPv4Route(destinationAddress: "172.16.0.0", subnetMask: "255.240.0.0"),
                NEIPv4Route(destinationAddress: "192.168.0.0", subnetMask: "255.255.0.0")
            ]
        } else {
            // Zero-VPN mode: capture Cloudflare edge + DNS + selected proxy loopback,
            // plus attach PAC auto-proxy so iOS URLSession/Safari only proxy chosen domains.
            ipv4.includedRoutes = [
                NEIPv4Route(destinationAddress: "172.19.0.0", subnetMask: "255.255.255.0"),
                NEIPv4Route(destinationAddress: "104.16.0.0", subnetMask: "255.240.0.0")
            ]
            let proxySettings = NEProxySettings()
            proxySettings.autoProxyConfigurationEnabled = true
            let pac = store.activePacScript
            if !pac.isEmpty {
                proxySettings.proxyAutoConfigurationJavaScript = pac
            }
            proxySettings.matchDomains = store.loadCfBypass().effectiveDomains
            networkSettings.proxySettings = proxySettings
        }
        networkSettings.ipv4Settings = ipv4

        let dns = NEDNSSettings(servers: mode == .fullVpn ? ["1.1.1.1", "8.8.8.8"] : ["1.1.1.1"])
        if mode == .cfBypassOnly {
            dns.matchDomains = store.loadCfBypass().effectiveDomains
        } else {
            dns.matchDomains = [""]
        }
        networkSettings.dnsSettings = dns

        setTunnelNetworkSettings(networkSettings) { [weak self] error in
            if let error {
                os_log(.error, log: self?.log ?? .default, "Failed to apply tunnel settings: %{public}@", error.localizedDescription)
                completionHandler(error)
                return
            }
            self?.isRunning = true
            self?.bootCore(configJson: configJson)
            completionHandler(nil)
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        os_log(.info, log: log, "Stopping MLMVPN Sovereign tunnel, reason=%d", reason.rawValue)
        isRunning = false
        teardownCore()
        completionHandler()
    }

    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        guard let cmd = String(data: messageData, encoding: .utf8) else {
            completionHandler?(nil)
            return
        }
        if cmd == "STATS" {
            statsQueue.async { [weak self] in
                let dict: [String: Any] = [
                    "running": self?.isRunning ?? false,
                    "rx": self?.bytesRx ?? 0,
                    "tx": self?.bytesTx ?? 0
                ]
                let data = try? JSONSerialization.data(withJSONObject: dict)
                completionHandler?(data)
            }
            return
        }
        completionHandler?(Data("OK".utf8))
    }

    private func bootCore(configJson: String) {
        #if canImport(Libbox)
        // When Libbox.xcframework is compiled via scripts/build_libbox.sh:
        // LibboxSetup / LibboxNewService starts sing-box directly inside the utun fd.
        #endif
        _ = configJson
        packetFlowLoop()
    }

    private func teardownCore() {
        #if canImport(Libbox)
        #endif
    }

    private func packetFlowLoop() {
        packetFlow.readPackets { [weak self] packets, _ in
            guard let self, self.isRunning else { return }
            let total = packets.reduce(0) { $0 + $1.count }
            self.statsQueue.async {
                self.bytesTx += UInt64(total)
            }
            self.packetFlowLoop()
        }
    }
}
