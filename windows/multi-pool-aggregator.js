'use strict';

/**
 * Multi-Pool Server Aggregator (MLMVPN Sovereign Edition)
 *
 * Unifies public verified proxy & VPN sources from MLMVPN Windows, MLMVPN Android
 * (FreeConfigEngine, FluxSources, AmzSources, OutlineSources, NpvEngine), and
 * additional multi-protocol GitHub aggregators covering:
 *   VLESS, VMess, Trojan, Shadowsocks (Outline), Hysteria2, TUIC v5, WireGuard, AmneziaWG.
 *
 * Every GitHub raw URL pairs automatically with its jsDelivr CDN mirror fallback,
 * deduplicates by canonical endpoint identity, filters dead nodes via fast concurrent
 * TCP probes, and supports real Xray / sing-box verification.
 */

const net = require('net');
const { gtFetch } = require('./github-tunnel/gt-net');

const MULTI_SOURCES = [
  // Curated Iran-tested & cascade pools
  { id: 'radikal-verified', title: '0xRadikal (Verified)', group: 'xray', url: 'https://raw.githubusercontent.com/0xRadikal/Free-v2ray-Configs/main/verified/configs.txt', mirror: 'https://cdn.jsdelivr.net/gh/0xRadikal/Free-v2ray-Configs@main/verified/configs.txt', protocols: ['vless', 'vmess', 'trojan', 'ss'] },
  { id: 'radikal-fast', title: '0xRadikal (Fast)', group: 'xray', url: 'https://raw.githubusercontent.com/0xRadikal/Free-v2ray-Configs/main/fast/configs.txt', mirror: 'https://cdn.jsdelivr.net/gh/0xRadikal/Free-v2ray-Configs@main/fast/configs.txt', protocols: ['vless', 'vmess', 'trojan', 'ss'] },
  { id: 'patterniha-cf', title: 'Patterniha Iran CF', group: 'xray', url: 'https://raw.githubusercontent.com/patterniha/Free-Configs/main/configs.txt', mirror: 'https://cdn.jsdelivr.net/gh/patterniha/Free-Configs@main/configs.txt', protocols: ['vless', 'trojan'] },
  { id: 'matinghanbari-vless', title: 'MatinGhanbari REALITY', group: 'xray', url: 'https://raw.githubusercontent.com/MatinGhanbari/v2ray-configs/main/subscriptions/filtered/subs/vless.txt', mirror: 'https://cdn.jsdelivr.net/gh/MatinGhanbari/v2ray-configs@main/subscriptions/filtered/subs/vless.txt', protocols: ['vless'] },
  { id: 'matinghanbari-hy2', title: 'MatinGhanbari Hysteria2', group: 'quic', url: 'https://raw.githubusercontent.com/MatinGhanbari/v2ray-configs/main/subscriptions/filtered/subs/hysteria2.txt', mirror: 'https://cdn.jsdelivr.net/gh/MatinGhanbari/v2ray-configs@main/subscriptions/filtered/subs/hysteria2.txt', protocols: ['hysteria2'] },
  { id: 'matinghanbari-trojan', title: 'MatinGhanbari Trojan', group: 'xray', url: 'https://raw.githubusercontent.com/MatinGhanbari/v2ray-configs/main/subscriptions/filtered/subs/trojan.txt', mirror: 'https://cdn.jsdelivr.net/gh/MatinGhanbari/v2ray-configs@main/subscriptions/filtered/subs/trojan.txt', protocols: ['trojan'] },
  // Barry-far, Epodonios, Mahdibland, V2RayRoot, OpenRay, F0rc3Run
  { id: 'barryfar-all', title: 'Barry-Far Multi-Protocol', group: 'mixed', url: 'https://raw.githubusercontent.com/barry-far/V2ray-Config/main/All_Configs_Sub.txt', mirror: 'https://cdn.jsdelivr.net/gh/barry-far/V2ray-Config@main/All_Configs_Sub.txt', protocols: ['vless', 'vmess', 'trojan', 'ss', 'hysteria2', 'tuic'] },
  { id: 'epodonios-all', title: 'Epodonios Sub', group: 'mixed', url: 'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/All_Configs_Sub.txt', mirror: 'https://cdn.jsdelivr.net/gh/Epodonios/v2ray-configs@main/All_Configs_Sub.txt', protocols: ['vless', 'vmess', 'trojan', 'ss', 'hysteria2'] },
  { id: 'openray-ss', title: 'OpenRay Outline/SS', group: 'outline', url: 'https://raw.githubusercontent.com/sakha1370/OpenRay/main/output/kind/ss.txt', mirror: 'https://cdn.jsdelivr.net/gh/sakha1370/OpenRay@main/output/kind/ss.txt', protocols: ['ss'] },
  { id: 'forcerun-ss', title: 'F0rc3Run Shadowsocks', group: 'outline', url: 'https://raw.githubusercontent.com/F0rc3Run/F0rc3Run/main/splitted-by-protocol/shadowsocks.txt', mirror: 'https://cdn.jsdelivr.net/gh/F0rc3Run/F0rc3Run@main/splitted-by-protocol/shadowsocks.txt', protocols: ['ss'] },
  { id: 'ebrasha-ss', title: 'EbraSha Outline/SS', group: 'outline', url: 'https://raw.githubusercontent.com/ebrasha/free-v2ray-public-list/main/ss_configs.txt', mirror: 'https://cdn.jsdelivr.net/gh/ebrasha/free-v2ray-public-list@main/ss_configs.txt', protocols: ['ss'] },
  // Hysteria2 & WireGuard / AmneziaWG pools
  { id: 'vcc-hy2', title: 'VpnConfigCollector Hysteria2', group: 'quic', url: 'https://raw.githubusercontent.com/Argh73/VpnConfigCollector/main/Splitted-By-Protocol/Hysteria2.txt', mirror: 'https://cdn.jsdelivr.net/gh/Argh73/VpnConfigCollector@main/Splitted-By-Protocol/Hysteria2.txt', protocols: ['hysteria2'] },
  { id: 'vcc-tuic', title: 'VpnConfigCollector TUIC', group: 'quic', url: 'https://raw.githubusercontent.com/Argh73/VpnConfigCollector/main/Splitted-By-Protocol/Tuic.txt', mirror: 'https://cdn.jsdelivr.net/gh/Argh73/VpnConfigCollector@main/Splitted-By-Protocol/Tuic.txt', protocols: ['tuic'] },
  { id: 'vcf-hy2', title: 'VpnClashFa Hysteria2', group: 'quic', url: 'https://raw.githubusercontent.com/10ium/VpnClashFaCollector/main/sub/all/hysteria2.txt', mirror: 'https://cdn.jsdelivr.net/gh/10ium/VpnClashFaCollector@main/sub/all/hysteria2.txt', protocols: ['hysteria2'] },
  { id: 'vcf-wg', title: 'VpnClashFa WireGuard', group: 'wireguard', url: 'https://raw.githubusercontent.com/10ium/VpnClashFaCollector/main/sub/all/wireguard.txt', mirror: 'https://cdn.jsdelivr.net/gh/10ium/VpnClashFaCollector@main/sub/all/wireguard.txt', protocols: ['wireguard'] },
  { id: 'dk-warp', title: 'Delta-Kronecker WARP', group: 'wireguard', url: 'https://raw.githubusercontent.com/Delta-Kronecker/WARP-Config/main/ALL.txt', mirror: 'https://cdn.jsdelivr.net/gh/Delta-Kronecker/WARP-Config@main/ALL.txt', protocols: ['wireguard'] },
  // Iranian Collectors
  { id: 'youfoundamin-iran', title: 'Youfoundamin Mixed Iran', group: 'mixed', url: 'https://raw.githubusercontent.com/youfoundamin/V2rayCollector/main/mixed_iran.txt', mirror: 'https://cdn.jsdelivr.net/gh/youfoundamin/V2rayCollector@main/mixed_iran.txt', protocols: ['vless', 'vmess', 'trojan', 'ss', 'hysteria2'] },
  { id: 'tgparse-mixed', title: 'TGParse Mixed', group: 'mixed', url: 'https://raw.githubusercontent.com/Surfboardv2ray/TGParse/main/splitted/mixed', mirror: 'https://cdn.jsdelivr.net/gh/Surfboardv2ray/TGParse@main/splitted/mixed', protocols: ['vless', 'vmess', 'trojan', 'ss'] },
  { id: 'peasoft-nomorewalls', title: 'NoMoreWalls Aggregate', group: 'mixed', url: 'https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list_raw.txt', mirror: 'https://cdn.jsdelivr.net/gh/peasoft/NoMoreWalls@master/list_raw.txt', protocols: ['vless', 'vmess', 'trojan', 'ss'] },
];

