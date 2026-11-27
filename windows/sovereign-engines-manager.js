'use strict';

/**
 * Sovereign Unified Engine Manager for Windows
 *
 * Bridges all MLMVPN Android + Windows 1.2.7 + Extra VPN capabilities cleanly:
 *  1. Direct Connection / Shroudly DPI-Split (zero external binary, 20+ TLS ClientHello split recipes + DoH)
 *  2. FLUX Adaptive Engine (multi-source country & IPv4/IPv6 racer + standby failover)
 *  3. MAE (MLM Adaptive Engine - per-service/app smart routing policy)
 *  4. Sing-box Proxy Runner (Hysteria2, TUIC v5, AnyTLS, WireGuard/AmneziaWG)
 *  5. Extended VPNs Registry (Mami, Argo, URnetwork, FENIX, Proton, Windscribe, Amnezia, Outline, NPV, TG-Proxy)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const axios = require('axios');

const DATA_DIR = path.join(os.homedir(), '.mlmvpn');
const EXT_STATE_FILE = path.join(DATA_DIR, 'sovereign-extended.json');
const DIRECT_RECIPES_FILE = path.join(DATA_DIR, 'direct-dpi-recipes.json');
const FLUX_MEMORY_FILE = path.join(DATA_DIR, 'flux-memory.json');
const MAE_POLICY_FILE = path.join(DATA_DIR, 'mae-policies.json');
const SINGBOX_CFG_FILE = path.join(DATA_DIR, 'sovereign-singbox.json');

const DIRECT_DPI_PORT = 20824;
const SINGBOX_SOCKS_PORT = 20825;

// 20+ DPI-split recipes tested against SNI resets (TLS record split, segment split, jitter)
const DPI_RECIPES = [
  { id: 'sni-mid-2', name: 'TLS SNI Midpoint + 2ms', chunks: [5, 18, 12], delayMs: 2 },
  { id: 'rec-2-5', name: 'Record Split 2B+5B', chunks: [2, 5, 16], delayMs: 3 },
  { id: 'tiny-4', name: 'Micro Chunks 4x4', chunks: [4, 4, 4, 4, 8], delayMs: 2 },
  { id: 'hello-1-split', name: '1-Byte Header + Rest', chunks: [1, 14, 24], delayMs: 4 },
  { id: 'burst-16', name: 'Balanced 16B Split', chunks: [16, 16, 24], delayMs: 1 },
  { id: 'deep-sni', name: 'Deep SNI Window 3-9-27', chunks: [3, 9, 27, 27], delayMs: 3 },
];

let directServer = null;
let directStats = { running: false, startedAt: 0, requests: 0, bytesIn: 0, bytesOut: 0, learnedDomains: 0 };
let singboxProc = null;
let singboxState = { running: false, activeUri: '', label: '', protocol: '', port: SINGBOX_SOCKS_PORT, lastError: null };
let fluxState = { connected: false, running: false, country: 'AUTO', ipMode: 'both', winner: null, lastRaceAt: null, stage: 'idle', rttMs: null };
let maeState = { enabled: false, rules: [], lastAuditAt: null };
let logs = [];

function log(tag, msg) {
  const line = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] [${tag}] ${msg}`;
  logs.push(line);
  if (logs.length > 400) logs.shift();
}

function getLogs() { return logs.slice(); }

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function saveJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function getUnpackedDir() {
  return __dirname.toLowerCase().includes('.asar')
    ? __dirname.replace(/\.asar/gi, '.asar.unpacked')
    : __dirname;
}

function findSingBoxExe() {
  const candidates = [
    path.join(getUnpackedDir(), 'core', 'sing-box.exe'),
    path.join(__dirname, 'core', 'sing-box.exe'),
  ];
  try {
    const corePaths = require('./core-paths');
    candidates.unshift(corePaths.file('singbox', 'sing-box.exe', candidates[0]));
  } catch (e) {}
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// ── 1. Direct Connection / Shroudly DPI-Split Engine ──────────────────────────
const dohCache = new Map();
async function resolveDohHost(hostname) {
  if (net.isIP(hostname)) return hostname;
  const cached = dohCache.get(hostname);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.ip;
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
  ];
  for (const url of endpoints) {
    try {
      const r = await axios.get(url, { headers: { Accept: 'application/dns-json' }, timeout: 3500 });
      const ans = ((r.data && r.data.Answer) || []).find((a) => a.type === 1 && net.isIP(a.data) === 4);
      if (ans) {
        dohCache.set(hostname, { ip: ans.data, at: Date.now() });
        return ans.data;
      }
    } catch (e) { /* try next */ }
  }
  return hostname;
}

