'use strict';

/**
 * Sovereign Cross-Device Sync Manager (Windows <-> Android <-> iOS <-> Cloudflare KV <-> GitHub Gist)
 *
 * Implements the shared `mlmsync://v1/` encrypted sync specification (`shared/sync-spec.json`):
 *   - KDF: PBKDF2-HMAC-SHA256 (100,000 iterations, 16-byte salt)
 *   - Cipher: AES-256-GCM (12-byte IV, 16-byte tag, AAD = 'mlmvpn-sovereign-sync-v1')
 *   - Transports:
 *       1) Offline QR / `mlmsync://v1/<base64url>` link
 *       2) Local Wi-Fi / LAN P2P pairing token (one-time code)
 *       3) Cloudflare Edge Pass Worker KV (`/sync/push`, `/sync/pull`)
 *       4) Private GitHub Gist (`mlmvpn-sovereign-vault.json`)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const DATA_DIR = path.join(os.homedir(), '.mlmvpn');
const SYNC_META_FILE = path.join(DATA_DIR, 'sovereign-sync.json');
const AAD = Buffer.from('mlmvpn-sovereign-sync-v1', 'utf8');
const URI_PREFIX = 'mlmsync://v1/';

const lanSessions = new Map(); // code -> { token, expiresAt, createdAt }

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function saveJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function getSyncConfig() {
  return Object.assign({
    slot: 'default',
    lastPushAt: null,
    lastPullAt: null,
    deviceName: os.hostname(),
    gistId: '',
  }, loadJson(SYNC_META_FILE, {}));
}

function setSyncConfig(patch) {
  const next = Object.assign(getSyncConfig(), patch || {});
  saveJson(SYNC_META_FILE, next);
  return next;
}

/** Collect all user configurations across MLMVPN subsystems cleanly (no secrets leaked unencrypted). */
function exportSnapshot(storageManager) {
  const safeGet = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
  const cfBypass = safeGet(() => require('./cf-bypass-manager').getConfig(), {});
  const sanction = safeGet(() => require('./sanction-manager').getConfig(), {});
  const dedidns = safeGet(() => require('./dedicated-dns-manager').getConfig(), {});
  const netSettings = safeGet(() => require('./network-settings').get(), {});
  const appRouting = safeGet(() => require('./app-routing').get(), {});
  const cloudPanels = safeGet(() => loadJson(path.join(DATA_DIR, 'cloud-panels.json'), {}), {});
  const extended = safeGet(() => require('./sovereign-engines-manager').getExtendedState(), {});

  let rawStorage = {};
  if (storageManager && typeof storageManager.getAll === 'function') {
    rawStorage = storageManager.getAll() || {};
  } else {
    rawStorage = loadJson(path.join(DATA_DIR, 'user_data.json'), {});
  }

  const parseMaybe = (v, fb) => {
    if (v == null) return fb;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return fb; } }
    return v;
  };

  return {
    schema: 'mlmsync-v1',
    exportedAt: Date.now(),
    sourcePlatform: 'windows',
    deviceName: os.hostname(),
    cfBypass,
    sanction,
    dedidns,
    netSettings,
    appRouting,
    cloudAccounts: parseMaybe(rawStorage.cf_accounts, []),
    v2rayNodes: parseMaybe(rawStorage.v2rayNodes, []),
    subscriptions: parseMaybe(rawStorage.v2raySubscriptions, []),
    cleanIps: parseMaybe(rawStorage.ip_archive, []),
    cloudPanels,
    extended,
  };
}

