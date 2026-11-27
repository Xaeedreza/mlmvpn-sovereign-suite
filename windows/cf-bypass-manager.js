'use strict';

/**
 * «سپر کلودفلر بدون فیلترشکن» — Zero-VPN Cloudflare Edge Pass Manager.
 *
 * Routes ONLY user-selected domains and applications through Cloudflare Edge
 * (via the user's deployed `cf-edge-pass` Worker + Clean CF IP, or reverse-proxy
 * fallback) WITHOUT enabling a global VPN or changing the default route for
 * domestic banking, gaming, or ordinary traffic.
 *
 * Architecture rules honoured:
 *  - Rule 1: Zero sync spawns on click/request paths.
 *  - Rule 2: Reads ports/LAN settings from network-settings.js.
 *  - Rule 3: Snapshots Windows WinINET AutoConfigURL to disk BEFORE modifying it.
 *  - Rule 4: Deterministic teardown in stopSync() and stopAsync().
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const axios = require('axios');

const DATA_DIR = path.join(os.homedir(), '.mlmvpn');
const CONFIG_FILE = path.join(DATA_DIR, 'cf-bypass-config.json');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'cf-bypass-wininet-snapshot.json');
const XRAY_CONFIG_FILE = path.join(DATA_DIR, 'cf-bypass-xray.json');

const LOCAL_PROXY_PORT = 20822; // Micro-router HTTP/SOCKS listener (PAC target)
const LOCAL_XRAY_PORT = 20823;  // Internal VLESS-WS-over-CF-Edge listener when xray.exe exists

const PRESET_PACKS = [
  {
    id: 'ai_suite',
    titleFa: 'هوش مصنوعی (AI)',
    titleEn: 'AI Suite',
    icon: 'ph-fill ph-sparkle',
    domains: [
      'chatgpt.com', 'chat.openai.com', 'openai.com', 'api.openai.com', 'auth.openai.com', 'cdn.oaistatic.com', 'oaiusercontent.com',
      'claude.ai', 'api.anthropic.com', 'console.anthropic.com',
      'gemini.google.com', 'aistudio.google.com', 'generativelanguage.googleapis.com', 'alkalimakersuite-pa.clients6.google.com',
      'perplexity.ai', 'www.perplexity.ai', 'grok.com', 'x.ai', 'copilot.microsoft.com', 'poe.com',
    ],
  },
  {
    id: 'dev_cloud',
    titleFa: 'برنامه‌نویسی و ابزارهای توسعه',
    titleEn: 'Dev & Cloud',
    icon: 'ph-fill ph-code',
    domains: [
      'github.com', 'api.github.com', 'raw.githubusercontent.com', 'codeload.github.com', 'objects.githubusercontent.com', 'ghcr.io',
      'gitlab.com', 'registry.npmjs.org', 'www.npmjs.com', 'pypi.org', 'files.pythonhosted.org',
      'hub.docker.com', 'registry-1.docker.io', 'auth.docker.io', 'production.cloudflare.docker.com',
      'huggingface.co', 'hf.co', 'cursor.sh', 'api2.cursor.sh', 'developer.android.com', 'firebase.google.com',
    ],
  },
  {
    id: 'gaming_login',
    titleFa: 'ورود و تحریم بازی‌ها',
    titleEn: 'Gaming & Auth',
    icon: 'ph-fill ph-game-controller',
    domains: [
      'store.steampowered.com', 'steamcommunity.com', 'login.steampowered.com', 'api.steampowered.com',
      'www.epicgames.com', 'store.epicgames.com', 'accounts.epicgames.com',
      'account.battle.net', 'us.battle.net', 'eu.battle.net', 'signin.ea.com', 'accounts.ea.com',
      'connect.ubisoft.com', 'socialclub.rockstargames.com', 'auth.riotgames.com',
      'login.live.com', 'account.xbox.com', 'id.sonyentertainmentnetwork.com',
    ],
  },
  {
    id: 'media_social',
    titleFa: 'رسانه و شبکه اجتماعی',
    titleEn: 'Media & Social',
    icon: 'ph-fill ph-globe-hemisphere-west',
    domains: [
      'youtube.com', 'www.youtube.com', 'youtu.be', 'i.ytimg.com', 'googlevideo.com',
      'accounts.spotify.com', 'open.spotify.com', 'api.spotify.com',
      'x.com', 'twitter.com', 'api.x.com', 'pbs.twimg.com',
      'web.telegram.org', 'discord.com', 'cdn.discordapp.com', 'soundcloud.com', 'medium.com', 'reddit.com',
    ],
  },
];

const DEFAULT_CONFIG = {
  enabled: false,
  mode: 'pac-micro', // 'pac-micro' (System PAC + Local Micro-Router) | 'port-only' (Browser/App explicit proxy)
  workerUrl: '',
  workerName: '',
  uuid: '',
  passKey: '',
  cleanIp: '104.16.132.229',
  cleanPort: 443,
  proxyIp: '',
  tlsFragment: true,
  ecsRegion: 'AE',
  applySystemPac: true,
  packs: ['ai_suite', 'dev_cloud'],
  customDomains: [],
  apps: [], // [{ exe, name }]
  accountId: '',
  lastTestAt: null,
};

let serverInstance = null;
let xrayProc = null;
let serverHttpPort = 0; // set by setAppPort(port)
let logs = [];
let stats = {
  running: false,
  mode: 'pac-micro',
  startedAt: 0,
  proxiedRequests: 0,
  directBypassed: 0,
  bytesOut: 0,
  bytesIn: 0,
  xrayActive: false,
  lastError: null,
};

function getUnpackedDir() {
  return __dirname.toLowerCase().includes('.asar')
    ? __dirname.replace(/\.asar/gi, '.asar.unpacked')
    : __dirname;
}

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${msg}`;
  logs.push(line);
  if (logs.length > 300) logs.shift();
}

function getLogs() {
  return logs.slice();
}

function setAppPort(port) {
  serverHttpPort = Number(port) || 0;
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function saveJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function getConfig() {
  const raw = loadJson(CONFIG_FILE, {});
  const cfg = Object.assign({}, DEFAULT_CONFIG, raw);
  cfg.packs = Array.isArray(cfg.packs) ? cfg.packs : DEFAULT_CONFIG.packs.slice();
  cfg.customDomains = Array.isArray(cfg.customDomains) ? cfg.customDomains : [];
  cfg.apps = Array.isArray(cfg.apps) ? cfg.apps : [];
  if (!cfg.uuid) cfg.uuid = crypto.randomUUID();
  if (!cfg.passKey) cfg.passKey = crypto.randomBytes(16).toString('hex');
  return cfg;
}

function setConfig(patch) {
  const cur = getConfig();
  const next = Object.assign({}, cur, patch || {});
  if (typeof next.workerUrl === 'string') {
    next.workerUrl = next.workerUrl.trim().replace(/\/+$/, '');
  }
  if (Array.isArray(next.customDomains)) {
    const clean = new Set();
    for (const d of next.customDomains) {
      const s = String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
      if (s && /^[a-z0-9*.-]+$/.test(s)) clean.add(s);
    }
    next.customDomains = [...clean];
  }
  saveJson(CONFIG_FILE, next);
  return next;
}

function getEffectiveDomains(cfg = getConfig()) {
  const set = new Set();
  for (const packId of cfg.packs || []) {
    const pack = PRESET_PACKS.find((p) => p.id === packId);
    if (pack) pack.domains.forEach((d) => set.add(d.toLowerCase()));
  }
  for (const d of cfg.customDomains || []) {
    set.add(String(d).toLowerCase());
  }
  return [...set];
}

function matchesDomain(host, domains) {
  const h = String(host || '').toLowerCase().split(':')[0];
  if (!h) return false;
  for (const rule of domains) {
    const r = rule.startsWith('*.') ? rule.slice(2) : rule;
    if (h === r || h.endsWith('.' + r)) return true;
  }
  return false;
}

/** Generate standard Proxy Auto-Config (PAC) script routing ONLY chosen domains through 127.0.0.1:20822. */
function buildPacScript(cfg = getConfig()) {
  const domains = getEffectiveDomains(cfg);
  const rulesJson = JSON.stringify(domains);
  const proxyTarget = `PROXY 127.0.0.1:${LOCAL_PROXY_PORT}; DIRECT`;
  return `// MLMVPN Sovereign Zero-VPN Cloudflare Edge Pass PAC
var BYPASS_DOMAINS = ${rulesJson};
function hostMatches(host, rule) {
  if (!host || !rule) return false;
  if (rule.indexOf('*.') === 0) rule = rule.slice(2);
  return host === rule || (host.length > rule.length && host.slice(host.length - rule.length - 1) === '.' + rule);
}
function FindProxyForURL(url, host) {
  host = (host || '').toLowerCase().split(':')[0];
  if (!host || isPlainHostName(host) || host === '127.0.0.1' || host === 'localhost' || host.slice(-3) === '.ir') {
    return 'DIRECT';
  }
  if (isInNet(dnsResolve(host), '10.0.0.0', '255.0.0.0') ||
      isInNet(dnsResolve(host), '172.16.0.0', '255.240.0.0') ||
      isInNet(dnsResolve(host), '192.168.0.0', '255.255.0.0')) {
    // Allow poisoned RFC1918 answers (10.10.34.x) in bypass list to still hit edge proxy
    for (var i = 0; i < BYPASS_DOMAINS.length; i++) {
      if (hostMatches(host, BYPASS_DOMAINS[i])) return '${proxyTarget}';
    }
    return 'DIRECT';
  }
  for (var j = 0; j < BYPASS_DOMAINS.length; j++) {
    if (hostMatches(host, BYPASS_DOMAINS[j])) return '${proxyTarget}';
  }
  return 'DIRECT';
}
`;
}