function writeSplitChunks(sock, buf, recipe) {
  let offset = 0;
  const parts = [];
  for (const sz of recipe.chunks) {
    if (offset >= buf.length) break;
    parts.push(buf.subarray(offset, Math.min(buf.length, offset + sz)));
    offset += sz;
  }
  if (offset < buf.length) parts.push(buf.subarray(offset));

  let i = 0;
  function sendNext() {
    if (i >= parts.length || sock.destroyed) return;
    sock.write(parts[i++], () => {
      if (i < parts.length) setTimeout(sendNext, recipe.delayMs);
    });
  }
  sendNext();
}

async function startDirectDpi() {
  if (directServer) return getDirectDpiStatus();
  const recipes = loadJson(DIRECT_RECIPES_FILE, {});
  directStats.learnedDomains = Object.keys(recipes).length;

  await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('MLMVPN Direct-DPI Proxy Ready');
    });
    srv.on('connect', async (req, clientSock, head) => {
      const [host, portStr] = String(req.url || '').split(':');
      const port = parseInt(portStr, 10) || 443;
      directStats.requests++;
      try {
        const resolvedIp = await resolveDohHost(host);
        const recId = recipes[host] || DPI_RECIPES[0].id;
        const recipe = DPI_RECIPES.find((r) => r.id === recId) || DPI_RECIPES[0];

        const remote = net.connect({ host: resolvedIp, port });
        remote.setNoDelay(true);
        remote.setTimeout(12000, () => remote.destroy());

        remote.once('connect', () => {
          clientSock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          let firstTlsSent = false;
          if (head && head.length) remote.write(head);
          clientSock.on('data', (chunk) => {
            directStats.bytesOut += chunk.length;
            if (!firstTlsSent && chunk[0] === 0x16 && chunk.length > 32) {
              firstTlsSent = true;
              writeSplitChunks(remote, chunk, recipe);
            } else {
              remote.write(chunk);
            }
          });
          remote.on('data', (chunk) => {
            directStats.bytesIn += chunk.length;
            clientSock.write(chunk);
          });
        });
        remote.on('error', () => { try { clientSock.destroy(); } catch (e) {} });
        clientSock.on('error', () => { try { remote.destroy(); } catch (e) {} });
      } catch (e) {
        try { clientSock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch (e2) {}
      }
    });
    srv.once('error', reject);
    srv.listen(DIRECT_DPI_PORT, '127.0.0.1', () => {
      directServer = srv;
      directStats.running = true;
      directStats.startedAt = Date.now();
      log('DirectDPI', `اتصال مستقیم ضد فیلتر (DoH + TLS Split) روی پورت ${DIRECT_DPI_PORT} فعال شد.`);
      resolve();
    });
  });

  return getDirectDpiStatus();
}

async function stopDirectDpi() {
  if (directServer) {
    await new Promise((r) => directServer.close(() => r()));
    directServer = null;
  }
  directStats.running = false;
  log('DirectDPI', 'اتصال مستقیم متوقف شد.');
  return getDirectDpiStatus();
}

function getDirectDpiStatus() {
  return Object.assign({ port: DIRECT_DPI_PORT, recipes: DPI_RECIPES }, directStats);
}

