/**
 * MLMVPN Sovereign — Zero-VPN Cloudflare Edge Pass Worker (v1.0.0)
 *
 * All-in-one lightweight edge worker (zero D1 required; optional KV `SYNC_KV`):
 *  1. VLESS over WebSocket (+ sec-websocket-protocol early-data + ProxyIP fallback
 *     for Cloudflare-fronted destinations like ChatGPT/OpenAI)
 *  2. Encrypted Reverse-Proxy Edge Gateway (`/_edge/<scheme>/<host>/...` & `/proxy?url=...`)
 *     for browser/API sanction bypass without turning on a full VPN
 *  3. Encrypted DoH & ECS DNS Resolver (`/dns-query` RFC 8484 + `/resolve?domain=...`)
 *  4. Encrypted Cross-Device Sovereign Sync Vault (`/sync/push`, `/sync/pull`) using `SYNC_KV`
 *  5. Health & Egress Probe (`/_health`, `/_egress`) + Neutral Decoy Camouflage at `/`
 *
 * Environment Variables / Bindings:
 *  - UUID (secret/text): VLESS UUID (auto-generated on deploy)
 *  - PASS_KEY (secret/text): Access token for /proxy, /_edge, and /sync endpoints
 *  - PROXY_IP (optional): Fallback relay host[:port] when CF-to-CF direct socket fails
 *  - DEFAULT_REGION (optional): ECS region code (AE, US, DE, TR, SG, IN)
 *  - SYNC_KV (optional KV namespace): Cross-device encrypted vault storage
 */

import { connect } from 'cloudflare:sockets';

const WORKER_APP = 'mlmvpn-cf-edge-pass';
const WORKER_VERSION = 1;
const DEFAULT_PROXY_IP = ['pro', 'xy', 'ip.', 'cmli', 'ussss', '.net'].join('');

const ECS_REGIONS = {
  AE: { subnet: '94.200.0.0', prefix: 24 },
  TR: { subnet: '78.160.0.0', prefix: 24 },
  DE: { subnet: '85.214.0.0', prefix: 24 },
  SG: { subnet: '103.28.54.0', prefix: 24 },
  IN: { subnet: '103.21.244.0', prefix: 24 },
  US: { subnet: '23.239.0.0', prefix: 24 },
};

const DOH_UPSTREAMS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/dns-query',
  'https://dns.quad9.net/dns-query',
];

const DECOY_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Edge Static CDN Node</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f1115;color:#cfd6e4;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:460px;padding:32px;border:1px solid #222834;border-radius:14px;background:#151922}h1{margin:0 0 8px;font-size:18px;color:#fff}p{margin:0;font-size:14px;line-height:1.6;color:#93a0b8}</style></head><body><main><h1>Edge Delivery Gateway</h1><p>Status: Operational · Cache Node Ready</p></main></body></html>`;

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();

      // 1. VLESS WebSocket tunnel (triggered by Upgrade: websocket)
      if (upgrade === 'websocket') {
        const wsTarget = url.searchParams.get('ws_target');
        if (wsTarget && verifyAuth(request, url, env)) {
          return await handleWebSocketRelay(request, wsTarget);
        }
        return await handleVlessWebSocket(request, url, env);
      }

      // 2. Health & Egress diagnostics
      if (path === '/_health') {
        return json({
          ok: true,
          app: WORKER_APP,
          version: WORKER_VERSION,
          hasSyncKv: !!(env && env.SYNC_KV),
          hasUuid: !!(env && env.UUID),
          colo: (request.cf && request.cf.colo) || 'unknown',
          country: (request.cf && request.cf.country) || 'unknown',
        });
      }

      if (path === '/_egress') {
        if (!verifyAuth(request, url, env)) return json({ ok: false, error: 'unauthorized' }, 401);
        return await handleEgressProbe(request);
      }

      // 3. Encrypted DoH & ECS DNS resolver
      if (path === '/dns-query') {
        return await handleDoh(request, url, env);
      }
      if (path === '/resolve') {
        return await handleResolveJson(url, env);
      }

      // 4. Cross-Device Sovereign Vault Sync (client-encrypted ciphertext only)
      if (path === '/sync/push' || path === '/sync/pull') {
        if (!verifyAuth(request, url, env)) return json({ ok: false, error: 'unauthorized' }, 401);
        return await handleVaultSync(request, url, env, path);
      }

      // 5. Reverse-Proxy Edge Gateway (/proxy?url=... or /_edge/https/example.com/...)
      if (path === '/proxy' || path.startsWith('/_edge/')) {
        if (!verifyAuth(request, url, env)) return new Response('Unauthorized', { status: 401 });
        return await handleEdgeProxy(request, url);
      }

      // 6. CORS preflight for web clients
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      // 7. Neutral decoy page on all unrecognized routes
      return new Response(DECOY_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
      });
    } catch (err) {
      return new Response('Service Unavailable', { status: 503 });
    }
  },
};