// ── Windows Registry Snapshot & Safe WinINET AutoConfigURL Management ─────────
function execReg(args) {
  return new Promise((resolve) => {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const regExe = path.join(sysRoot, 'System32', 'reg.exe');
    execFile(regExe, args, { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

async function readCurrentAutoConfigUrl() {
  const r = await execReg(['query', REG_KEY, '/v', 'AutoConfigURL']);
  if (!r.ok) return null;
  const m = r.stdout.match(/AutoConfigURL\s+REG_SZ\s+(.+)/i);
  return m ? m[1].trim() : null;
}

async function applySystemPac(pacUrl) {
  if (process.platform !== 'win32') return { ok: true, skipped: true };
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    const prev = await readCurrentAutoConfigUrl();
    saveJson(SNAPSHOT_FILE, { prevAutoConfigURL: prev, savedAt: Date.now() });
  }
  const res = await execReg(['add', REG_KEY, '/v', 'AutoConfigURL', '/t', 'REG_SZ', '/d', pacUrl, '/f']);
  notifyWinInetChanged();
  return res;
}

async function restoreSystemPac() {
  if (process.platform !== 'win32') return { ok: true };
  if (!fs.existsSync(SNAPSHOT_FILE)) return { ok: true };
  const snap = loadJson(SNAPSHOT_FILE, {});
  try {
    if (snap.prevAutoConfigURL) {
      await execReg(['add', REG_KEY, '/v', 'AutoConfigURL', '/t', 'REG_SZ', '/d', snap.prevAutoConfigURL, '/f']);
    } else {
      await execReg(['delete', REG_KEY, '/v', 'AutoConfigURL', '/f']);
    }
    notifyWinInetChanged();
  } finally {
    try { fs.unlinkSync(SNAPSHOT_FILE); } catch (e) { /* gone */ }
  }
  return { ok: true };
}

function restoreSystemPacSync() {
  if (process.platform !== 'win32' || !fs.existsSync(SNAPSHOT_FILE)) return;
  try {
    const { execFileSync } = require('child_process');
    const snap = loadJson(SNAPSHOT_FILE, {});
    const regExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    if (snap.prevAutoConfigURL) {
      execFileSync(regExe, ['add', REG_KEY, '/v', 'AutoConfigURL', '/t', 'REG_SZ', '/d', snap.prevAutoConfigURL, '/f'], { windowsHide: true, timeout: 4000 });
    } else {
      execFileSync(regExe, ['delete', REG_KEY, '/v', 'AutoConfigURL', '/f'], { windowsHide: true, timeout: 4000 });
    }
    fs.unlinkSync(SNAPSHOT_FILE);
  } catch (e) { /* best effort on quit */ }
}

function notifyWinInetChanged() {
  if (process.platform !== 'win32') return;
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `Add-Type -MemberDefinition '[DllImport("wininet.dll")] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l);' -Name W -Namespace N; [N.W]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null; [N.W]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null`;
  execFile(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 5000 }, () => {});
}

// ── Optional Cloudflare Worker Deployer for cf-edge-pass ───────────────────────
async function deployEdgePassWorker(account, opts = {}) {
  if (!account || !account.token) throw new Error('حساب کلودفلر انتخاب نشده است.');
  const cfg = getConfig();
  const token = String(account.token).trim();
  const email = String(account.email || '').trim();
  const cfHeaders = (token.startsWith('cfat_') || !email)
    ? { Authorization: `Bearer ${token}` }
    : { 'X-Auth-Email': email, 'X-Auth-Key': token };

  const API = 'https://api.cloudflare.com/client/v4';
  const accRes = await axios.get(`${API}/accounts`, { headers: cfHeaders, timeout: 15000 });
  const accId = (accRes.data && accRes.data.result && accRes.data.result[0] && accRes.data.result[0].id);
  if (!accId) throw new Error('اکانت کلودفلر پیدا نشد.');

  const subRes = await axios.get(`${API}/accounts/${accId}/workers/subdomain`, { headers: cfHeaders, timeout: 15000, validateStatus: () => true });
  let sub = subRes.data && subRes.data.result && (subRes.data.result.subdomain || subRes.data.result.name);
  if (!sub) {
    throw new Error('ابتدا در بخش «زیرساخت ابری» یک زیردامنه workers.dev فعال کنید.');
  }

  let safePrefix = 'edge-pass';
  try { safePrefix = require('./anti-dpi').generateSafeWorkerName(); } catch (e) { /* default */ }
  const scriptName = opts.scriptName || cfg.workerName || `${safePrefix}-cfpass`;
  const uuid = opts.uuid || cfg.uuid || crypto.randomUUID();
  const passKey = opts.passKey || cfg.passKey || crypto.randomBytes(16).toString('hex');

  // Optional KV namespace for cross-device Sovereign Sync
  let syncKvId = null;
  try {
    const kvs = await axios.get(`${API}/accounts/${accId}/storage/kv/namespaces?per_page=100`, { headers: cfHeaders, timeout: 15000 });
    const existing = ((kvs.data && kvs.data.result) || []).find((k) => k.title === 'mlmvpn-sovereign-sync');
    if (existing) syncKvId = existing.id;
    else {
      const made = await axios.post(`${API}/accounts/${accId}/storage/kv/namespaces`, { title: 'mlmvpn-sovereign-sync' }, { headers: cfHeaders, timeout: 15000 });
      syncKvId = made.data && made.data.result && made.data.result.id;
    }
  } catch (e) { /* KV optional */ }

  const workerFile = path.join(getUnpackedDir(), 'public', 'cf_edge_pass_worker.js');
  const code = fs.readFileSync(workerFile, 'utf8');

  const bindings = [
    { type: 'secret_text', name: 'UUID', text: uuid },
    { type: 'secret_text', name: 'PASS_KEY', text: passKey },
    { type: 'plain_text', name: 'DEFAULT_REGION', text: cfg.ecsRegion || 'AE' },
  ];
  if (cfg.proxyIp) bindings.push({ type: 'plain_text', name: 'PROXY_IP', text: cfg.proxyIp });
  if (syncKvId) bindings.push({ type: 'kv_namespace', name: 'SYNC_KV', namespace_id: syncKvId });

  const meta = { main_module: 'worker.js', compatibility_date: '2025-01-15', compatibility_flags: ['nodejs_compat'], bindings };
  const boundary = '----mlmcfpass' + crypto.randomBytes(8).toString('hex');
  const body = [
    '--' + boundary, 'Content-Disposition: form-data; name="metadata"', 'Content-Type: application/json', '', JSON.stringify(meta),
    '--' + boundary, 'Content-Disposition: form-data; name="worker.js"; filename="worker.js"', 'Content-Type: application/javascript+module', '', code,
    '--' + boundary + '--', '',
  ].join('\r\n');

  await axios.put(`${API}/accounts/${accId}/workers/scripts/${scriptName}`, body, {
    headers: Object.assign({}, cfHeaders, { 'Content-Type': `multipart/form-data; boundary=${boundary}` }),
    timeout: 90000,
    maxBodyLength: Infinity,
  });
  await axios.post(`${API}/accounts/${accId}/workers/scripts/${scriptName}/subdomain`, { enabled: true }, { headers: cfHeaders, timeout: 20000 });

  const workerUrl = `https://${scriptName}.${sub}.workers.dev`;
  const updated = setConfig({ workerUrl, workerName: scriptName, uuid, passKey, accountId: account.id || accId });
  log(`ورکر سپر کلودفلر با موفقیت مستقر شد: ${workerUrl}`);
  return { ok: true, workerUrl, scriptName, uuid, passKey, hasSyncKv: !!syncKvId, config: updated };
}

// ── Internal Selective Tunnel (Xray VLESS-WS over Clean CF IP, or Pure TLS-Split Relay) ─
function findXrayExe() {
  const candidates = [
    path.join(getUnpackedDir(), 'core', 'xray.exe'),
    path.join(__dirname, 'core', 'xray.exe'),
  ];
  try {
    const corePaths = require('./core-paths');
    candidates.unshift(corePaths.file('xray', 'xray.exe', candidates[0]));
  } catch (e) { /* no core-paths */ }
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function startXrayMicroCore(cfg) {
  return new Promise((resolve) => {
    const xrayExe = findXrayExe();
    if (!xrayExe || !cfg.workerUrl) {
      return resolve({ ok: false, reason: xrayExe ? 'no-worker' : 'no-xray' });
    }
    let workerHost = '';
    try { workerHost = new URL(cfg.workerUrl).hostname; } catch (e) { return resolve({ ok: false, reason: 'bad-url' }); }

    const dialAddress = cfg.cleanIp || workerHost;
    const dialPort = Number(cfg.cleanPort) || 443;
    const wsPath = cfg.proxyIp ? `/?ed=2560&proxyip=${encodeURIComponent(cfg.proxyIp)}` : '/?ed=2560';

    const xrayConfig = {
      log: { loglevel: 'warning' },
      inbounds: [{
        listen: '127.0.0.1',
        port: LOCAL_XRAY_PORT,
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
      }],
      outbounds: [{
        tag: 'cf-edge',
        protocol: 'vless',
        settings: {
          vnext: [{
            address: dialAddress,
            port: dialPort,
            users: [{ id: cfg.uuid, encryption: 'none' }],
          }],
        },
        streamSettings: {
          network: 'ws',
          security: 'tls',
          tlsSettings: { serverName: workerHost, fingerprint: 'chrome', alpn: ['http/1.1'] },
          wsSettings: { path: wsPath, headers: { Host: workerHost } },
          sockopt: cfg.tlsFragment ? { dialerProxy: 'cf-frag' } : undefined,
        },
      }],
    };

    if (cfg.tlsFragment) {
      xrayConfig.outbounds.push({
        tag: 'cf-frag',
        protocol: 'freedom',
        settings: { fragment: { packets: 'tlshello', length: '10-30', interval: '1-5' } },
      });
    }

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(XRAY_CONFIG_FILE, JSON.stringify(xrayConfig, null, 2), 'utf8');

    const proc = spawn(xrayExe, ['run', '-c', XRAY_CONFIG_FILE], { windowsHide: true });
    xrayProc = proc;
    let settled = false;
    const done = (ok, reason) => {
      if (settled) return;
      settled = true;
      resolve({ ok, reason });
    };

    proc.once('error', (err) => done(false, err.message));
    proc.once('exit', () => {
      if (xrayProc === proc) xrayProc = null;
      stats.xrayActive = false;
      done(false, 'xray-exited');
    });

    // Wait up to 3.5s for local SOCKS port
    const started = Date.now();
    const check = () => {
      if (settled) return;
      const s = net.connect({ host: '127.0.0.1', port: LOCAL_XRAY_PORT, timeout: 300 });
      s.once('connect', () => { s.destroy(); stats.xrayActive = true; done(true); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() - started > 3500) done(false, 'xray-timeout');
        else setTimeout(check, 150);
      });
    };
    setTimeout(check, 200);
  });
}

// ── SOCKS5 Client Dialer -> Local Xray Port ───────────────────────────────────
function dialViaLocalSocks(targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port: LOCAL_XRAY_PORT });
    let stage = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('socks timeout')); }, 12000);
    sock.once('error', (e) => { clearTimeout(timer); reject(e); });
    sock.once('connect', () => sock.write(Buffer.from([0x05, 0x01, 0x00])));
    sock.on('data', (d) => {
      if (stage === 0) {
        if (d[0] !== 0x05 || d[1] !== 0x00) { clearTimeout(timer); sock.destroy(); return reject(new Error('socks auth failed')); }
        stage = 1;
        const h = Buffer.from(targetHost, 'utf8');
        sock.write(Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, h.length]),
          h,
          Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
        ]));
      } else if (stage === 1) {
        if (d[0] !== 0x05 || d[1] !== 0x00) { clearTimeout(timer); sock.destroy(); return reject(new Error('socks connect refused')); }
        clearTimeout(timer);
        sock.removeAllListeners('data');
        resolve(sock);
      }
    });
  });
}