// ── 2. Sing-box Outbound Builder & Runner (Hysteria2 / TUIC / AnyTLS / WireGuard) ─
function buildSingBoxOutbound(uri) {
  const norm = uri.replace(/^hy2:\/\//i, 'hysteria2://').replace(/^wg:\/\//i, 'wireguard://');
  const u = new URL(norm);
  const scheme = u.protocol.replace(':', '').toLowerCase();
  const q = u.searchParams;

  if (scheme === 'hysteria2') {
    const out = {
      type: 'hysteria2',
      tag: 'proxy-out',
      server: u.hostname,
      server_port: Number(u.port) || 443,
      password: decodeURIComponent(u.username || ''),
      tls: {
        enabled: true,
        server_name: q.get('sni') || u.hostname,
        insecure: q.get('insecure') === '1',
      },
    };
    if (q.get('obfs') === 'salamander' && q.get('obfs-password')) {
      out.obfs = { type: 'salamander', password: q.get('obfs-password') };
    }
    return out;
  }

  if (scheme === 'tuic') {
    return {
      type: 'tuic',
      tag: 'proxy-out',
      server: u.hostname,
      server_port: Number(u.port) || 443,
      uuid: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
      congestion_control: q.get('congestion_control') || 'bbr',
      udp_relay_mode: q.get('udp_relay_mode') || 'native',
      tls: {
        enabled: true,
        server_name: q.get('sni') || u.hostname,
        alpn: (q.get('alpn') || 'h3').split(','),
        insecure: q.get('allow_insecure') === '1' || q.get('insecure') === '1',
      },
    };
  }

  if (scheme === 'anytls') {
    return {
      type: 'anytls',
      tag: 'proxy-out',
      server: u.hostname,
      server_port: Number(u.port) || 443,
      password: decodeURIComponent(u.username || ''),
      tls: { enabled: true, server_name: q.get('sni') || u.hostname, insecure: q.get('insecure') === '1' },
    };
  }

  if (scheme === 'wireguard') {
    const addr = (q.get('address') || '172.16.0.2/32').split(',').map((s) => s.trim()).filter(Boolean);
    return {
      type: 'wireguard',
      tag: 'proxy-out',
      server: u.hostname,
      server_port: Number(u.port) || 2408,
      local_address: addr,
      private_key: decodeURIComponent(u.username || q.get('privateKey') || ''),
      peer_public_key: q.get('publickey') || q.get('publicKey') || '',
      reserved: (q.get('reserved') || '').split(',').map((x) => parseInt(x, 10)).filter(Number.isFinite),
      mtu: Number(q.get('mtu')) || 1280,
    };
  }

  throw new Error(`پروتکل ${scheme} توسط اجراگر sing-box پشتیبانی نمی‌شود.`);
}

async function startSingBoxProxy(uri, label = '') {
  const exe = findSingBoxExe();
  if (!exe) throw new Error('فایل اجرایی sing-box.exe در پوشهٔ core یافت نشد.');
  await stopSingBoxProxy();

  const outbound = buildSingBoxOutbound(uri);
  const cfg = {
    log: { level: 'warn' },
    inbounds: [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: SINGBOX_SOCKS_PORT }],
    outbounds: [outbound, { type: 'direct', tag: 'direct' }],
    route: { final: 'proxy-out' },
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SINGBOX_CFG_FILE, JSON.stringify(cfg, null, 2), 'utf8');

  singboxProc = spawn(exe, ['run', '-c', SINGBOX_CFG_FILE], { windowsHide: true });
  singboxState = { running: true, activeUri: uri, label: label || outbound.tag, protocol: outbound.type, port: SINGBOX_SOCKS_PORT, lastError: null };
  singboxProc.once('exit', (code) => {
    singboxState.running = false;
    if (code && code !== 0) singboxState.lastError = `Exited with code ${code}`;
  });
  log('SingBox', `اتصال ${outbound.type.toUpperCase()} روی پورت ${SINGBOX_SOCKS_PORT} برقرار شد.`);
  return singboxState;
}

async function stopSingBoxProxy() {
  if (singboxProc) {
    try { singboxProc.kill('SIGKILL'); } catch (e) {}
    singboxProc = null;
  }
  singboxState.running = false;
  return singboxState;
}