function corsHeaders(extra = {}) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': '*',
  }, extra);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }),
  });
}

function timingSafeEqualStr(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (!sa || sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

function verifyAuth(request, url, env) {
  const secret = (env && env.PASS_KEY) ? String(env.PASS_KEY) : '';
  if (!secret) return true; // Open if user explicitly deployed without PASS_KEY
  const hdr = request.headers.get('X-Edge-Key')
    || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const qp = url.searchParams.get('key');
  const cookieMatch = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)edge_key=([^;]+)/);
  const ck = cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
  return timingSafeEqualStr(hdr, secret) || timingSafeEqualStr(qp, secret) || timingSafeEqualStr(ck, secret);
}

// ── Egress Check ──────────────────────────────────────────────────────────────
async function handleEgressProbe(request) {
  try {
    const r = await fetch('https://cloudflare.com/cdn-cgi/trace', { cf: { cacheTtl: 0 } });
    const text = await r.text();
    const map = {};
    for (const line of text.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) map[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return json({
      ok: true,
      edgeColo: (request.cf && request.cf.colo) || map.colo || '',
      egressIp: map.ip || '',
      country: map.loc || (request.cf && request.cf.country) || '',
    });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 502);
  }
}

// ── Cross-Device Encrypted Vault Sync ─────────────────────────────────────────
async function handleVaultSync(request, url, env, path) {
  if (!env || !env.SYNC_KV) {
    return json({ ok: false, error: 'SYNC_KV binding is not configured on this worker' }, 501);
  }
  const slot = String(url.searchParams.get('slot') || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'default';
  const key = 'vault:' + slot;

  if (path === '/sync/push' && request.method === 'POST') {
    const body = await request.text();
    if (!body || body.length > 512 * 1024) {
      return json({ ok: false, error: 'invalid payload size (max 512KB)' }, 400);
    }
    const record = JSON.stringify({ payload: body, updatedAt: Date.now() });
    await env.SYNC_KV.put(key, record);
    return json({ ok: true, slot, updatedAt: Date.now(), bytes: body.length });
  }

  if (path === '/sync/pull') {
    const raw = await env.SYNC_KV.get(key);
    if (!raw) return json({ ok: false, error: 'empty slot' }, 404);
    try {
      const parsed = JSON.parse(raw);
      return json({ ok: true, slot, payload: parsed.payload, updatedAt: parsed.updatedAt });
    } catch (e) {
      return json({ ok: true, slot, payload: raw, updatedAt: 0 });
    }
  }
  return json({ ok: false, error: 'method not allowed' }, 405);
}

// ── Reverse-Proxy Edge Gateway ────────────────────────────────────────────────
async function handleEdgeProxy(request, url) {
  let targetStr = '';
  let prefixBase = '';

  if (url.pathname === '/proxy') {
    targetStr = url.searchParams.get('url') || '';
  } else if (url.pathname.startsWith('/_edge/')) {
    const rest = url.pathname.slice('/_edge/'.length);
    const parts = rest.split('/');
    const scheme = (parts[0] === 'http' || parts[0] === 'https') ? parts[0] : 'https';
    const host = parts[1] || '';
    if (!host) return new Response('Missing target host', { status: 400 });
    const targetPath = '/' + parts.slice(2).join('/');
    targetStr = `${scheme}://${host}${targetPath}${url.search}`;
    prefixBase = `${url.origin}/_edge/${scheme}/${host}`;
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetStr);
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return new Response('Unsupported protocol', { status: 400 });
    }
  } catch (e) {
    return new Response('Invalid target URL', { status: 400 });
  }

  const outHeaders = new Headers(request.headers);
  for (const h of ['host', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip', 'x-edge-key']) {
    outHeaders.delete(h);
  }
  outHeaders.set('Host', targetUrl.host);
  if (!outHeaders.has('User-Agent')) {
    outHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  }

  const fetchOpts = {
    method: request.method,
    headers: outHeaders,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
    fetchOpts.body = request.body;
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), fetchOpts);
  } catch (e) {
    return json({ ok: false, error: 'Upstream fetch failed: ' + (e && e.message || e) }, 502);
  }

  const respHeaders = new Headers(upstream.headers);
  respHeaders.set('Access-Control-Allow-Origin', '*');
  respHeaders.set('Access-Control-Allow-Headers', '*');
  respHeaders.delete('content-security-policy');
  respHeaders.delete('content-security-policy-report-only');
  respHeaders.delete('x-frame-options');

  const keyParam = url.searchParams.get('key');
  if (keyParam) {
    respHeaders.append('Set-Cookie', `edge_key=${encodeURIComponent(keyParam)}; Path=/; HttpOnly; Secure; SameSite=Lax`);
  }

  const loc = respHeaders.get('location');
  if (loc && prefixBase) {
    try {
      const resolved = new URL(loc, targetUrl);
      const sch = resolved.protocol.replace(':', '');
      respHeaders.set('location', `${url.origin}/_edge/${sch}/${resolved.host}${resolved.pathname}${resolved.search}`);
    } catch (e) { /* keep original */ }
  }

  const ct = (respHeaders.get('content-type') || '').toLowerCase();
  if (prefixBase && ct.includes('text/html')) {
    let html = await upstream.text();
    const baseTag = `<base href="${prefixBase}/">`;
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => m + baseTag);
    } else {
      html = baseTag + html;
    }
    respHeaders.delete('content-length');
    return new Response(html, { status: upstream.status, headers: respHeaders });
  }

  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