// ── Pure Node TLS-Split Dialer (Zero-binary fallback when xray.exe not present) ─
function dialWithTlsClientHelloSplit(host, port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('direct-split timeout')); }, 10000);
    sock.once('error', (e) => { clearTimeout(timer); reject(e); });
    sock.once('connect', () => {
      clearTimeout(timer);
      sock.setNoDelay(true);
      // Wrap write once to fragment the first ClientHello TLS record into small slices
      const origWrite = sock.write.bind(sock);
      let splitFirst = false;
      sock.write = function (data, enc, cb) {
        if (!splitFirst && Buffer.isBuffer(data) && data.length > 40 && data[0] === 0x16) {
          splitFirst = true;
          const chunk1 = data.subarray(0, 12);
          const chunk2 = data.subarray(12, 32);
          const chunk3 = data.subarray(32);
          origWrite(chunk1);
          setTimeout(() => {
            if (!sock.destroyed) origWrite(chunk2);
            setTimeout(() => {
              if (!sock.destroyed) origWrite(chunk3, enc, cb);
            }, 3);
          }, 3);
          return true;
        }
        return origWrite(data, enc, cb);
      };
      resolve(sock);
    });
  });
}

// ── Local Micro-Router HTTP/CONNECT Server (127.0.0.1:20822) ──────────────────
function startMicroProxyServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      const cfg = getConfig();
      const domains = getEffectiveDomains(cfg);
      let targetUrl;
      try { targetUrl = new URL(req.url); } catch (e) { res.writeHead(400); return res.end('Bad URL'); }

      const shouldEdge = matchesDomain(targetUrl.hostname, domains);
      if (shouldEdge && cfg.workerUrl) {
        stats.proxiedRequests++;
        // Forward HTTP via worker /proxy endpoint cleanly through Clean CF IP if configured
        try {
          const wUrl = new URL(cfg.workerUrl);
          const proxyTarget = `${wUrl.origin}/proxy?url=${encodeURIComponent(targetUrl.toString())}&key=${encodeURIComponent(cfg.passKey || '')}`;
          const headers = Object.assign({}, req.headers, { Host: wUrl.host });
          const upstream = await axios({
            method: req.method,
            url: proxyTarget,
            headers,
            data: (req.method !== 'GET' && req.method !== 'HEAD') ? req : undefined,
            responseType: 'stream',
            validateStatus: () => true,
            timeout: 25000,
          });
          res.writeHead(upstream.status, upstream.headers);
          upstream.data.pipe(res);
          return;
        } catch (err) {
          res.writeHead(502);
          return res.end('Edge Pass Error: ' + err.message);
        }
      }

      stats.directBypassed++;
      const mod = targetUrl.protocol === 'https:' ? https : http;
      const proxyReq = mod.request(targetUrl, { method: req.method, headers: req.headers }, (upRes) => {
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      });
      proxyReq.on('error', (e) => { res.writeHead(502); res.end(e.message); });
      req.pipe(proxyReq);
    });

    srv.on('connect', async (req, clientSock, head) => {
      const [host, portStr] = String(req.url || '').split(':');
      const port = parseInt(portStr, 10) || 443;
      const cfg = getConfig();
      const domains = getEffectiveDomains(cfg);
      const shouldEdge = matchesDomain(host, domains);

      try {
        let remoteSock;
        if (shouldEdge) {
          stats.proxiedRequests++;
          if (stats.xrayActive) {
            remoteSock = await dialViaLocalSocks(host, port);
          } else {
            remoteSock = await dialWithTlsClientHelloSplit(host, port);
          }
        } else {
          stats.directBypassed++;
          remoteSock = await new Promise((res2, rej2) => {
            const s = net.connect({ host, port }, () => res2(s));
            s.setTimeout(10000, () => { s.destroy(); rej2(new Error('direct timeout')); });
            s.once('error', rej2);
          });
        }

        clientSock.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: MLMVPN-CF-EdgePass\r\n\r\n');
        if (head && head.length) remoteSock.write(head);
        remoteSock.on('data', (chunk) => { stats.bytesIn += chunk.length; });
        clientSock.on('data', (chunk) => { stats.bytesOut += chunk.length; });
        remoteSock.pipe(clientSock);
        clientSock.pipe(remoteSock);
        remoteSock.on('error', () => { try { clientSock.destroy(); } catch (e) {} });
        clientSock.on('error', () => { try { remoteSock.destroy(); } catch (e) {} });
      } catch (err) {
        try { clientSock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch (e) {}
      }
    });

    srv.once('error', reject);
    srv.listen(LOCAL_PROXY_PORT, '127.0.0.1', () => {
      serverInstance = srv;
      resolve(srv);
    });
  });
}