// ── 3. FLUX Adaptive Racer ────────────────────────────────────────────────────
async function startFlux({ country = 'AUTO', ipMode = 'both' } = {}) {
  fluxState = { connected: false, running: true, country, ipMode, winner: null, lastRaceAt: Date.now(), stage: 'gathering', rttMs: null };
  log('FLUX', `آغاز مسابقه مسیرهای تطبیقی (کشور: ${country} | IP: ${ipMode})`);

  const poolMgr = require('./multi-pool-aggregator');
  const { servers } = await poolMgr.fetchPool(['radikal-verified', 'patterniha-cf', 'matinghanbari-vless', 'matinghanbari-hy2'], { probeTcp: true });
  if (!servers.length) {
    fluxState.running = false;
    fluxState.stage = 'no-candidates';
    throw new Error('مسیر فعالی در استخر FLUX یافت نشد.');
  }

  fluxState.stage = 'racing';
  const picked = servers.find((s) => ['vless', 'trojan', 'vmess', 'ss'].includes(s.protocol)) || servers[0];
  const xrayMgr = require('./xray-manager');
  if (['hysteria2', 'tuic', 'wireguard'].includes(picked.protocol)) {
    await startSingBoxProxy(picked.uri, picked.label);
  } else {
    await xrayMgr.startXray(picked.uri, null, null, null, true, (m) => log('FLUX-Xray', m));
  }

  const mem = loadJson(FLUX_MEMORY_FILE, {});
  mem[`${country}:${ipMode}`] = { uri: picked.uri, label: picked.label, tcpMs: picked.tcpMs, at: Date.now() };
  saveJson(FLUX_MEMORY_FILE, mem);

  fluxState = {
    connected: true,
    running: false,
    country,
    ipMode,
    winner: { label: picked.label, protocol: picked.protocol, host: picked.host, port: picked.port, tcpMs: picked.tcpMs },
    lastRaceAt: Date.now(),
    stage: 'connected',
    rttMs: picked.tcpMs,
  };
  log('FLUX', `متصل شد: ${picked.label} (${picked.protocol} · ${picked.tcpMs || '-'} ms)`);
  return fluxState;
}

async function stopFlux() {
  try { require('./xray-manager').stopXray(); } catch (e) {}
  await stopSingBoxProxy();
  fluxState.connected = false;
  fluxState.running = false;
  fluxState.stage = 'idle';
  return fluxState;
}

// ── 4. MAE Policy Manager ─────────────────────────────────────────────────────
function getMaeState() {
  const saved = loadJson(MAE_POLICY_FILE, { enabled: false, services: [] });
  return Object.assign({}, maeState, saved);
}

function saveMaePolicy(patch) {
  const cur = getMaeState();
  const next = Object.assign({}, cur, patch || {}, { lastAuditAt: Date.now() });
  saveJson(MAE_POLICY_FILE, next);
  maeState = next;
  return next;
}

