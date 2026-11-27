// --- «همگام‌سازی یکپارچه دستگاه‌ها» (Windows <-> Android <-> iOS <-> CF KV <-> GitHub Gist) ---
// Renders into #ls-sovereign-sync. Talks to /api/sync/*.

(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const $ = (id) => document.getElementById(id);

  const st = { exportedUri: '', lanInfo: null, syncCfg: {} };

  function ensureRoot() {
    let root = $('ls-sovereign-sync');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'ls-sovereign-sync';
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
      const r = await api('/api/sync/status');
      st.syncCfg = r.config || {};
      render();
    } catch (e) {}
  }

  function render() {
    const root = ensureRoot();
    if (!root.dataset.built) {
      root.dataset.built = '1';
      root.innerHTML = `
<div dir="rtl" class="mv-split" style="flex:1;height:100%;min-height:0;">
  <aside class="mv-side">
    <div class="mv-side-top"></div>
    <div class="mv-eng-ident">
      <span class="mv-side-tile" style="--tint:var(--mv-teal); width:54px; height:54px; border-radius:14px; font-size:26px">
        <i class="ph-fill ph-arrows-clockwise"></i>
      </span>
      <b>همگام‌سازی یکپارچه</b>
      <small>ویندوز · اندروید · iOS</small>
    </div>
  </aside>
  <section class="mv-pane">
    <header class="mv-pane-bar"><h1 class="mv-pane-title">همگام‌سازی رمزنگاری‌شده بین ویندوز، اندروید و آیفون</h1></header>
    <div class="mv-pane-scroll custom-scrollbar" id="ssy-body"></div>
  </section>
</div>`;
    }

    const body = $('ssy-body');
    if (!body) return;
    body.innerHTML = `
    <div class="mv-form">
      <div class="mv-form-section is-wide">
        <div class="mv-form-header">رمز عبور مشترک همگام‌سازی (AES-256-GCM)</div>
        <div class="mv-form-group">
          <div class="mv-form-row">
            <span class="mv-form-label">عبارت عبور برای رمزنگاری/رمزگشایی</span>
            <input id="ssy-pass" type="password" dir="ltr" placeholder="حداقل ۴ کاراکتر" style="width:240px;height:32px;padding:0 10px;border-radius:8px;background:var(--mv-field);border:1px solid var(--mv-sep);color:var(--mv-label);" />
          </div>
          <div class="mv-form-row">
            <span class="mv-form-label">خروجی بسته یکپارچه (mlmsync://v1)<small>شامل اکانت‌های کلودفلر، ورکرها، نودها، آی‌پی‌های تمیز و تنظیمات سپر کلودفلر</small></span>
            <div style="display:flex;gap:8px;">
              <button type="button" class="sv-btn-warm" id="ssy-export-btn">ساخت لینک و QR کد</button>
              <button type="button" class="sv-btn-soft" id="ssy-lan-btn">اتصال مستقیم وای‌فای (LAN)</button>
            </div>
          </div>
          ${st.exportedUri ? `
          <div class="mv-form-row" style="flex-direction:column;align-items:stretch;gap:8px;">
            <textarea id="ssy-uri-out" dir="ltr" readonly rows="3" style="width:100%;padding:8px;border-radius:8px;background:var(--mv-field);border:1px solid var(--mv-sep);color:var(--mv-label);font-family:var(--mv-font-mono);font-size:11px;">${esc(st.exportedUri)}</textarea>
            <div id="ssy-qr" style="display:flex;justify-content:center;padding:8px;background:#fff;border-radius:12px;width:fit-content;margin:auto;"></div>
          </div>` : ''}
          ${st.lanInfo ? `
          <div class="mv-form-row" style="flex-direction:column;align-items:flex-start;gap:4px;">
            <b>کد جفت‌سازی وای‌فای (۱۰ دقیقه معتبر): <span dir="ltr" style="color:var(--mv-orange-ink);">${esc(st.lanInfo.code)}</span></b>
            <small dir="ltr" style="color:var(--mv-label-2);">${esc((st.lanInfo.lanUrls || []).join(' | '))}</small>
          </div>` : ''}
        </div>
      </div>

      <div class="mv-form-section is-wide">
        <div class="mv-form-header">ورود بسته از گوشی (اندروید / آیفون)</div>
        <div class="mv-form-group">
          <div class="mv-form-row" style="flex-direction:column;align-items:stretch;gap:8px;">
            <textarea id="ssy-uri-in" dir="ltr" rows="2" placeholder="mlmsync://v1/..." style="width:100%;padding:8px;border-radius:8px;background:var(--mv-field);border:1px solid var(--mv-sep);color:var(--mv-label);font-family:var(--mv-font-mono);font-size:11px;"></textarea>
            <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;">
              <button type="button" class="sv-btn-soft" id="ssy-cf-push">ذخیره در KV کلودفلر</button>
              <button type="button" class="sv-btn-soft" id="ssy-cf-pull">دریافت از KV کلودفلر</button>
              <button type="button" class="sv-btn-warm" id="ssy-import-btn">اعمال بسته در ویندوز</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

    if (st.exportedUri && typeof window.QRCode === 'function') {
      try {
        const qEl = $('ssy-qr');
        qEl.innerHTML = '';
        if (st.exportedUri.length < 1800) new window.QRCode(qEl, { text: st.exportedUri, width: 164, height: 164 });
        else qEl.innerHTML = '<span style="color:#111;font-size:11px;padding:8px;">حجم بسته بیش از ظرفیت QR است؛ از دکمه کپی یا KV کلودفلر استفاده کنید.</span>';
      } catch (e) {}
    }

    $('ssy-export-btn').onclick = async () => {
      try {
        const r = await api('/api/sync/export-uri', { method: 'POST', body: JSON.stringify({ passphrase: $('ssy-pass').value }) });
        st.exportedUri = r.uri;
        if (navigator.clipboard) navigator.clipboard.writeText(r.uri).catch(() => {});
        if (window.toast) window.toast('✅ لینک رمزنگاری‌شده ساخته و کپی شد');
        render();
      } catch (e) { if (window.toast) window.toast('❌ ' + e.message); }
    };
    $('ssy-lan-btn').onclick = async () => {
      try {
        st.lanInfo = await api('/api/sync/lan/host', { method: 'POST' });
        render();
      } catch (e) { if (window.toast) window.toast('❌ ' + e.message); }
    };
    $('ssy-import-btn').onclick = async () => {
      try {
        const r = await api('/api/sync/import-uri', { method: 'POST', body: JSON.stringify({ uri: $('ssy-uri-in').value, passphrase: $('ssy-pass').value }) });
        if (window.toast) window.toast(`✅ همگام‌سازی انجام شد (${(r.applied || []).length} بخش)`);
      } catch (e) { if (window.toast) window.toast('❌ ' + e.message); }
    };
    $('ssy-cf-push').onclick = async () => {
      try {
        await api('/api/sync/cloud/push', { method: 'POST', body: JSON.stringify({ passphrase: $('ssy-pass').value }) });
        if (window.toast) window.toast('✅ بسته رمزنگاری‌شده در KV کلودفلر ذخیره شد');
      } catch (e) { if (window.toast) window.toast('❌ ' + e.message); }
    };
    $('ssy-cf-pull').onclick = async () => {
      try {
        const r = await api('/api/sync/cloud/pull', { method: 'POST', body: JSON.stringify({ passphrase: $('ssy-pass').value }) });
        if (window.toast) window.toast(`✅ دریافت از کلودفلر انجام شد (${(r.applied || []).length} بخش)`);
      } catch (e) { if (window.toast) window.toast('❌ ' + e.message); }
    };
  }

  window.refreshSovereignSync = refresh;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { ensureRoot(); refresh(); });
  else { ensureRoot(); refresh(); }
})();