async function start(patch) {
  if (patch) setConfig(patch);
  const cfg = getConfig();
  await stop();

  stats.lastError = null;
  log('در حال راه‌اندازی سپر کلودفلر بدون فیلترشکن...');

  // Start optional Xray VLESS-WS micro-core if workerUrl & xray.exe exist
  if (cfg.workerUrl) {
    const xr = await startXrayMicroCore(cfg);
    if (xr.ok) log(`تونل سبک کلودفلر (VLESS+Fragment) روی پورت ${LOCAL_XRAY_PORT} آماده شد.`);
    else log(`هستهٔ Xray فعال نشد (${xr.reason}) — حالت ترکیبی TLS-Split + Worker Edge فعال می‌شود.`);
  }

  await startMicroProxyServer();
  stats.running = true;
  stats.mode = cfg.mode;
  stats.startedAt = Date.now();
  setConfig({ enabled: true });

  if (cfg.mode === 'pac-micro' && cfg.applySystemPac && serverHttpPort) {
    const pacUrl = `http://127.0.0.1:${serverHttpPort}/api/cf-bypass/pac.js?t=${Date.now()}`;
    await applySystemPac(pacUrl);
    log(`مسیریابی هوشمند PAC فعال شد: فقط ${getEffectiveDomains(cfg).length} دامنه از کلودفلر عبور می‌کنند.`);
  } else {
    log(`پروکسی انتخابی بدون فیلترشکن روی 127.0.0.1:${LOCAL_PROXY_PORT} روشن شد.`);
  }

  return getStatus();
}

