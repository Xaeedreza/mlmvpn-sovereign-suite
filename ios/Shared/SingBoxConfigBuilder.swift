import Foundation

/// Builds sing-box configuration JSON & PAC scripts for iOS `PacketTunnelProvider`.
/// Supports Full VPN mode and Zero-VPN Cloudflare Edge Pass split-routing.
public enum SingBoxConfigBuilder {

    public static func buildOutbound(from uri: String) -> [String: Any]? {
        let trimmed = uri.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased() else {
            return nil
        }

        let query = Dictionary(
            (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [])
                .map { ($0.name.lowercased(), $0.value ?? "") },
            uniquingKeysWith: { first, _ in first }
        )

        switch scheme {
        case "vless":
            guard let host = url.host, let uuid = url.user else { return nil }
            let port = url.port ?? 443
            var ob: [String: Any] = [
                "type": "vless",
                "tag": "proxy",
                "server": host,
                "server_port": port,
                "uuid": uuid
            ]
            if let flow = query["flow"], !flow.isEmpty { ob["flow"] = flow }
            ob["tls"] = buildTls(query: query, defaultHost: host)
            if let transport = buildTransport(query: query, defaultHost: host) {
                ob["transport"] = transport
            }
            return ob

        case "trojan":
            guard let host = url.host, let pass = url.user else { return nil }
            let port = url.port ?? 443
            var ob: [String: Any] = [
                "type": "trojan",
                "tag": "proxy",
                "server": host,
                "server_port": port,
                "password": pass,
                "tls": buildTls(query: query, defaultHost: host)
            ]
            if let transport = buildTransport(query: query, defaultHost: host) {
                ob["transport"] = transport
            }
            return ob

        case "hysteria2", "hy2":
            guard let host = url.host else { return nil }
            let port = url.port ?? 443
            let password = url.user ?? query["auth"] ?? ""
            var ob: [String: Any] = [
                "type": "hysteria2",
                "tag": "proxy",
                "server": host,
                "server_port": port,
                "password": password,
                "tls": [
                    "enabled": true,
                    "server_name": query["sni"] ?? host,
                    "insecure": query["insecure"] == "1"
                ]
            ]
            if let obfs = query["obfs"], !obfs.isEmpty {
                ob["obfs"] = [
                    "type": obfs,
                    "password": query["obfs-password"] ?? ""
                ]
            }
            return ob

        case "tuic":
            guard let host = url.host, let uuid = url.user else { return nil }
            let port = url.port ?? 443
            return [
                "type": "tuic",
                "tag": "proxy",
                "server": host,
                "server_port": port,
                "uuid": uuid,
                "password": url.password ?? "",
                "congestion_control": query["congestion_control"] ?? "bbr",
                "tls": [
                    "enabled": true,
                    "server_name": query["sni"] ?? host,
                    "alpn": (query["alpn"] ?? "h3").split(separator: ",").map(String.init)
                ]
            ]

        case "anytls":
            guard let host = url.host, let pass = url.user else { return nil }
            return [
                "type": "anytls",
                "tag": "proxy",
                "server": host,
                "server_port": url.port ?? 443,
                "password": pass,
                "tls": [
                    "enabled": true,
                    "server_name": query["sni"] ?? host,
                    "insecure": query["insecure"] == "1"
                ]
            ]

        case "vmess":
            let b64 = String(trimmed.dropFirst("vmess://".count))
            guard let data = Data(base64Encoded: b64),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let host = json["add"] as? String,
                  let uuid = json["id"] as? String else { return nil }
            let port = Int("\(json["port"] ?? 443)") ?? 443
            var ob: [String: Any] = [
                "type": "vmess",
                "tag": "proxy",
                "server": host,
                "server_port": port,
                "uuid": uuid,
                "security": (json["scy"] as? String) ?? "auto",
                "alter_id": Int("\(json["aid"] ?? 0)") ?? 0
            ]
            if (json["tls"] as? String) == "tls" {
                ob["tls"] = [
                    "enabled": true,
                    "server_name": (json["sni"] as? String) ?? (json["host"] as? String) ?? host,
                    "utls": ["enabled": true, "fingerprint": "chrome"]
                ]
            }
            if (json["net"] as? String) == "ws" {
                ob["transport"] = [
                    "type": "ws",
                    "path": (json["path"] as? String) ?? "/",
                    "headers": ["Host": (json["host"] as? String) ?? host]
                ]
            }
            return ob

        case "ss":
            guard let host = url.host else { return nil }
            let port = url.port ?? 8388
            var method = "chacha20-ietf-poly1305"
            var password = url.password ?? ""
            if let userRaw = url.user {
                if let decoded = Data(base64Encoded: userRaw),
                   let pair = String(data: decoded, encoding: .utf8),
                   let colon = pair.firstIndex(of: ":") {
                    method = String(pair[..<colon])
                    password = String(pair[pair.index(after: colon)...])
                } else {
                    method = userRaw
                }
            }
            return [
                "type": "shadowsocks",
                "tag": "proxy",
                "server": host,
                "server_port": port,
                "method": method,
                "password": password
            ]

        default:
            return nil
        }
    }