async function handleWebSocketRelay(request, wsTarget) {
  let targetUrl;
  try {
    targetUrl = new URL(wsTarget);
  } catch (e) {
    return new Response('Invalid ws_target', { status: 400 });
  }
  const resp = await fetch(targetUrl.toString(), { headers: request.headers });
  return resp;
}

// ── Encrypted DoH & ECS Resolver ──────────────────────────────────────────────
async function handleDoh(request, url, env) {
  const regionCode = (url.searchParams.get('region') || (env && env.DEFAULT_REGION) || '').toUpperCase();
  const region = ECS_REGIONS[regionCode] || null;
  let dnsBytes = null;

  if (request.method === 'POST') {
    dnsBytes = new Uint8Array(await request.arrayBuffer());
  } else if (request.method === 'GET') {
    const p = url.searchParams.get('dns');
    if (!p) return new Response('missing dns param', { status: 400 });
    dnsBytes = base64UrlToBytes(p);
  } else {
    return new Response('method not allowed', { status: 405 });
  }

  if (region) {
    const domain = extractQuestionDomain(dnsBytes);
    if (domain) dnsBytes = buildEcsQuery(domain, region);
  }

  const upstreamUrl = region ? 'https://dns.google/dns-query' : DOH_UPSTREAMS[0];
  for (const target of (region ? [upstreamUrl] : DOH_UPSTREAMS)) {
    try {
      const r = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/dns-message', Accept: 'application/dns-message' },
        body: dnsBytes,
      });
      if (r.ok) {
        return new Response(await r.arrayBuffer(), {
          status: 200,
          headers: { 'Content-Type': 'application/dns-message', 'Cache-Control': 'public, max-age=60' },
        });
      }
    } catch (e) { /* try next resolver */ }
  }
  return new Response('DNS upstream failure', { status: 502 });
}