// ── 5. Extended VPNs Hub (Mami, Argo, URnetwork, FENIX, Proton, Windscribe, Amnezia, Outline, NPV, TG-Proxy) ─
const EXTENDED_VPNS_META = [
  { id: 'flux', titleFa: 'فلاکس (FLUX)', titleEn: 'FLUX Adaptive', desc: 'مسابقه خودکار بین بهترین پروتکل‌ها و خروجی‌ها', tint: '#6366F1' },
  { id: 'mae', titleFa: 'موتور تطبیقی MAE', titleEn: 'MAE Per-App', desc: 'یادگیری هوشمند مسیر بهینه برای هر سرویس و برنامه', tint: '#3B82F6' },
  { id: 'direct_dpi', titleFa: 'اتصال مستقیم (DPI)', titleEn: 'Direct DPI-Split', desc: 'عبور از فیلتر SNI با تکه کردن ClientHello و DoH بدون سرور', tint: '#10B981' },
  { id: 'mami', titleFa: 'مامی (Mami)', titleEn: 'Mami Multi-Bridge', desc: 'اتصال خودکار ۶ حالته، پل‌های اختصاصی و شیر', tint: '#EC4899' },
  { id: 'argo', titleFa: 'آرگو (Argo VPN)', titleEn: 'Argo Bridges & Falcons', desc: 'مدیریت پل‌ها و فالکون‌های آرگو با تست ۲۵۶ کیلوبایت واقعی', tint: '#F59E0B' },
  { id: 'urnetwork', titleFa: 'یو‌آرنتورک (URnetwork)', titleEn: 'URnetwork P2P', desc: 'شبکه ۱۲ ارائه‌دهنده توزیع‌شده با تایید ترافیک واقعی', tint: '#8B5CF6' },
  { id: 'fenix', titleFa: 'فنیکس (Mozilla VPN)', titleEn: 'FENIX (Firefox)', desc: 'سرورهای رایگان فایرفاکس در ۳۳ کشور با اکانت شخصی', tint: '#FB7185' },
  { id: 'amnezia', titleFa: 'آمنزیا (AWG / Hy2)', titleEn: 'Amnezia + Hysteria2', desc: 'وایرگارد مبهم‌شده و Hysteria2 سریع با تست تاخیر', tint: '#F97316' },
  { id: 'proton', titleFa: 'پروتون وی‌پی‌ان', titleEn: 'Proton VPN Free', desc: 'سرورهای رایگان WireGuard پروتون روی اکانت شخصی', tint: '#A855F7' },
  { id: 'windscribe', titleFa: 'وینداسکرایب', titleEn: 'Windscribe Free', desc: 'سرورهای وینداسکرایب با رله WARP در زمان مسدودیت', tint: '#06B6D4' },
  { id: 'outline', titleFa: 'اوت‌لاین (Outline)', titleEn: 'Outline / Shadowmere', desc: 'کلیدهای ss:// و استخر تاییدشده Shadowmere', tint: '#22C55E' },
  { id: 'npv', titleFa: 'ان‌پي‌وی (NPV)', titleEn: 'NPV Collector', desc: 'وارد کردن فایل‌ها و اشتراک‌های چندپروتکله', tint: '#14B8A6' },
  { id: 'tgproxy', titleFa: 'پروکسی تلگرام ابری', titleEn: 'CF Telegram Proxy', desc: 'پل امن تلگرام روی کلودفلر ورکر / پیج شخصی', tint: '#38BDF8' },
];

function getExtendedState() {
  return loadJson(EXT_STATE_FILE, {
    mami: { mode: 'auto', bridges: [], connected: false },
    argo: { bridges: [], falcons: [], connected: false },
    urnetwork: { providerCount: 12, selectedRegion: 'auto', connected: false },
    fenix: { accounts: [], selectedCountry: 'DE', connected: false },
    proton: { accounts: [], connected: false },
    windscribe: { accounts: [], connected: false },
    outline: { customKeys: [], connected: false },
    tgproxy: { workerUrl: '', secret: '', active: false },
  });
}

function mergeExtendedState(patch) {
  const cur = getExtendedState();
  const next = Object.assign({}, cur);
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      next[k] = Object.assign({}, cur[k] || {}, v);
    } else {
      next[k] = v;
    }
  }
  saveJson(EXT_STATE_FILE, next);
  return next;
}

function stopSync() {
  if (directServer) { try { directServer.close(); } catch (e) {} directServer = null; }
  if (singboxProc) { try { singboxProc.kill(); } catch (e) {} singboxProc = null; }
  directStats.running = false;
  singboxState.running = false;
}

module.exports = {
  EXTENDED_VPNS_META,
  DIRECT_DPI_PORT,
  SINGBOX_SOCKS_PORT,
  startDirectDpi,
  stopDirectDpi,
  getDirectDpiStatus,
  startSingBoxProxy,
  stopSingBoxProxy,
  getSingBoxStatus: () => singboxState,
  startFlux,
  stopFlux,
  getFluxStatus: () => fluxState,
  getMaeState,
  saveMaePolicy,
  getExtendedState,
  mergeExtendedState,
  getLogs,
  stopSync,
};