    private static func buildTls(query: [String: String], defaultHost: String) -> [String: Any] {
        let sni = (query["sni"]?.isEmpty == false) ? query["sni"]! : defaultHost
        var tls: [String: Any] = [
            "enabled": query["security"] != "none",
            "server_name": sni,
            "insecure": query["allowInsecure"] == "1" || query["insecure"] == "1",
            "utls": ["enabled": true, "fingerprint": query["fp"] ?? "chrome"]
        ]
        if query["security"] == "reality", let pbk = query["pbk"] {
            tls["reality"] = [
                "enabled": true,
                "public_key": pbk,
                "short_id": query["sid"] ?? ""
            ]
        }
        return tls
    }

    private static func buildTransport(query: [String: String], defaultHost: String) -> [String: Any]? {
        let net = query["type"] ?? "tcp"
        switch net {
        case "ws":
            return [
                "type": "ws",
                "path": query["path"] ?? "/",
                "headers": ["Host": query["host"] ?? query["sni"] ?? defaultHost],
                "max_early_data": 2560,
                "early_data_header_name": "Sec-WebSocket-Protocol"
            ]
        case "grpc":
            return ["type": "grpc", "service_name": query["serviceName"] ?? ""]
        case "httpupgrade":
            return [
                "type": "httpupgrade",
                "host": query["host"] ?? defaultHost,
                "path": query["path"] ?? "/"
            ]
        default:
            return nil
        }
    }

    public static func buildConfigJSON(
        outbound: [String: Any],
        mode: TunnelRunMode,
        bypassDomains: [String],
        cleanIpOverride: String = ""
    ) throws -> String {
        var finalOutbound = outbound
        if !cleanIpOverride.isEmpty,
           (finalOutbound["type"] as? String) == "vless" {
            finalOutbound["server"] = cleanIpOverride
        }

        let inbounds: [[String: Any]] = [
            [
                "type": "tun",
                "tag": "tun-in",
                "interface_name": "utun4",
                "inet4_address": "172.19.0.1/30",
                "mtu": 1400,
                "auto_route": true,
                "strict_route": mode == .fullVpn,
                "stack": "system",
                "sniff": true
            ],
            [
                "type": "mixed",
                "tag": "mixed-in",
                "listen": "127.0.0.1",
                "listen_port": 20810
            ]
        ]

        var rules: [[String: Any]] = [
            ["protocol": "dns", "outbound": "dns-out"],
            ["ip_is_private": true, "outbound": "direct"],
            ["domain_suffix": [".ir"], "outbound": "direct"]
        ]

        if mode == .cfBypassOnly {
            let cleanDomains = bypassDomains.map { $0.lowercased() }.filter { !$0.isEmpty }
            if !cleanDomains.isEmpty {
                rules.append([
                    "domain_suffix": cleanDomains,
                    "outbound": "proxy"
                ])
            }
        }

        let routeFinal = (mode == .cfBypassOnly) ? "direct" : "proxy"
        let root: [String: Any] = [
            "log": ["level": "info"],
            "dns": [
                "servers": [
                    ["tag": "cf-doh", "address": "https://1.1.1.1/dns-query", "detour": "proxy"],
                    ["tag": "local-dns", "address": "local", "detour": "direct"]
                ],
                "rules": [
                    ["domain_suffix": [".ir"], "server": "local-dns"]
                ],
                "final": mode == .cfBypassOnly ? "local-dns" : "cf-doh"
            ],
            "inbounds": inbounds,
            "outbounds": [
                finalOutbound,
                ["type": "direct", "tag": "direct"],
                ["type": "dns", "tag": "dns-out"],
                ["type": "block", "tag": "block"]
            ],
            "route": [
                "rules": rules,
                "final": routeFinal,
                "auto_detect_interface": true
            ]
        ]

        let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted])
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    public static func buildPacScript(domains: [String], proxyHostPort: String = "127.0.0.1:20810") -> String {
        let jsonList = (try? String(data: JSONSerialization.data(withJSONObject: domains), encoding: .utf8)) ?? "[]"
        return """
        function FindProxyForURL(url, host) {
          host = (host || '').toLowerCase();
          if (isPlainHostName(host) || shExpMatch(host, '*.ir') || isInNet(host, '127.0.0.0', '255.0.0.0') || isInNet(host, '10.0.0.0', '255.0.0.0') || isInNet(host, '192.168.0.0', '255.255.0.0')) {
            return 'DIRECT';
          }
          var bypass = \(jsonList);
          for (var i = 0; i < bypass.length; i++) {
            var d = bypass[i];
            if (host === d || dnsDomainIs(host, '.' + d)) {
              return 'PROXY \(proxyHostPort); DIRECT';
            }
          }
          return 'DIRECT';
        }
        """
    }
}
