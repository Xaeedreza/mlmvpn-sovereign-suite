'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUITE_ROOT = path.resolve(__dirname, '..');
const WIN_ROOT = path.join(SUITE_ROOT, 'windows');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name} -> ${err.message}`);
    failed++;
  }
}

(async () => {
  // 1. Verify shared/sync-spec.json & mlmsync://v1/ wire format compatibility
  await test('sync-spec.json matches PBKDF2-SHA256 + AES-256-GCM parameters', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(SUITE_ROOT, 'shared/sync-spec.json'), 'utf8'));
    assert.strictEqual(spec.version || spec.schemaVersion || 1, 1);
    const syncMgr = require(path.join(WIN_ROOT, 'sovereign-sync-manager.js'));
    assert.strictEqual(typeof syncMgr.encryptBundle, 'function');
    assert.strictEqual(typeof syncMgr.decryptBundle, 'function');

    const samplePayload = {
      schema: 1,
      platform: 'windows',
      accounts: [{ accountId: 'acc123', token: 'tok_abc', name: 'TestCF' }],
      cfBypass: { workerUrl: 'https://edge.test.workers.dev', customDomains: ['claude.ai', 'chatgpt.com'] },
    };
    const pass = 'SovereignPass#2026';
    const token = syncMgr.encryptBundle(samplePayload, pass);
    assert(token.startsWith('mlmsync://v1/'), 'Missing mlmsync://v1/ prefix');

    // Manual raw byte validation matching Android & iOS implementations
    const rawB64 = token.slice('mlmsync://v1/'.length);
    const buf = Buffer.from(rawB64, 'base64url');
    assert(buf.length > 16 + 12 + 16, 'Wire buffer too short');
    const salt = buf.subarray(0, 16);
    const iv = buf.subarray(16, 28);
    const ct = buf.subarray(28, buf.length - 16);
    const tag = buf.subarray(buf.length - 16);
    const key = crypto.pbkdf2Sync(pass, salt, 100000, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from('mlmvpn-sovereign-sync-v1', 'utf8'));
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(dec);
    assert.strictEqual(parsed.accounts[0].accountId, 'acc123');
    assert.strictEqual(parsed.cfBypass.workerUrl, 'https://edge.test.workers.dev');

    // Wrong passphrase must fail tag authentication
    assert.throws(() => syncMgr.decryptBundle(token, 'WrongPassphrase'));
    const roundtrip = syncMgr.decryptBundle(token, pass);
    assert.deepStrictEqual(roundtrip.cfBypass.customDomains, ['claude.ai', 'chatgpt.com']);
  });

  // 2. Verify Zero-VPN Cloudflare Bypass Manager (PAC + Domain normalization + Proxy)
  await test('cf-bypass-manager builds valid PAC & manages domains cleanly', async () => {
    const cfBypass = require(path.join(WIN_ROOT, 'cf-bypass-manager.js'));
    assert.strictEqual(typeof cfBypass.buildPacScript, 'function');
    assert.strictEqual(typeof cfBypass.getEffectiveDomains, 'function');
    assert(Array.isArray(cfBypass.PRESET_PACKS) && cfBypass.PRESET_PACKS.length >= 4, 'Missing PRESET_PACKS');

    const domains = cfBypass.getEffectiveDomains();
    assert(Array.isArray(domains) && domains.length > 0, 'Expected default effective domains');

    const pac = cfBypass.buildPacScript(['chatgpt.com', 'claude.ai'], 20822);
    assert(pac.includes('FindProxyForURL'), 'PAC missing FindProxyForURL');
    assert(pac.includes('127.0.0.1:20822'), 'PAC missing local Edge Pass proxy port');
    assert(pac.includes('.ir'), 'PAC should keep .ir direct');

    const status = cfBypass.getStatus();
    assert.strictEqual(typeof status.running, 'boolean');
    assert(Array.isArray(status.presets), 'Status presets should be an array');
    assert(status.presets.length >= 4, 'Expected at least 4 preset packs');
  });

  // 3. Verify Multi-Pool Aggregator config parser (VLESS/VMess/Trojan/SS/Hy2/TUIC)
  await test('multi-pool-aggregator parses multi-protocol URIs cleanly', () => {
    const mpa = require(path.join(WIN_ROOT, 'multi-pool-aggregator.js'));
    assert(Array.isArray(mpa.MULTI_SOURCES), 'MULTI_SOURCES missing');
    assert(mpa.MULTI_SOURCES.length >= 15, 'Expected >=15 aggregated sources');
    assert.strictEqual(typeof mpa.parseServerMeta, 'function');
    const vless = mpa.parseServerMeta('vless://11111111-1111-1111-1111-111111111111@104.16.1.1:443?type=ws&security=tls&sni=example.workers.dev#CFTest');
    assert(vless && vless.protocol === 'vless' && vless.host === '104.16.1.1' && vless.port === 443, 'Failed VLESS parse');
    const hy2 = mpa.parseServerMeta('hysteria2://pass@1.2.3.4:443?sni=hy2.example.com#Hy2Node');
    assert(hy2 && hy2.protocol === 'hysteria2' && hy2.host === '1.2.3.4' && hy2.port === 443, 'Failed Hysteria2 parse');
  });

  // 4. Verify Sovereign Engines Manager registry & status getters
  await test('sovereign-engines-manager exports extended engines registry', () => {
    const sem = require(path.join(WIN_ROOT, 'sovereign-engines-manager.js'));
    assert(Array.isArray(sem.EXTENDED_VPNS_META) && sem.EXTENDED_VPNS_META.length >= 10, 'Missing EXTENDED_VPNS_META');
    assert.strictEqual(typeof sem.getExtendedState, 'function');
    assert.strictEqual(typeof sem.getDirectDpiStatus, 'function');
    assert.strictEqual(typeof sem.getFluxStatus, 'function');
    const st = sem.getExtendedState();
    assert.strictEqual(typeof st, 'object');
  });

  // 5. Verify Cloudflare cf-edge-pass Worker syntax and Android/iOS copies match
  await test('cf-edge-pass worker matches across workers/, windows/, android/, ios/', () => {
    const wMain = fs.readFileSync(path.join(SUITE_ROOT, 'workers/cf-edge-pass/worker.js'), 'utf8');
    const wWin = fs.readFileSync(path.join(WIN_ROOT, 'public/cf_edge_pass_worker.js'), 'utf8');
    const wAnd = fs.readFileSync(path.join(SUITE_ROOT, 'android/app/src/main/assets/cf_edge_pass_worker.js'), 'utf8');
    const wIos = fs.readFileSync(path.join(SUITE_ROOT, 'ios/Resources/cf_edge_pass_worker.js'), 'utf8');
    assert.strictEqual(wMain, wWin, 'Windows copy differs from canonical worker.js');
    assert.strictEqual(wMain, wAnd, 'Android copy differs from canonical worker.js');
    assert.strictEqual(wMain, wIos, 'iOS copy differs from canonical worker.js');
    assert(wMain.includes('/sync/push') && wMain.includes('/sync/pull'), 'Worker missing sync endpoints');
    assert(wMain.includes('/_edge/') && wMain.includes('/dns-query'), 'Worker missing edge proxy/DoH');
  });

  // 6. Verify iOS critical files exist & are non-empty
  await test('iOS native SwiftUI + NetworkExtension project files present', () => {
    const required = [
      'ios/project.yml',
      'ios/Package.swift',
      'ios/scripts/build_libbox.sh',
      'ios/.github/workflows/build-ios.yml',
      'ios/MLMVPNApp/MLMVPNApp.swift',
      'ios/MLMVPNApp/HomeView.swift',
      'ios/MLMVPNApp/CfBypassView.swift',
      'ios/MLMVPNApp/EnginesHubView.swift',
      'ios/MLMVPNApp/CloudAndScannerViews.swift',
      'ios/MLMVPNApp/SovereignSyncView.swift',
      'ios/MLMVPNApp/SovereignTheme.swift',
      'ios/MLMVPNApp/SovereignCoordinator.swift',
      'ios/MLMVPNTunnel/PacketTunnelProvider.swift',
      'ios/Shared/SovereignModels.swift',
      'ios/Shared/SovereignCryptoSync.swift',
      'ios/Shared/SingBoxConfigBuilder.swift',
    ];
    for (const rel of required) {
      const p = path.join(SUITE_ROOT, rel);
      assert(fs.existsSync(p), `Missing iOS file: ${rel}`);
      assert(fs.statSync(p).size > 200, `Empty/stub iOS file: ${rel}`);
    }
  });

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