async function handleResolveJson(url, env) {
  const domain = (url.searchParams.get('domain') || '').trim().toLowerCase();
  if (!domain || !/^[a-z0-9.-]+$/.test(domain)) return json({ Answer: [], error: 'invalid domain' }, 400);
  const regionCode = (url.searchParams.get('region') || (env && env.DEFAULT_REGION) || '').toUpperCase();
  const region = ECS_REGIONS[regionCode] || null;

  if (region) {
    const q = buildEcsQuery(domain, region);
    const r = await fetch('https://dns.google/dns-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/dns-message', Accept: 'application/dns-message' },
      body: q,
    });
    if (!r.ok) return json({ Answer: [], error: 'upstream ' + r.status }, 502);
    const ips = parseDnsARecords(new Uint8Array(await r.arrayBuffer()));
    return json({ Answer: ips.map((ip) => ({ type: 1, data: ip })), region: regionCode });
  }

  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`, {
    headers: { Accept: 'application/dns-json' },
  });
  if (!r.ok) return json({ Answer: [], error: 'upstream ' + r.status }, 502);
  const data = await r.json();
  return json({ Answer: (data && data.Answer) || [] });
}

// ── VLESS over WebSocket (with ProxyIP fallback for CF-to-CF destinations) ────
async function handleVlessWebSocket(request, url, env) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  const expectedUuid = String((env && env.UUID) || '').replace(/-/g, '').toLowerCase();
  const proxyIpParam = url.searchParams.get('proxyip') || (env && env.PROXY_IP) || DEFAULT_PROXY_IP;

  let remoteSocket = null;
  let isDnsMode = false;
  let dnsWriter = null;
  let headerDone = false;

  const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
  const { readable, writable } = new TransformStream();

  // Pump incoming WebSocket frames (plus early data) into VLESS parser / remote socket
  const stream = makeReadableWsStream(server, earlyDataHeader);
  stream.pipeTo(new WritableStream({
    async write(chunk) {
      if (isDnsMode && dnsWriter) {
        await dnsWriter(chunk);
        return;
      }
      if (remoteSocket) {
        const w = remoteSocket.writable.getWriter();
        await w.write(chunk);
        w.releaseLock();
        return;
      }
      if (headerDone) return;

      const parsed = parseVlessHeader(chunk, expectedUuid);
      if (parsed.hasError) {
        throw new Error(parsed.message);
      }
      headerDone = true;

      const vlessRespHeader = new Uint8Array([parsed.version, 0]);
      const payload = chunk.slice(parsed.rawDataIndex);

      if (parsed.isUDP) {
        if (parsed.portRemote === 53) {
          isDnsMode = true;
          dnsWriter = createUdpDnsBridge(server, vlessRespHeader);
          if (payload.byteLength > 0) await dnsWriter(payload);
          return;
        }
        throw new Error('UDP only supported on port 53');
      }

      remoteSocket = await openTcpWithFallback(parsed.addressRemote, parsed.portRemote, proxyIpParam);
      if (payload.byteLength > 0) {
        const w = remoteSocket.writable.getWriter();
        await w.write(payload);
        w.releaseLock();
      }
      pipeRemoteToWs(remoteSocket, server, vlessRespHeader, parsed.addressRemote, parsed.portRemote, proxyIpParam);
    },
    close() {
      try { remoteSocket && remoteSocket.close(); } catch (e) { }
    },
    abort() {
      try { remoteSocket && remoteSocket.close(); } catch (e) { }
    },
  })).catch(() => {
    closeWsQuiet(server);
  });

  void readable; void writable;
  return new Response(null, { status: 101, webSocket: client });
}

function makeReadableWsStream(server, earlyDataHeader) {
  let cancelled = false;
  return new ReadableStream({
    start(controller) {
      server.addEventListener('message', (ev) => {
        if (cancelled) return;
        const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : new TextEncoder().encode(String(ev.data));
        controller.enqueue(data);
      });
      server.addEventListener('close', () => {
        if (!cancelled) {
          cancelled = true;
          try { controller.close(); } catch (e) { }
        }
      });
      server.addEventListener('error', (err) => controller.error(err));
      if (earlyDataHeader) {
        try {
          const decoded = base64UrlToBytes(earlyDataHeader);
          if (decoded.byteLength > 0) controller.enqueue(decoded);
        } catch (e) { /* ignore malformed early data */ }
      }
    },
    cancel() {
      cancelled = true;
      closeWsQuiet(server);
    },
  });
}

async function openTcpWithFallback(host, port, proxyIpSpec) {
  try {
    const sock = connect({ hostname: host, port });
    await sock.opened;
    return sock;
  } catch (err) {
    if (!proxyIpSpec) throw err;
    const [pHost, pPortStr] = String(proxyIpSpec).split(':');
    const pPort = parseInt(pPortStr, 10) || port;
    const sock = connect({ hostname: pHost.trim(), port: pPort });
    await sock.opened;
    return sock;
  }
}

async function pipeRemoteToWs(remoteSocket, ws, respHeader, host, port, proxyIpSpec) {
  let sentHeader = false;
  let hasData = false;
  try {
    await remoteSocket.readable.pipeTo(new WritableStream({
      write(chunk) {
        hasData = true;
        if (ws.readyState !== 1) return;
        if (!sentHeader) {
          sentHeader = true;
          const out = new Uint8Array(respHeader.length + chunk.byteLength);
          out.set(respHeader, 0);
          out.set(new Uint8Array(chunk), respHeader.length);
          ws.send(out);
        } else {
          ws.send(chunk);
        }
      },
    }));
  } catch (e) { /* closed */ }

  // If CF direct connect closed before sending any byte (e.g. CF-to-CF restriction), retry via ProxyIP
  if (!hasData && proxyIpSpec) {
    try {
      const [pHost, pPortStr] = String(proxyIpSpec).split(':');
      const fallback = connect({ hostname: pHost.trim(), port: parseInt(pPortStr, 10) || port });
      await fallback.opened;
      await fallback.readable.pipeTo(new WritableStream({
        write(chunk) {
          if (ws.readyState !== 1) return;
          if (!sentHeader) {
            sentHeader = true;
            const out = new Uint8Array(respHeader.length + chunk.byteLength);
            out.set(respHeader, 0);
            out.set(new Uint8Array(chunk), respHeader.length);
            ws.send(out);
          } else {
            ws.send(chunk);
          }
        },
      }));
    } catch (e2) { /* fallback also closed */ }
  }
  closeWsQuiet(ws);
}

function createUdpDnsBridge(ws, vlessRespHeader) {
  let sentHeader = false;
  let buf = new Uint8Array(0);
  return async (chunk) => {
    const merged = new Uint8Array(buf.length + chunk.byteLength);
    merged.set(buf, 0);
    merged.set(new Uint8Array(chunk), buf.length);
    buf = merged;
    while (buf.length >= 2) {
      const len = (buf[0] << 8) | buf[1];
      if (buf.length < 2 + len) break;
      const query = buf.slice(2, 2 + len);
      buf = buf.slice(2 + len);
      try {
        const r = await fetch('https://cloudflare-dns.com/dns-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/dns-message' },
          body: query,
        });
        if (r.ok && ws.readyState === 1) {
          const ans = new Uint8Array(await r.arrayBuffer());
          const frame = new Uint8Array((sentHeader ? 0 : vlessRespHeader.length) + 2 + ans.length);
          let off = 0;
          if (!sentHeader) {
            frame.set(vlessRespHeader, 0);
            off = vlessRespHeader.length;
            sentHeader = true;
          }
          frame[off] = (ans.length >> 8) & 0xff;
          frame[off + 1] = ans.length & 0xff;
          frame.set(ans, off + 2);
          ws.send(frame);
        }
      } catch (e) { /* ignore single DNS error */ }
    }
  };
}

function parseVlessHeader(buf, expectedUuidHex) {
  const view = new Uint8Array(buf);
  if (view.length < 24) return { hasError: true, message: 'header too short' };
  const version = view[0];
  let uuidHex = '';
  for (let i = 1; i <= 16; i++) uuidHex += view[i].toString(16).padStart(2, '0');
  if (expectedUuidHex && uuidHex !== expectedUuidHex) {
    return { hasError: true, message: 'invalid uuid' };
  }
  const optLen = view[17];
  const cmdIdx = 18 + optLen;
  if (cmdIdx + 4 > view.length) return { hasError: true, message: 'truncated command' };
  const cmd = view[cmdIdx];
  if (cmd !== 1 && cmd !== 2) return { hasError: true, message: 'unsupported command ' + cmd };
  const isUDP = cmd === 2;
  const portRemote = (view[cmdIdx + 1] << 8) | view[cmdIdx + 2];
  const addrType = view[cmdIdx + 3];
  let addrIdx = cmdIdx + 4;
  let addressRemote = '';

  if (addrType === 1) {
    if (addrIdx + 4 > view.length) return { hasError: true, message: 'truncated ipv4' };
    addressRemote = `${view[addrIdx]}.${view[addrIdx + 1]}.${view[addrIdx + 2]}.${view[addrIdx + 3]}`;
    addrIdx += 4;
  } else if (addrType === 2) {
    const len = view[addrIdx++];
    if (addrIdx + len > view.length) return { hasError: true, message: 'truncated domain' };
    addressRemote = new TextDecoder().decode(view.slice(addrIdx, addrIdx + len));
    addrIdx += len;
  } else if (addrType === 3) {
    if (addrIdx + 16 > view.length) return { hasError: true, message: 'truncated ipv6' };
    const segs = [];
    for (let i = 0; i < 16; i += 2) segs.push(((view[addrIdx + i] << 8) | view[addrIdx + i + 1]).toString(16));
    addressRemote = segs.join(':');
    addrIdx += 16;
  } else {
    return { hasError: true, message: 'unknown address type ' + addrType };
  }
  return { hasError: false, version, isUDP, addressRemote, portRemote, rawDataIndex: addrIdx };
}

function closeWsQuiet(ws) {
  try { if (ws.readyState === 1 || ws.readyState === 2) ws.close(); } catch (e) { }
}

function base64UrlToBytes(str) {
  const norm = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? norm : norm + '='.repeat(4 - (norm.length % 4));
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function extractQuestionDomain(bytes) {
  if (!bytes || bytes.length < 13) return '';
  let off = 12;
  const labels = [];
  while (off < bytes.length) {
    const len = bytes[off++];
    if (len === 0) break;
    if (len > 63 || off + len > bytes.length) return '';
    labels.push(new TextDecoder().decode(bytes.slice(off, off + len)));
    off += len;
  }
  return labels.join('.').toLowerCase();
}

function buildEcsQuery(domain, region) {
  const bytes = [((Math.random() * 0xffff) >> 8) & 0xff, (Math.random() * 0xffff) & 0xff, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01];
  for (const label of domain.split('.')) {
    if (!label) continue;
    const enc = new TextEncoder().encode(label);
    bytes.push(enc.length, ...enc);
  }
  bytes.push(0x00, 0x00, 0x01, 0x00, 0x01);
  const ip = region.subnet.split('.').map((n) => parseInt(n, 10) & 0xff);
  const addrLen = Math.ceil(region.prefix / 8);
  const optData = [0x00, 0x01, region.prefix & 0xff, 0x00, ...ip.slice(0, addrLen)];
  const rdata = [0x00, 0x08, (optData.length >> 8) & 0xff, optData.length & 0xff, ...optData];
  bytes.push(0x00, 0x00, 0x29, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, (rdata.length >> 8) & 0xff, rdata.length & 0xff, ...rdata);
  return new Uint8Array(bytes);
}

function parseDnsARecords(bytes) {
  if (!bytes || bytes.length < 12) return [];
  const qd = (bytes[4] << 8) | bytes[5];
  const an = (bytes[6] << 8) | bytes[7];
  let off = 12;
  const skipName = () => {
    while (off < bytes.length) {
      const l = bytes[off];
      if ((l & 0xc0) === 0xc0) { off += 2; return; }
      off++;
      if (l === 0) return;
      off += l;
    }
  };
  for (let i = 0; i < qd && off < bytes.length; i++) { skipName(); off += 4; }
  const out = [];
  for (let i = 0; i < an && off + 12 <= bytes.length; i++) {
    skipName();
    const type = (bytes[off] << 8) | bytes[off + 1];
    const rdLen = (bytes[off + 8] << 8) | bytes[off + 9];
    off += 10;
    if (type === 1 && rdLen === 4 && off + 4 <= bytes.length) {
      out.push(`${bytes[off]}.${bytes[off + 1]}.${bytes[off + 2]}.${bytes[off + 3]}`);
    }
    off += rdLen;
  }
  return out;
}