/** Merge a decrypted snapshot from Windows, Android, or iOS into local state without wiping unrelated fields. */
function importSnapshot(snapshot, storageManager, { merge = true } = {}) {
  if (!snapshot || snapshot.schema !== 'mlmsync-v1') {
    throw new Error('فرمت بستهٔ همگام‌سازی معتبر نیست.');
  }
  const applied = [];

  if (snapshot.cfBypass && typeof snapshot.cfBypass === 'object') {
    const mgr = require('./cf-bypass-manager');
    const cur = mgr.getConfig();
    const incoming = snapshot.cfBypass;
    const next = merge ? Object.assign({}, cur, incoming, {
      packs: [...new Set([...(cur.packs || []), ...(incoming.packs || [])])],
      customDomains: [...new Set([...(cur.customDomains || []), ...(incoming.customDomains || [])])],
      enabled: cur.enabled,
    }) : incoming;
    mgr.setConfig(next);
    applied.push('cfBypass');
  }

  if (snapshot.sanction && typeof snapshot.sanction === 'object') {
    const sMgr = require('./sanction-manager');
    const cur = sMgr.getConfig();
    sMgr.setConfig({
      sites: merge ? [...new Set([...(cur.sites || []), ...(snapshot.sanction.sites || [])])] : (snapshot.sanction.sites || []),
      apps: merge ? [...new Set([...(cur.apps || []), ...(snapshot.sanction.apps || [])])] : (snapshot.sanction.apps || []),
      engine: snapshot.sanction.engine || cur.engine,
    });
    applied.push('sanction');
  }

  if (snapshot.dedidns && typeof snapshot.dedidns === 'object') {
    require('./dedicated-dns-manager').setConfig({
      workerUrl: snapshot.dedidns.workerUrl || undefined,
      dohWorkerUrl: snapshot.dedidns.dohWorkerUrl || undefined,
      region: snapshot.dedidns.region || undefined,
      dohGroup: snapshot.dedidns.dohGroup || undefined,
    });
    applied.push('dedidns');
  }

  if (storageManager && typeof storageManager.setItem === 'function') {
    const mergeByKey = (key, incomingList, idFn) => {
      if (!Array.isArray(incomingList) || !incomingList.length) return;
      let existing = [];
      try { existing = JSON.parse(storageManager.getItem(key) || '[]'); } catch (e) { existing = []; }
      if (!Array.isArray(existing) || !merge) existing = [];
      const seen = new Set(existing.map(idFn));
      for (const item of incomingList) {
        const k = idFn(item);
        if (!seen.has(k)) { seen.add(k); existing.push(item); }
      }
      storageManager.setItem(key, JSON.stringify(existing));
      applied.push(key);
    };
    mergeByKey('cf_accounts', snapshot.cloudAccounts, (a) => a.token || a.id);
    mergeByKey('v2rayNodes', snapshot.v2rayNodes, (n) => n.uri || n.id || JSON.stringify(n));
    mergeByKey('v2raySubscriptions', snapshot.subscriptions, (s) => s.url || s.id);
    mergeByKey('ip_archive', snapshot.cleanIps, (i) => `${i.ip}:${i.port || 443}`);
  }

  if (snapshot.cloudPanels && typeof snapshot.cloudPanels === 'object') {
    const file = path.join(DATA_DIR, 'cloud-panels.json');
    const cur = loadJson(file, {});
    saveJson(file, merge ? Object.assign({}, cur, snapshot.cloudPanels) : snapshot.cloudPanels);
    applied.push('cloudPanels');
  }

  if (snapshot.extended && typeof snapshot.extended === 'object') {
    require('./sovereign-engines-manager').mergeExtendedState(snapshot.extended);
    applied.push('extended');
  }

  return { ok: true, applied, importedAt: Date.now(), sourcePlatform: snapshot.sourcePlatform || 'unknown' };
}

function deriveKey(passphrase, salt) {
  if (!passphrase || String(passphrase).length < 4) {
    throw new Error('رمز عبور همگام‌سازی باید حداقل ۴ کاراکتر باشد.');
  }
  return crypto.pbkdf2Sync(String(passphrase), salt, 100000, 32, 'sha256');
}