async function stop() {
  if (serverInstance) {
    try { await new Promise((r) => serverInstance.close(() => r())); } catch (e) {}
    serverInstance = null;
  }
  if (xrayProc) {
    try { xrayProc.kill('SIGKILL'); } catch (e) {}
    xrayProc = null;
  }
  await restoreSystemPac();
  stats.running = false;
  stats.xrayActive = false;
  setConfig({ enabled: false });
  log('سپر کلودفلر متوقف شد و تنظیمات شبکه به حالت عادی برگشت.');
  return getStatus();
}

function stopSync() {
  if (serverInstance) { try { serverInstance.close(); } catch (e) {} serverInstance = null; }
  if (xrayProc) { try { xrayProc.kill(); } catch (e) {} xrayProc = null; }
  restoreSystemPacSync();
  stats.running = false;
  stats.xrayActive = false;
}

/** Side-by-side probe: Direct vs Cloudflare Edge Pass (via micro-router or worker /_edge). */
async function probeDomain(domain) {
  const host = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!host) throw new Error('دامنه معتبر نیست.');
  const cfg = getConfig();

  const directProbe = await new Promise((resolve) => {
    const t0 = Date.now();
    const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 5000 });
    let done = false;
    const end = (r) => { if (!done) { done = true; try { sock.destroy(); } catch (e) {} resolve(Object.assign({ ms: Date.now() - t0 }, r)); } };
    sock.once('secureConnect', () => {
      sock.write(`HEAD / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n`);
    });
    sock.once('data', (b) => {
      const m = /^HTTP\/[\d.]+\s+(\d{3})/.exec(String(b));
      const status = m ? Number(m[1]) : 0;
      end({ ok: status > 0 && status !== 403 && status !== 451, status });
    });
    sock.once('timeout', () => end({ ok: false, reason: 'timeout' }));
    sock.once('error', (e) => end({ ok: false, reason: e.code || 'error' }));
  });

  let cfProbe = { ok: false, ms: 0, reason: 'not-configured' };
  if (cfg.workerUrl) {
    const t0 = Date.now();
    try {
      const wUrl = new URL(cfg.workerUrl);
      const r = await axios.get(`${wUrl.origin}/proxy?url=${encodeURIComponent('https://' + host + '/')}&key=${encodeURIComponent(cfg.passKey || '')}`, {
        timeout: 8000,
        validateStatus: () => true,
        maxRedirects: 2,
      });
      cfProbe = { ok: r.status > 0 && r.status < 500 && r.status !== 403 && r.status !== 451, status: r.status, ms: Date.now() - t0 };
    } catch (e) {
      cfProbe = { ok: false, ms: Date.now() - t0, reason: e.message };
    }
  }

  return { domain: host, direct: directProbe, cloudflareEdge: cfProbe };
}

