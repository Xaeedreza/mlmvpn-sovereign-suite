// --- «سپر کلودفلر بدون فیلترشکن» (Zero-VPN Cloudflare Edge Pass) ---
// Renders into #ls-cf-bypass. Talks to /api/cf-bypass/*.

(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const $ = (id) => document.getElementById(id);

  const state = {
    section: 'overview',
    status: null,
    logs: [],
    probeResult: null,
    probing: false,
    deploying: false,
    busy: false,
  };

  const SECTIONS = [
    { id: 'overview', label: 'نمای اصلی و روشن/خاموش', icon: 'ph-fill ph-shield-star', tint: 'var(--mv-orange)' },
    { id: 'domains', label: 'سایت‌ها و بسته‌های آماده', icon: 'ph-fill ph-globe-hemisphere-west', tint: 'var(--mv-blue)' },
    { id: 'worker', label: 'ورکر کلودفلر و آی‌پی تمیز', icon: 'ph-fill ph-cloud-lightning', tint: 'var(--mv-indigo)' },
    { id: 'probe', label: 'تست زنده (مستقیم / کلودفلر)', icon: 'ph-fill ph-gauge', tint: 'var(--mv-green)' },
    { id: 'logs', label: 'گزارش سپر', icon: 'ph-fill ph-terminal-window', tint: 'var(--mv-gray)' },
  ];

  const CSS = `
<style id="cfb-css">
  .cfb-wrap { display:flex; height:100%; min-height:0; flex:1; }
  .cfb-chips { display:flex; flex-wrap:wrap; gap:7px; padding:12px; }
  .cfb-chip { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 11px;
              border-radius:999px; background:var(--mv-fill); border:1px solid var(--mv-sep);
              font-size:12px; font-family:var(--mv-font-tech); color:var(--mv-label); }
  .cfb-chip button { border:0; background:transparent; color:var(--mv-label-3); cursor:pointer; font-size:13px; padding:0 2px; }
  .cfb-chip button:hover { color:var(--mv-red-ink); }
  .cfb-pack-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px; padding:12px; }
  .cfb-pack { display:flex; align-items:center; gap:11px; padding:12px; border-radius:14px; cursor:pointer;
              border:1px solid var(--mv-sep); background:var(--mv-fill); text-align:start; color:inherit; font:inherit; transition:all 150ms ease; }
  .cfb-pack:hover { background:var(--mv-fill-2); }
  .cfb-pack.is-on { border-color:var(--mv-accent); background:var(--mv-accent-soft); }
  .cfb-pack-ico { width:34px; height:34px; border-radius:10px; display:grid; place-items:center; font-size:17px; color:#fff;
                  background:linear-gradient(135deg, #FF7E5F, #E11D48); flex:none; }
  .cfb-log { margin:0; max-height:360px; overflow:auto; padding:12px; font-family:var(--mv-font-mono);
             font-size:11.5px; line-height:1.75; color:var(--mv-label-2); text-align:left; white-space:pre-wrap; }
</style>`;

  function ensureRoot() {
    let root = $('ls-cf-bypass');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'ls-cf-bypass';
    root.style.cssText = 'display:none; width:100%; height:100%; min-height:0; flex:1;';
    document.body.appendChild(root);
    return root;
  }

  function cloudAccounts() {
    try {
      if (typeof loadCloudAccounts === 'function') return loadCloudAccounts() || [];
      const raw = window.PersistentStorage ? PersistentStorage.getItem('cf_accounts') : null;
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  async function api(url, opts) {
    const r = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'خطای درخواست');
    return j;
  }

  async function refresh() {
    try {
      const j = await api('/api/cf-bypass/status');
      state.status = j.status;
      state.logs = j.logs || [];
      render();
    } catch (e) { /* offline preview */ }
  }

  function render() {
    const root = ensureRoot();
    if (!root.dataset.built) {
      root.dataset.built = '1';
      root.innerHTML = CSS + `
<div dir="rtl" class="cfb-wrap mv-split">
  <aside class="mv-side" aria-label="بخش‌های سپر کلودفلر">
    <div class="mv-side-top"></div>
    <div class="mv-eng-ident" id="cfb-ident"></div>
    <nav class="mv-side-list">
      <div class="mv-side-group">
        ${SECTIONS.map((s) => `
        <button type="button" class="mv-side-item" data-cfb-sec="${s.id}">
          <span class="mv-side-tile" style="--tint:${s.tint}"><i class="${s.icon}"></i></span>
          <span>${s.label}</span>
        </button>`).join('')}
      </div>
    </nav>
  </aside>
  <section class="mv-pane">
    <header class="mv-pane-bar">
      <h1 class="mv-pane-title" id="cfb-title">سپر کلودفلر بدون فیلترشکن</h1>
    </header>
    <div class="mv-pane-scroll custom-scrollbar" id="cfb-body"></div>
  </section>
</div>`;

      root.querySelectorAll('[data-cfb-sec]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.section = btn.dataset.cfbSec;
          render();
        });
      });
    }

    const st = state.status || { running: false, domainCount: 0, proxiedRequests: 0, directBypassed: 0, config: { packs: [], customDomains: [], cleanIp: '104.16.132.229' }, presets: [] };
    const cfg = st.config || {};

    const ident = $('cfb-ident');
    if (ident) {
      ident.innerHTML = `
        <span class="mv-side-tile" style="--tint:var(--mv-orange); width:54px; height:54px; border-radius:14px; font-size:26px">
          <i class="ph-fill ph-cloud-check"></i>
        </span>
        <b>سپر کلودفلر</b>
        <small><i class="mv-eng-dot${st.running ? ' is-on' : ''}"></i>${st.running ? 'فعال (بدون VPN)' : 'خاموش'}</small>`;
    }

    root.querySelectorAll('[data-cfb-sec]').forEach((b) => {
      b.classList.toggle('active', b.dataset.cfbSec === state.section);
    });
    const secMeta = SECTIONS.find((s) => s.id === state.section) || SECTIONS[0];
    const titleEl = $('cfb-title');
    if (titleEl) titleEl.textContent = secMeta.label;

    const body = $('cfb-body');
    if (!body) return;

    if (state.section === 'overview') {
      body.innerHTML = `
      <div class="mv-form">
        <div class="mv-form-section is-wide">
          <div class="sv-orb-card">
            <div class="sv-orb-wrap">
              <button type="button" id="cfb-power-btn" class="sv-orb-btn ${st.running ? 'is-on' : ''}" title="${st.running ? 'خاموش کردن سپر' : 'روشن کردن سپر'}">
                <i class="ph-bold ph-power"></i>
              </button>
              <div>
                <h2 style="margin:0; font-size:16px; font-weight:800;">${st.running ? 'سپر کلودفلر فعال است — فقط سایت‌های انتخابی عبور می‌کنند' : 'رفع فیلتر و تحریم بدون روشن کردن فیلترشکن'}</h2>
                <p style="margin:5px 0 0; font-size:12.5px; color:var(--mv-label-2); line-height:1.6;">
                  سایت‌های ایرانی، بانک‌ها و بازی‌ها ۱۰۰٪ مستقیم می‌مانند؛ فقط دامنه‌های لیست شما از لبه تمیز کلودفلر عبور می‌کنند.
                </p>
              </div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" class="sv-btn-warm" id="cfb-toggle-cta">${state.busy ? 'در حال اجرا...' : (st.running ? 'توقف سپر کلودفلر' : 'فعال‌سازی سپر کلودفلر')}</button>
              <button type="button" class="sv-btn-soft" id="cfb-copy-pac"><i class="ph-bold ph-link"></i> کپی نشانی PAC</button>
            </div>
          </div>
        </div>

        <div class="mv-form-section is-wide">
          <div class="sv-stat-row">
            <div class="sv-stat-box"><small>دامنه‌های تحت پوشش</small><b>${st.domainCount || 0} دامنه</b></div>
            <div class="sv-stat-box"><small>درخواست‌های کلودفلری</small><b>${st.proxiedRequests || 0}</b></div>
            <div class="sv-stat-box"><small>ترافیک مستقیم حفظ‌شده</small><b>${st.directBypassed || 0}</b></div>
            <div class="sv-stat-box"><small>پورت میکرو-روتر</small><b dir="ltr">127.0.0.1:${st.localProxyPort || 20822}</b></div>
          </div>
        </div>

        <div class="mv-form-section is-wide">
          <div class="mv-form-header">نحوه اتصال</div>
          <div class="mv-form-group">
            <div class="mv-form-row">
              <span class="mv-form-label">تنظیم خودکار ویندوز (PAC بدون VPN)<small>فقط مرورگر و برنامه‌های انتخابی از کلودفلر رد می‌شوند</small></span>
              <span class="mv-form-control">
                <input type="checkbox" class="mv-switch-input" id="cfb-sys-pac" ${cfg.applySystemPac !== false ? 'checked' : ''} />
              </span>
            </div>
            <div class="mv-form-row">
              <span class="mv-form-label">ورکر متصل<small>${cfg.workerUrl ? esc(cfg.workerUrl) : 'هنوز مستقر نشده — در تب ورکر با یک کلیک بسازید یا دستی وارد کنید'}</small></span>
              <span class="mv-form-control">
                <button type="button" class="sv-btn-soft" id="cfb-go-worker">تنظیم ورکر</button>
              </span>
            </div>
          </div>
        </div>
      </div>`;

      $('cfb-power-btn').onclick = $('cfb-toggle-cta').onclick = async () => {
        state.busy = true; render();
        try {
          if (st.running) await api('/api/cf-bypass/stop', { method: 'POST' });
          else await api('/api/cf-bypass/start', { method: 'POST', body: JSON.stringify({}) });
        } catch (e) { if (window.toast) window.toast('❌ ' + e.message); }
        state.busy = false;
        await refresh();
      };
      $('cfb-sys-pac').onchange = async (e) => {
        await api('/api/cf-bypass/config', { method: 'POST', body: JSON.stringify({ applySystemPac: !!e.target.checked }) });
        await refresh();
      };
      $('cfb-go-worker').onclick = () => { state.section = 'worker'; render(); };
      $('cfb-copy-pac').onclick = () => {
        if (st.pacUrl && navigator.clipboard) {
          navigator.clipboard.writeText(st.pacUrl);
          if (window.toast) window.toast('✅ نشانی PAC کپی شد: ' + st.pacUrl);
        }
      };
    } else if (state.section === 'domains') {
      const packs = st.presets || [];
      const activePacks = cfg.packs || [];
      const customs = cfg.customDomains || [];
      body.innerHTML = `
      <div class="mv-form">
        <div class="mv-form-section is-wide">
          <div class="mv-form-header">بسته‌های آماده رفع تحریم و فیلتر (کلیک برای فعال/غیرفعال)</div>
          <div class="mv-form-group">
            <div class="cfb-pack-grid">
              ${packs.map((p) => {
                const on = activePacks.includes(p.id);
                return `<button type="button" class="cfb-pack ${on ? 'is-on' : ''}" data-cfb-pack="${p.id}">
                  <span class="cfb-pack-ico"><i class="${p.icon}"></i></span>
                  <span><b style="display:block;font-size:13px">${esc(p.titleFa)}</b><small style="color:var(--mv-label-3);font-size:11px">${p.domains.length} دامنه</small></span>
                </button>`;
              }).join('')}
            </div>
          </div>
        </div>

        <div class="mv-form-section is-wide">
          <div class="mv-form-header">افزودن دامنه یا وب‌سایت دلخواه</div>
          <div class="mv-form-group">
            <div class="mv-form-row">
              <input id="cfb-new-domain" type="text" dir="ltr" placeholder="مثلاً openai.com یا huggingface.co" style="flex:1;height:34px;border-radius:10px;padding:0 12px;background:var(--mv-field);border:1px solid var(--mv-sep);color:var(--mv-label);font-family:var(--mv-font-tech);" />
              <button type="button" class="sv-btn-warm" id="cfb-add-domain">افزودن</button>
            </div>
            <div class="cfb-chips">
              ${customs.length ? customs.map((d) => `<span class="cfb-chip">${esc(d)} <button type="button" data-cfb-del="${esc(d)}">×</button></span>`).join('') : '<span style="color:var(--mv-label-3);font-size:12px;">هنوز دامنه اختصاصی اضافه نشده است.</span>'}
            </div>
          </div>
        </div>
      </div>`;

      body.querySelectorAll('[data-cfb-pack]').forEach((el) => {
        el.onclick = async () => {
          const id = el.dataset.cfbPack;
          const next = activePacks.includes(id) ? activePacks.filter((x) => x !== id) : [...activePacks, id];
          await api('/api/cf-bypass/config', { method: 'POST', body: JSON.stringify({ packs: next }) });
          await refresh();
        };
      });
      $('cfb-add-domain').onclick = async () => {
        const val = ($('cfb-new-domain').value || '').trim();
        if (!val) return;
        await api('/api/cf-bypass/config', { method: 'POST', body: JSON.stringify({ customDomains: [...customs, val] }) });
        await refresh();
      };
      body.querySelectorAll('[data-cfb-del]').forEach((btn) => {
        btn.onclick = async () => {
          const next = customs.filter((d) => d !== btn.dataset.cfbDel);
          await api('/api/cf-bypass/config', { method: 'POST', body: JSON.stringify({ customDomains: next }) });
          await refresh();
        };
      });
    } else if (state.section === 'worker') {
      const accs = cloudAccounts();
      body.innerHTML = `
      <div class="mv-form">
        <div class="mv-form-section is-wide">
          <div class="mv-form-header">استقرار خودکار ورکر کلودفلر (cf-edge-pass)</div>
          <div class="mv-form-group">
            <div class="mv-form-row">
              <span class="mv-form-label">حساب کلودفلر<small>با یک کلیک ورکر سبک Edge Pass + KV Sync مستقر می‌شود</small></span>
              <span class="mv-form-control" style="display:flex;gap:8px;align-items:center;">
                <select id="cfb-acc-sel" class="mv-popup" style="min-width:170px;">
                  ${accs.length ? accs.map((a) => `<option value="${esc(a.id)}" ${cfg.accountId === a.id ? 'selected' : ''}>${esc(a.name || a.email || a.id)}</option>`).join('') : '<option value="">ابتدا در «زیرساخت ابری» اکانت اضافه کنید</option>'}
                </select>
                <button type="button" class="sv-btn-warm" id="cfb-deploy-btn" ${!accs.length || state.deploying ? 'disabled' : ''}>${state.deploying ? 'در حال نصب...' : 'استقرار خودکار'}</button>
              </span>
            </div>
          </div>
        </div>

        <div class="mv-form-section is-wide">
          <div class="mv-form-header">تنظیمات دستی ورکر و آی‌پی تمیز</div>
          <div class="mv-form-group">
            <div class="mv-form-row"><span class="mv-form-label">نشانی ورکر</span><input id="cfb-w-url" dir="ltr" value="${esc(cfg.workerUrl || '')}" placeholder="https://edge-pass.user.workers.dev" style="width:280px;height:32px;padding:0 10px;border-radius:8px;background:var(--mv-field);border:1px solid var(--mv-sep);color:var(--mv-label);font-family:var(--mv-font-tech);" /></div>
            <div class="mv-form-row"><span class="mv-form-label">آی‌پی تمیز کلودفلر (Clean IP)</span><input id="cfb-w-ip" dir="ltr" value="${esc(cfg.cleanIp || '104.16.132.229')}" style="width:220px;height:32px;padding:0 10px;border-radius:8px;background:var(--mv-field);border:1px solid var(--mv-sep);color:var(--mv-label);font-family:var(--mv-font-tech);" /></div>
            <div class="mv-form-row"><span class="mv-form-label">ProxyIP پشتیبان (برای سایت‌های پشت کلودفلر مثل ChatGPT)</span><input id="cfb-w-pip" dir="ltr" value="${esc(cfg.proxyIp || '')}" placeholder="مثلاً proxyip.cmliussss.net" style="width:240px;height:32px;padding:0 10px;border-radius:8px;background:var(--mv-field);border:1px solid var(--mv-sep);color:var(--mv-label);font-family:var(--mv-font-tech);" /></div>
            <div class="mv-form-row"><span class="mv-form-label">کلید دسترسی ورکر (PassKey)</span><input id="cfb-w-key" dir="ltr" value="${esc(cfg.passKey || '')}" style="width:240px;height:32px;padding:0 10px;border-radius:8px;background:var(--mv-field);border:1px solid var(--mv-sep);color:var(--mv-label);font-family:var(--mv-font-tech);" /></div>
            <div class="mv-form-row"><span class="mv-form-label">تکه‌تکه کردن TLS (ضد DPI)</span><input type="checkbox" class="mv-switch-input" id="cfb-w-frag" ${cfg.tlsFragment !== false ? 'checked' : ''} /></div>
          </div>
          <div style="margin-top:12px; display:flex; justify-content:flex-end;">
            <button type="button" class="sv-btn-warm" id="cfb-save-worker">ذخیره تنظیمات ورکر</button>
          </div>
        </div>
      </div>`;

      const deployBtn = $('cfb-deploy-btn');
      if (deployBtn) {
        deployBtn.onclick = async () => {
          state.deploying = true; render();
          try {
            const accId = $('cfb-acc-sel').value;
            const r = await api('/api/cf-bypass/deploy-worker', { method: 'POST', body: JSON.stringify({ accountId: accId }) });
            if (window.toast) window.toast('✅ ورکر سپر کلودفلر مستقر شد: ' + r.workerUrl);
          } catch (e) { if (window.toast) window.toast('❌ ' + e.message); }
          state.deploying = false;
          await refresh();
        };
      }
      $('cfb-save-worker').onclick = async () => {
        await api('/api/cf-bypass/config', {
          method: 'POST',
          body: JSON.stringify({
            workerUrl: $('cfb-w-url').value,
            cleanIp: $('cfb-w-ip').value,
            proxyIp: $('cfb-w-pip').value,
            passKey: $('cfb-w-key').value,
            tlsFragment: $('cfb-w-frag').checked,
          }),
        });
        if (window.toast) window.toast('✅ تنظیمات ذخیره شد');
        await refresh();
      };
    } else if (state.section === 'probe') {
      const pr = state.probeResult;
      body.innerHTML = `
      <div class="mv-form">
        <div class="mv-form-section is-wide">
          <div class="mv-form-header">مقایسه دسترسی مستقیم با عبور از سپر کلودفلر</div>
          <div class="mv-form-group">
            <div class="mv-form-row">
              <input id="cfb-probe-host" dir="ltr" value="api.openai.com" style="flex:1;height:34px;border-radius:10px;padding:0 12px;background:var(--mv-field);border:1px solid var(--mv-sep);color:var(--mv-label);font-family:var(--mv-font-tech);" />
              <button type="button" class="sv-btn-warm" id="cfb-run-probe" ${state.probing ? 'disabled' : ''}>${state.probing ? 'در حال تست...' : 'اجرای تست مقایسه'}</button>
            </div>
            ${pr ? `
            <div class="sv-stat-row" style="padding:12px;">
              <div class="sv-stat-box"><small>اتصال مستقیم (خط فعلی)</small><b style="color:${pr.direct.ok ? 'var(--mv-green-ink)' : 'var(--mv-red-ink)'}">${pr.direct.ok ? `باز (${pr.direct.status}) · ${pr.direct.ms}ms` : `بسته/تحریم (${pr.direct.status || pr.direct.reason})`}</b></div>
              <div class="sv-stat-box"><small>سپر کلودفلر (CF Edge)</small><b style="color:${pr.cloudflareEdge.ok ? 'var(--mv-green-ink)' : 'var(--mv-orange-ink)'}">${pr.cloudflareEdge.ok ? `موفق (${pr.cloudflareEdge.status}) · ${pr.cloudflareEdge.ms}ms` : `ناموفق (${pr.cloudflareEdge.reason || pr.cloudflareEdge.status})`}</b></div>
            </div>` : ''}
          </div>
        </div>
      </div>`;
      $('cfb-run-probe').onclick = async () => {
        state.probing = true; render();
        try {
          const r = await api('/api/cf-bypass/probe', { method: 'POST', body: JSON.stringify({ domain: $('cfb-probe-host').value }) });
          state.probeResult = r.result;
        } catch (e) { if (window.toast) window.toast('❌ ' + e.message); }
        state.probing = false;
        render();
      };
    } else if (state.section === 'logs') {
      body.innerHTML = `<div class="mv-form"><div class="mv-form-section is-wide"><div class="mv-form-group"><pre class="cfb-log" dir="ltr">${esc((state.logs || []).join('\n') || 'هنوز گزارشی ثبت نشده است.')}</pre></div></div></div>`;
    }
  }

  window.MVProbe = window.MVProbe || {};
  window.MVProbe.cfBypass = () => !!(state.status && state.status.running);
  window.refreshCfBypass = refresh;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { ensureRoot(); refresh(); });
  else { ensureRoot(); refresh(); }
})();