function encryptBundle(snapshot, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const plain = Buffer.from(JSON.stringify(snapshot), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([salt, iv, enc, tag]);
  return URI_PREFIX + packed.toString('base64url');
}

function decryptBundle(uriOrToken, passphrase) {
  const raw = String(uriOrToken || '').trim();
  const payload = raw.startsWith(URI_PREFIX) ? raw.slice(URI_PREFIX.length) : raw;
  const buf = Buffer.from(payload, 'base64url');
  if (buf.length < 16 + 12 + 16 + 2) {
    throw new Error('طول دادهٔ رمزنگاری‌شده معتبر نیست.');
  }
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const tag = buf.subarray(buf.length - 16);
  const enc = buf.subarray(28, buf.length - 16);
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  let dec;
  try {
    dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  } catch (e) {
    throw new Error('رمز عبور اشتباه است یا بسته آسیب دیده است.');
  }
  return JSON.parse(dec.toString('utf8'));
}

// ── Cloud KV Sync (via user's cf-edge-pass Worker) ───────────────────────────
async function pushToCloudWorker(storageManager, passphrase, { workerUrl, passKey, slot } = {}) {
  const cfCfg = require('./cf-bypass-manager').getConfig();
  const base = (workerUrl || cfCfg.workerUrl || '').replace(/\/+$/, '');
  const key = passKey || cfCfg.passKey || '';
  const sl = (slot || getSyncConfig().slot || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!base) throw new Error('ابتدا ورکر کلودفلر را در بخش «سپر کلودفلر» تنظیم یا مستقر کنید.');
  const bundle = encryptBundle(exportSnapshot(storageManager), passphrase);
  const res = await axios.post(`${base}/sync/push?slot=${encodeURIComponent(sl)}`, bundle, {
    headers: { 'Content-Type': 'text/plain', 'X-Edge-Key': key },
    timeout: 20000,
  });
  setSyncConfig({ slot: sl, lastPushAt: Date.now() });
  return Object.assign({ ok: true }, res.data);
}

async function pullFromCloudWorker(storageManager, passphrase, { workerUrl, passKey, slot, merge = true } = {}) {
  const cfCfg = require('./cf-bypass-manager').getConfig();
  const base = (workerUrl || cfCfg.workerUrl || '').replace(/\/+$/, '');
  const key = passKey || cfCfg.passKey || '';
  const sl = (slot || getSyncConfig().slot || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!base) throw new Error('نشانی ورکر کلودفلر مشخص نیست.');
  const res = await axios.get(`${base}/sync/pull?slot=${encodeURIComponent(sl)}`, {
    headers: { 'X-Edge-Key': key },
    timeout: 20000,
  });
  if (!res.data || !res.data.payload) throw new Error('هیچ بسته‌ای در کلودفلر پیدا نشد.');
  const snap = decryptBundle(res.data.payload, passphrase);
  const imported = importSnapshot(snap, storageManager, { merge });
  setSyncConfig({ slot: sl, lastPullAt: Date.now() });
  return imported;
}

// ── Private GitHub Gist Vault Sync ────────────────────────────────────────────
async function pushToGithubGist(storageManager, passphrase, { githubToken, gistId } = {}) {
  if (!githubToken) throw new Error('توکن گیت‌هاب الزامی است.');
  const bundle = encryptBundle(exportSnapshot(storageManager), passphrase);
  const headers = { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'MLMVPN-Sovereign' };
  const payload = {
    description: 'MLMVPN Sovereign Cross-Device Encrypted Vault',
    public: false,
    files: { 'mlmvpn-sovereign-vault.txt': { content: bundle } },
  };
  let targetId = gistId || getSyncConfig().gistId;
  let resp;
  if (targetId) {
    resp = await axios.patch(`https://api.github.com/gists/${targetId}`, payload, { headers, timeout: 20000 });
  } else {
    resp = await axios.post('https://api.github.com/gists', payload, { headers, timeout: 20000 });
    targetId = resp.data.id;
  }
  setSyncConfig({ gistId: targetId, lastPushAt: Date.now() });
  return { ok: true, gistId: targetId, updatedAt: resp.data.updated_at };
}

async function pullFromGithubGist(storageManager, passphrase, { githubToken, gistId, merge = true } = {}) {
  const id = gistId || getSyncConfig().gistId;
  if (!githubToken || !id) throw new Error('توکن گیت‌هاب و شناسه Gist الزامی است.');
  const headers = { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'MLMVPN-Sovereign' };
  const resp = await axios.get(`https://api.github.com/gists/${id}`, { headers, timeout: 20000 });
  const file = resp.data && resp.data.files && resp.data.files['mlmvpn-sovereign-vault.txt'];
  if (!file || !file.content) throw new Error('فایل همگام‌سازی در این Gist یافت نشد.');
  const snap = decryptBundle(file.content, passphrase);
  const imported = importSnapshot(snap, storageManager, { merge });
  setSyncConfig({ gistId: id, lastPullAt: Date.now() });
  return imported;
}

// ── Local LAN P2P Pairing ─────────────────────────────────────────────────────
function createLanPairingCode(port) {
  const code = String(crypto.randomInt(100000, 999999));
  const token = crypto.randomBytes(24).toString('hex');
  lanSessions.set(code, { token, createdAt: Date.now(), expiresAt: Date.now() + 10 * 60 * 1000 });
  const ips = [];
  const ifs = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifs)) {
    if (/loopback|wintun|mlmvpn|tailscale|vethernet/i.test(name)) continue;
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        ips.push(`http://${a.address}:${port}`);
      }
    }
  }
  return { code, token, expiresInSec: 600, lanUrls: ips };
}

function verifyLanPairing(code, token) {
  const s = lanSessions.get(String(code || ''));
  if (!s || Date.now() > s.expiresAt) return false;
  return s.token === token;
}

module.exports = {
  getSyncConfig,
  setSyncConfig,
  exportSnapshot,
  importSnapshot,
  encryptBundle,
  decryptBundle,
  pushToCloudWorker,
  pullFromCloudWorker,
  pushToGithubGist,
  pullFromGithubGist,
  createLanPairingCode,
  verifyLanPairing,
};
