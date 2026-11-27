'use strict';

/**
 * Sovereign Express Routes for MLMVPN Windows
 * Wires:
 *  - /api/cf-bypass/*       (Zero-VPN Cloudflare Edge Pass + PAC + Worker Deploy + Probe)
 *  - /api/pools/*           (Multi-Source Aggregator across VLESS/VMess/Trojan/SS/Hy2/TUIC/WG)
 *  - /api/sovereign/*       (Direct DPI, FLUX, MAE, Sing-box proxy, Extended VPNs)
 *  - /api/sync/*            (Cross-device mlmsync:// AES-GCM, LAN P2P, CF KV, GitHub Gist)
 */

const cfBypass = require('./cf-bypass-manager');
const multiPool = require('./multi-pool-aggregator');
const engines = require('./sovereign-engines-manager');
const syncMgr = require('./sovereign-sync-manager');

module.exports = function registerSovereignRoutes(app, { storageManager, broadcast, getPort }) {
  // ── Zero-VPN Cloudflare Edge Pass ───────────────────────────────────────────
  app.get('/api/cf-bypass/status', (req, res) => {
    try { res.json({ ok: true, status: cfBypass.getStatus(), logs: cfBypass.getLogs() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/cf-bypass/config', (req, res) => {
    try {
      const cfg = cfBypass.setConfig(req.body || {});
      res.json({ ok: true, config: cfg, status: cfBypass.getStatus() });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/cf-bypass/deploy-worker', async (req, res) => {
    try {
      const b = req.body || {};
      let account = b.account;
      if (!account && b.accountId && storageManager) {
        const raw = storageManager.getItem('cf_accounts');
        const list = typeof raw === 'string' ? JSON.parse(raw || '[]') : (raw || []);
        account = list.find((a) => a.id === b.accountId);
      }
      const r = await cfBypass.deployEdgePassWorker(account, b);
      if (broadcast) broadcast('core_log', `[CF-EdgePass] ورکر مستقر شد: ${r.workerUrl}`);
      res.json(r);
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/cf-bypass/start', async (req, res) => {
    try {
      const port = typeof getPort === 'function' ? getPort() : 0;
      if (port) cfBypass.setAppPort(port);
      const st = await cfBypass.start(req.body || null);
      if (broadcast) broadcast('cf_bypass', st);
      res.json({ ok: true, status: st });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/cf-bypass/stop', async (req, res) => {
    try {
      const st = await cfBypass.stop();
      if (broadcast) broadcast('cf_bypass', st);
      res.json({ ok: true, status: st });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/cf-bypass/probe', async (req, res) => {
    try {
      const r = await cfBypass.probeDomain((req.body || {}).domain);
      res.json({ ok: true, result: r });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.get('/api/cf-bypass/pac.js', (req, res) => {
    try {
      res.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(cfBypass.buildPacScript());
    } catch (e) { res.status(500).send('function FindProxyForURL(){return "DIRECT";}'); }
  });

  // ── Expanded Multi-Pool Server Aggregator ───────────────────────────────────
  app.get('/api/pools/catalog', (req, res) => {
    try { res.json({ ok: true, sources: multiPool.getCatalog() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/pools/fetch', async (req, res) => {
    try {
      const b = req.body || {};
      const r = await multiPool.fetchPool(b.sources || null, {
        force: !!b.force,
        limitPerSource: Number(b.limitPerSource) || 200,
        probeTcp: b.probeTcp !== false,
      });
      res.json(Object.assign({ ok: true }, r));
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Sovereign Extended Engines (Direct DPI, FLUX, MAE, Sing-box, Extended VPNs) ─
  app.get('/api/sovereign/status', (req, res) => {
    try {
      res.json({
        ok: true,
        directDpi: engines.getDirectDpiStatus(),
        singbox: engines.getSingBoxStatus(),
        flux: engines.getFluxStatus(),
        mae: engines.getMaeState(),
        extended: engines.getExtendedState(),
        meta: engines.EXTENDED_VPNS_META,
        logs: engines.getLogs(),
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sovereign/direct/start', async (req, res) => {
    try { res.json({ ok: true, status: await engines.startDirectDpi() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sovereign/direct/stop', async (req, res) => {
    try { res.json({ ok: true, status: await engines.stopDirectDpi() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sovereign/singbox/start', async (req, res) => {
    try {
      const b = req.body || {};
      res.json({ ok: true, status: await engines.startSingBoxProxy(b.uri, b.label) });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sovereign/singbox/stop', async (req, res) => {
    try { res.json({ ok: true, status: await engines.stopSingBoxProxy() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sovereign/flux/start', async (req, res) => {
    try { res.json({ ok: true, status: await engines.startFlux(req.body || {}) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sovereign/flux/stop', async (req, res) => {
    try { res.json({ ok: true, status: await engines.stopFlux() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sovereign/mae/save', (req, res) => {
    try { res.json({ ok: true, mae: engines.saveMaePolicy(req.body || {}) }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sovereign/extended/save', (req, res) => {
    try { res.json({ ok: true, extended: engines.mergeExtendedState(req.body || {}) }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  // ── Sovereign Cross-Device Sync ─────────────────────────────────────────────
  app.get('/api/sync/status', (req, res) => {
    try { res.json({ ok: true, config: syncMgr.getSyncConfig() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sync/export-uri', (req, res) => {
    try {
      const snap = syncMgr.exportSnapshot(storageManager);
      const uri = syncMgr.encryptBundle(snap, (req.body || {}).passphrase);
      res.json({ ok: true, uri, summary: { nodes: snap.v2rayNodes.length, accounts: snap.cloudAccounts.length, bypassDomains: (snap.cfBypass.customDomains || []).length } });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sync/import-uri', (req, res) => {
    try {
      const b = req.body || {};
      const snap = syncMgr.decryptBundle(b.uri, b.passphrase);
      const result = syncMgr.importSnapshot(snap, storageManager, { merge: b.merge !== false });
      res.json(result);
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sync/cloud/push', async (req, res) => {
    try {
      const b = req.body || {};
      res.json(await syncMgr.pushToCloudWorker(storageManager, b.passphrase, b));
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sync/cloud/pull', async (req, res) => {
    try {
      const b = req.body || {};
      res.json(await syncMgr.pullFromCloudWorker(storageManager, b.passphrase, b));
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sync/gist/push', async (req, res) => {
    try {
      const b = req.body || {};
      res.json(await syncMgr.pushToGithubGist(storageManager, b.passphrase, b));
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sync/gist/pull', async (req, res) => {
    try {
      const b = req.body || {};
      res.json(await syncMgr.pullFromGithubGist(storageManager, b.passphrase, b));
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/sync/lan/host', (req, res) => {
    try {
      const port = typeof getPort === 'function' ? getPort() : 35281;
      res.json(Object.assign({ ok: true }, syncMgr.createLanPairingCode(port)));
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/sync/lan/pull', (req, res) => {
    try {
      const { code, token, passphrase } = req.query || {};
      if (!syncMgr.verifyLanPairing(code, token)) {
        return res.status(401).json({ ok: false, error: 'کد یا توکن جفت‌سازی منقضی یا نامعتبر است.' });
      }
      const snap = syncMgr.exportSnapshot(storageManager);
      const uri = syncMgr.encryptBundle(snap, passphrase || String(code));
      res.json({ ok: true, uri });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
};