const SUPPORTED_SCHEMES = ['vless://', 'vmess://', 'trojan://', 'ss://', 'hysteria2://', 'hy2://', 'tuic://', 'wireguard://', 'wg://', 'anytls://'];
const CACHE_TTL_MS = 8 * 60 * 1000;
const cache = new Map();

async function fetchSourceText(src) {
  let lastErr = null;
  for (const target of [src.url, src.mirror].filter(Boolean)) {
    try {
      const r = await gtFetch(target, { timeoutMs: 25000 });
      if (!r.ok) { lastErr = new Error(`HTTP ${r.status}`); continue; }
      return await r.text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`${src.title}: ${lastErr ? lastErr.message : 'unreachable'}`);
}

function decodeMaybeBase64(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if (SUPPORTED_SCHEMES.some((s) => trimmed.includes(s))) return trimmed;
  try {
    const clean = trimmed.replace(/\s+/g, '');
    const decoded = Buffer.from(clean, 'base64').toString('utf8');
    if (SUPPORTED_SCHEMES.some((s) => decoded.includes(s))) return decoded;
  } catch (e) { /* plain text */ }
  return trimmed;
}

function parseServerMeta(uri) {
  try {
    const lower = uri.toLowerCase();
    const scheme = lower.split('://')[0];
    if (scheme === 'vmess') {
      const raw = uri.slice(8).split('#')[0];
      const obj = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      return {
        uri,
        protocol: 'vmess',
        host: String(obj.add || ''),
        port: Number(obj.port) || 443,
        label: String(obj.ps || obj.add || 'VMess'),
        idKey: `vmess|${obj.add}|${obj.port}|${obj.id || ''}`,
      };
    }
    const u = new URL(uri.replace(/^hy2:\/\//i, 'hysteria2://').replace(/^wg:\/\//i, 'wireguard://'));
    let label = '';
    try { label = decodeURIComponent(u.hash.replace(/^#/, '')).trim(); } catch (e) { label = u.hash.replace(/^#/, ''); }
    label = label.replace(/@[A-Za-z0-9_]{2,}/g, '@mlmvpn-sovereign') || `${scheme.toUpperCase()} · ${u.hostname}`;
    return {
      uri,
      protocol: scheme === 'hy2' ? 'hysteria2' : (scheme === 'wg' ? 'wireguard' : scheme),
      host: u.hostname,
      port: Number(u.port) || 443,
      label,
      idKey: `${scheme}|${u.hostname}|${u.port || 443}|${u.username || ''}`,
    };
  } catch (e) {
    return null;
  }
}

function tcpProbe(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (!host || !port) return resolve(-1);
    const s = new net.Socket();
    const t0 = Date.now();
    let done = false;
    const end = (ms) => { if (!done) { done = true; try { s.destroy(); } catch (e) {} resolve(ms); } };
    s.setTimeout(timeoutMs);
    s.once('connect', () => end(Date.now() - t0));
    s.once('timeout', () => end(-1));
    s.once('error', () => end(-1));
    try { s.connect(port, host); } catch (e) { end(-1); }
  });
}

function getCatalog() {
  return MULTI_SOURCES.map((s) => ({
    id: s.id,
    title: s.title,
    group: s.group,
    protocols: s.protocols,
    cachedCount: cache.has(s.id) ? cache.get(s.id).items.length : null,
  }));
}

async function fetchPool(sourceIds = null, { force = false, limitPerSource = 250, probeTcp = true } = {}) {
  const targets = Array.isArray(sourceIds) && sourceIds.length
    ? MULTI_SOURCES.filter((s) => sourceIds.includes(s.id))
    : MULTI_SOURCES;

  const seen = new Set();
  const merged = [];
  const errors = [];

  await Promise.all(targets.map(async (src) => {
    const cached = cache.get(src.id);
    if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      for (const item of cached.items) {
        if (!seen.has(item.idKey)) { seen.add(item.idKey); merged.push(item); }
      }
      return;
    }
    try {
      const raw = decodeMaybeBase64(await fetchSourceText(src));
      const items = [];
      for (const line of raw.split(/\r?\n/)) {
        const uri = line.trim();
        if (!uri || !SUPPORTED_SCHEMES.some((p) => uri.toLowerCase().startsWith(p))) continue;
        const meta = parseServerMeta(uri);
        if (!meta || !meta.host) continue;
        meta.sourceId = src.id;
        meta.sourceTitle = src.title;
        items.push(meta);
        if (items.length >= limitPerSource) break;
      }
      cache.set(src.id, { at: Date.now(), items });
      for (const item of items) {
        if (!seen.has(item.idKey)) { seen.add(item.idKey); merged.push(item); }
      }
    } catch (e) {
      errors.push({ id: src.id, error: e.message });
    }
  }));

  if (!probeTcp) return { servers: merged, errors, total: merged.length };

  // Fast TCP reachability filter on TCP-based nodes; QUIC/UDP protocols pass through for sing-box verification
  const tcpCandidates = merged.slice(0, 400);
  const alive = [];
  let idx = 0;
  await Promise.all(new Array(Math.min(40, tcpCandidates.length)).fill(0).map(async () => {
    while (idx < tcpCandidates.length) {
      const item = tcpCandidates[idx++];
      if (item.protocol === 'hysteria2' || item.protocol === 'tuic' || item.protocol === 'wireguard') {
        item.tcpMs = null;
        alive.push(item);
      } else {
        const ms = await tcpProbe(item.host, item.port, 1400);
        if (ms > 0) {
          item.tcpMs = ms;
          alive.push(item);
        }
      }
    }
  }));

  alive.sort((a, b) => (a.tcpMs == null ? 9999 : a.tcpMs) - (b.tcpMs == null ? 9999 : b.tcpMs));
  return { servers: alive, totalRaw: merged.length, errors };
}

module.exports = {
  MULTI_SOURCES,
  getCatalog,
  fetchPool,
  parseServerMeta,
  tcpProbe,
};