function getStatus() {
  const cfg = getConfig();
  return {
    running: stats.running,
    mode: cfg.mode,
    pacUrl: serverHttpPort ? `http://127.0.0.1:${serverHttpPort}/api/cf-bypass/pac.js` : null,
    localProxyPort: LOCAL_PROXY_PORT,
    localXrayPort: LOCAL_XRAY_PORT,
    xrayActive: stats.xrayActive,
    xrayInstalled: !!findXrayExe(),
    workerUrl: cfg.workerUrl || '',
    cleanIp: cfg.cleanIp,
    domainCount: getEffectiveDomains(cfg).length,
    appCount: (cfg.apps || []).length,
    proxiedRequests: stats.proxiedRequests,
    directBypassed: stats.directBypassed,
    bytesIn: stats.bytesIn,
    bytesOut: stats.bytesOut,
    startedAt: stats.startedAt,
    config: cfg,
    presets: PRESET_PACKS,
  };
}

module.exports = {
  PRESET_PACKS,
  LOCAL_PROXY_PORT,
  LOCAL_XRAY_PORT,
  setAppPort,
  getConfig,
  setConfig,
  getEffectiveDomains,
  buildPacScript,
  deployEdgePassWorker,
  start,
  stop,
  stopSync,
  probeDomain,
  getStatus,
  getLogs,
  restoreSystemPac,
  restoreSystemPacSync,
};
