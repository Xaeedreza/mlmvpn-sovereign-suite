// --- «موتورهای پیشرفته و استخر سرورها» (FLUX, MAE, Direct-DPI, Hysteria2/TUIC, Multi-Pool, Mami, Argo, URnetwork, FENIX, Proton, Windscribe) ---
// Renders into #ls-sovereign-hub. Talks to /api/sovereign/* and /api/pools/*.

(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const $ = (id) => document.getElementById(id);

  const st = {
    tab: 'engines', // 'engines' | 'pools' | 'singbox'
    data: null,
    catalog: [],
    servers: [],
    fetchingPools: false,
    connectingFlux: false,
    sbUri: '',
  };

  function ensureRoot() {
    let root = $('ls-sovereign-hub');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'ls-sovereign-hub';
    root.style.cssText = 'display:none; width:100%; height:100%; min-height:0; flex:1;';
    document.body.appendChild(root);
    return root;
  }

  async function api(url, opts) {
    const r = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'خطا');
    return j;
  }

  async function refresh() {
    try {
      const [s, c] = await Promise.all([api('/api/sovereign/status'), api('/api/pools/catalog')]);
      st.data = s;
      st.catalog = c.sources || [];
      render();
    } catch (e) {}
  }

  function render() {
    const root = ensureRoot();
    if (!root.dataset.built) {
      root.dataset.built = '1';
      root.innerHTML = `
<style id="shb-css">
  .shb-wrap { display:flex; height:100%; min-height:0; flex:1; }
  .shb-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(245px, 1fr)); gap:12px; }
  .shb-card { padding:14px; border-radius:16px; background:var(--mv-surface-2); border:1px solid var(--mv-sep);
              display:flex; flex-direction:column; gap:8px; transition:border-color 150ms ease; }
  .shb-card:hover { border-color:var(--mv-accent-ring); }
  .shb-card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .shb-badge { font-size:10.5px; padding:2px 8px; border-radius:999px; font-weight:700; background:var(--mv-fill-2); color:var(--mv-label-2); }
  .shb-badge.is-on { background:rgba(52,211,153,0.18); color:var(--mv-green-ink); }
  .shb-srv { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border-bottom:1px solid var(--mv-sep); }
  .shb-srv:last-child { border-bottom:0; }
</style>
<div dir="rtl" class="shb-wrap mv-split">
  <aside class="mv-side">
    <div class="mv-side-top"></div>
    <div class="mv-eng-ident">
      <span class="mv-side-tile" style="--tint:var(--mv-pink); width:54px; height:54px; border-radius:14px; font-size:26px">
        <i class="ph-fill ph-planet"></i>
      </span>
      <b>هاب موتورها و سرورها</b>
      <small>۱۴+ موتور و ۱۸ منبع سرور</small>
    </div>
    <nav class="mv-side-list">
      <div class="mv-side-group">
        <button type="button" class="mv-side-item" data-shb-tab="engines"><span class="mv-side-tile" style="--tint:var(--mv-orange)"><i class="ph-fill ph-cpu"></i></span><span>موتورهای هوشمند و VPNها</span></button>
        <button type="button" class="mv-side-item" data-shb-tab="pools"><span class="mv-side-tile" style="--tint:var(--mv-green)"><i class="ph-fill ph-globe"></i></span><span>استخر بزرگ سرورهای رایگان</span></button>
        <button type="button" class="mv-side-item" data-shb-tab="singbox"><span class="mv-side-tile" style="--tint:var(--mv-indigo)"><i class="ph-fill ph-lightning"></i></span><span>Hysteria2 / TUIC / WireGuard</span></button>
      </div>
    </nav>
  </aside>
  <section class="mv-pane">
    <header class="mv-pane-bar"><h1 class="mv-pane-title" id="shb-title">موتورهای هوشمند</h1></header>
    <div class="mv-pane-scroll custom-scrollbar" id="shb-body"></div>
  </section>
</div>`;
      root.querySelectorAll('[data-shb-tab]').forEach((b) => {
        b.onclick = () => { st.tab = b.dataset.shbTab; render(); };
      });
    }

    root.querySelectorAll('[data-shb-tab]').forEach((b) => b.classList.toggle('active', b.dataset.shbTab === st.tab));
    const body = $('shb-body');
    const d = st.data || { directDpi: {}, flux: {}, singbox: {}, meta: [], extended: {} };

    if (st.tab === 'engines') {
      $('shb-title').textContent = 'موتورهای هوشمند و VPNهای تکمیلی';
      const meta = d.meta || [];
      body.innerHTML = `
      <div class="mv-form">
        <div class="mv-form-section is-wide">
          <div class="sv-orb-card" style="margin-bottom:14px;">
            <div>
              <b style="font-size:15px;">اتصال سریع FLUX + موتور مستقیم ضد DPI (Shroudly)</b>
              <p style="margin:4px 0 0;font-size:12px;color:var(--mv-label-2);">FLUX بین بهترین منابع مسابقه‌داده و بهینه‌ترین مسیر را انتخاب می‌کند؛ Direct-DPI با تکه‌کردن SNI بدون سرور کار می‌کند.</p>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button type="button" class="sv-btn-warm" id="shb-flux-btn">${st.connectingFlux ? 'در حال مسابقه...' : (d.flux && d.flux.connected ? 'قطع FLUX' : 'شروع مسابقه FLUX')}</button>
              <button type="button" class="sv-btn-soft" id="shb-direct-btn">${d.directDpi && d.directDpi.running ? 'توقف Direct-DPI' : 'روشن‌کردن Direct-DPI (پورت ۲۰۸۲۴)'}</button>
            </div>
          </div>
          <div class="shb-grid">
            ${meta.map((m) => {
              const isFluxOn = m.id === 'flux' && d.flux && d.flux.connected;
              const isDirOn = m.id === 'direct_dpi' && d.directDpi && d.directDpi.running;
              const isExtOn = d.extended && d.extended[m.id] && (d.extended[m.id].connected || d.extended[m.id].active);
              const on = isFluxOn || isDirOn || isExtOn;
              return `<div class="shb-card">
                <div class="shb-card-head">
                  <b style="font-size:13.5px;">${esc(m.titleFa)}</b>
                  <span class="shb-badge ${on ? 'is-on' : ''}">${on ? 'فعال' : 'آماده'}</span>
                </div>
                <small style="font-size:11.5px;color:var(--mv-label-2);line-height:1.55;">${esc(m.desc)}</small>
                <div style="margin-top:auto;padding-top:6px;display:flex;gap:6px;">
                  <button type="button" class="sv-btn-soft" style="flex:1;height:30px;font-size:11.5px;" data-shb-action="${m.id}">${on ? 'مدیریت / قطع' : 'فعال‌سازی / تنظیم'}</button>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;

      $('shb-flux-btn').onclick = async () => {
        st.connectingFlux = true; render();
        try {
          if (d.flux && d.flux.connected) await api('/api/sovereign/flux/stop', { method: 'POST' });
          else await api('/api/sovereign/flux/start', { method: 'POST', body: JSON.stringify({}) });
        } catch (e) { if (window.toast) window.toast('❌ ' + e.message); }
        st.connectingFlux = false;
        await refresh();
      };
      $('shb-direct-btn').onclick = async () => {
        if (d.directDpi && d.directDpi.running) await api('/api/sovereign/direct/stop', { method: 'POST' });
        else await api('/api/sovereign/direct/start', { method: 'POST' });
        await refresh();
      };
      body.querySelectorAll('[data-shb-action]').forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.dataset.shbAction;
          if (id === 'flux') return $('shb-flux-btn').click();
          if (id === 'direct_dpi') return $('shb-direct-btn').click();
          if (id === 'amnezia' || id === 'outline') { st.tab = 'pools'; return render(); }
          const cur = (d.extended && d.extended[id]) || {};
          await api('/api/sovereign/extended/save', { method: 'POST', body: JSON.stringify({ [id]: { connected: !cur.connected } }) });
          await refresh();
        };
      });
    } else if (st.tab === 'pools') {
      $('shb-title').textContent = 'استخر ۱۸ منبع سرور تاییدشده (VLESS / REALITY / Hysteria2 / Outline / WG)';
      body.innerHTML = `
      <div class="mv-form">
        <div class="mv-form-section is-wide">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
            <span style="font-size:12.5px;color:var(--mv-label-2);">تمامی منابع از GitHub + آینه jsDelivr دریافت و با تست TCP روی خط شما پالایش می‌شوند.</span>
            <button type="button" class="sv-btn-warm" id="shb-fetch-pools" ${st.fetchingPools ? 'disabled' : ''}>${st.fetchingPools ? 'در حال دریافت و تست...' : 'دریافت و تست سرورهای جدید'}</button>
          </div>
          <div class="mv-form-group" style="max-height:460px;overflow:auto;">
            ${st.servers.length ? st.servers.slice(0, 120).map((s, idx) => `
              <div class="shb-srv">
                <div style="min-width:0;">
                  <b style="display:block;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(s.label)}</b>
                  <small dir="ltr" style="font-size:11px;color:var(--mv-label-3);font-family:var(--mv-font-tech);">${esc(s.protocol.toUpperCase())} · ${esc(s.host)}:${s.port} · ${s.tcpMs != null ? s.tcpMs + ' ms' : 'UDP/QUIC'}</small>
                </div>
                <div style="display:flex;gap:6px;flex:none;">
                  <button type="button" class="sv-btn-soft" style="height:28px;font-size:11px;" data-copy-srv="${idx}">کپی</button>
                  <button type="button" class="sv-btn-warm" style="height:28px;font-size:11px;" data-conn-srv="${idx}">اتصال</button>
                </div>
              </div>`).join('') : '<div style="padding:24px;text-align:center;color:var(--mv-label-3);">برای مشاهده و تست زنده سرورها، دکمه «دریافت و تست سرورهای جدید» را بزنید.</div>'}
          </div>
        </div>
      </div>`;

      $('shb-fetch-pools').onclick = async () => {
        st.fetchingPools = true; render();
        try {
          const r = await api('/api/pools/fetch', { method: 'POST', body: JSON.stringify({ probeTcp: true }) });
          st.servers = r.servers || [];
          if (window.toast) window.toast(`✅ ${st.servers.length} سرور سالم پیدا شد`);
        } catch (e) { if (window.toast) window.toast('❌ ' + e.message); }
        st.fetchingPools = false;
        render();
      };
      body.querySelectorAll('[data-copy-srv]').forEach((b) => {
        b.onclick = () => {
          const item = st.servers[Number(b.dataset.copySrv)];
          if (item && navigator.clipboard) {
            navigator.clipboard.writeText(item.uri);
            if (window.toast) window.toast('✅ لینک سرور کپی شد');
          }
        };
      });
      body.querySelectorAll('[data-conn-srv]').forEach((b) => {
        b.onclick = async () => {
          const item = st.servers[Number(b.dataset.connSrv)];
          if (!item) return;
          try {
            if (['hysteria2', 'tuic', 'wireguard', 'anytls'].includes(item.protocol)) {
              await api('/api/sovereign/singbox/start', { method: 'POST', body: JSON.stringify({ uri: item.uri, label: item.label }) });
              if (window.toast) window.toast('✅ متصل شد روی sing-box: 127.0.0.1:20825');
            } else {
              await api('/api/v2ray/start', { method: 'POST', body: JSON.stringify({ uri: item.uri, useSystemProxy: true }) });
              if (window.toast) window.toast('✅ متصل شد: ' + item.label);
            }
          } catch (e) { if (window.toast) window.toast('❌ ' + e.message); }
        };
      });
    } else if (st.tab === 'singbox') {
      const sb = d.singbox || {};
      $('shb-title').textContent = 'اجرای مستقیم Hysteria2 / TUIC v5 / AnyTLS / WireGuard';
      body.innerHTML = `
      <div class="mv-form">
        <div class="mv-form-section is-wide">
          <div class="mv-form-group">
            <div class="mv-form-row" style="flex-direction:column;align-items:stretch;gap:10px;">
              <label style="font-size:12.5px;">لینک کانفیگ (hysteria2://, hy2://, tuic://, anytls://, wireguard://)</label>
              <input id="shb-sb-uri" dir="ltr" value="${esc(st.sbUri || sb.activeUri || '')}" placeholder="hysteria2://password@host:443?sni=..." style="height:36px;border-radius:10px;padding:0 12px;background:var(--mv-field);border:1px solid var(--mv-sep);color:var(--mv-label);font-family:var(--mv-font-tech);" />
              <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button type="button" class="sv-btn-soft" id="shb-sb-stop" ${!sb.running ? 'disabled' : ''}>قطع اتصال</button>
                <button type="button" class="sv-btn-warm" id="shb-sb-start">اتصال با هسته sing-box</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
      $('shb-sb-start').onclick = async () => {
        st.sbUri = $('shb-sb-uri').value.trim();
        try {
          await api('/api/sovereign/singbox/start', { method: 'POST', body: JSON.stringify({ uri: st.sbUri }) });
          if (window.toast) window.toast('✅ متصل شد (پورت ۲۰۸۲۵)');
        } catch (e) { if (window.toast) window.toast('❌ ' + e.message); }
        await refresh();
      };
      $('shb-sb-stop').onclick = async () => {
        await api('/api/sovereign/singbox/stop', { method: 'POST' });
        await refresh();
      };
    }
  }

  window.MVProbe = window.MVProbe || {};
  window.MVProbe.flux = () => !!(st.data && st.data.flux && st.data.flux.connected);
  window.MVProbe.directDpi = () => !!(st.data && st.data.directDpi && st.data.directDpi.running);
  window.refreshSovereignHub = refresh;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { ensureRoot(); refresh(); });
  else { ensureRoot(); refresh(); }
})();
