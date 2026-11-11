import { html, raw, Raw } from './html';
import { icon, logoMark } from './icons';

const HEAD = (title: string) => html`
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#ffffff" />
  <title>${title}</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23059669'/%3E%3Ctext x='16' y='23' font-size='18' text-anchor='middle' fill='white' font-family='Arial'%3E%E2%82%B9%3C/text%3E%3C/svg%3E" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
          colors: { brand: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b' } },
          boxShadow: { card: '0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.06)' },
        },
      },
    };
  </script>
  <style>
    body { font-feature-settings: 'ss01' 1; }
    .num { letter-spacing: -0.01em; }
    .num { font-variant-numeric: tabular-nums; }
    :focus-visible { outline: 2px solid #059669; outline-offset: 2px; }
    a, button, summary, [role=button] { cursor: pointer; }
    details > summary::-webkit-details-marker { display: none; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
  </style>`;

/** Shared tiny behaviours: copy buttons and "Saving…" feedback on submit. */
const GLOBAL_JS = html`<script>
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); } catch (_) {}
    const label = b.querySelector('[data-label]') || b;
    const t = label.textContent; label.textContent = 'Copied'; b.setAttribute('aria-live', 'polite');
    setTimeout(() => (label.textContent = t), 1600);
  });
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.dataset.confirm && !confirm(f.dataset.confirm)) { e.preventDefault(); return; }
    f.dataset.submitting = '1';
    f.querySelectorAll('button[type=submit], button:not([type])').forEach((b) => {
      b.dataset.busy = b.innerHTML; b.disabled = true; b.classList.add('opacity-60'); if (b.dataset.loading) b.textContent = b.dataset.loading;
    });
  });
  // Coming back with the browser's Back button restores a frozen page: re-enable its buttons.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    document.querySelectorAll('button[data-busy]').forEach((b) => {
      b.innerHTML = b.dataset.busy; b.disabled = false; b.classList.remove('opacity-60'); delete b.dataset.busy;
    });
    document.querySelectorAll('form[data-submitting]').forEach((f) => delete f.dataset.submitting);
  });
  // Forms marked data-track-changes show "Unsaved changes", offer Discard, and warn before leaving.
  document.querySelectorAll('form[data-track-changes]').forEach((f) => {
    const msg = f.querySelector('[data-dirty-msg]');
    const discard = f.querySelector('[data-discard]');
    let dirty = false;
    const mark = () => {
      if (dirty) return;
      dirty = true;
      msg.textContent = 'Unsaved changes';
      msg.className = 'text-sm font-medium text-amber-700';
      discard.classList.remove('hidden');
    };
    f.addEventListener('input', mark);
    f.addEventListener('change', mark);
    f.addEventListener('click', (e) => { if (e.target.closest('#li-add, .li-remove, #li-use-total')) mark(); });
    discard.addEventListener('click', () => { dirty = false; location.reload(); });
    window.addEventListener('beforeunload', (e) => { if (dirty && !f.dataset.submitting) { e.preventDefault(); e.returnValue = ''; } });
  });
</script>`;

export interface Flash {
  type: 'ok' | 'error';
  msg: string;
}

function flashBanner(flash?: Flash) {
  if (!flash) return '';
  const ok = flash.type === 'ok';
  return html`<div class="mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
    ok ? 'bg-brand-50 text-brand-900 border-brand-200' : 'bg-red-50 text-red-900 border-red-200'
  }" role="${ok ? 'status' : 'alert'}">
    ${icon(ok ? 'checkCircle' : 'alert', `h-5 w-5 shrink-0 ${ok ? 'text-brand-600' : 'text-red-600'}`)}
    <span>${flash.msg}</span>
  </div>`;
}

const NAV = [
  { href: '/', label: 'Invoices', key: 'dashboard', icon: 'list' },
  { href: '/invoices/new', label: 'New invoice', key: 'new', icon: 'plus' },
  { href: '/connect', label: 'Connect Claude', key: 'connect', icon: 'plug' },
  { href: '/metrics', label: 'Metrics', key: 'metrics', icon: 'chart' },
];

/** Signed-in app shell. */
export function appPage(opts: { title: string; active?: string; business: string; flash?: Flash; body: Raw }) {
  return html`<!doctype html>
<html lang="en">
<head>${HEAD(`${opts.title} · Duely`)}</head>
<body class="bg-slate-50 text-slate-900 antialiased min-h-screen">
  <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:shadow">Skip to content</a>
  <header class="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
    <div class="max-w-6xl mx-auto px-4">
      <div class="h-14 flex items-center gap-4">
        <a href="/" class="flex items-center gap-2 font-semibold tracking-tight text-slate-900">${logoMark('h-7 w-7')} Duely</a>
        <nav class="hidden md:flex items-center gap-1 text-sm" aria-label="Main">
          ${NAV.map(
            (n) => html`<a href="${n.href}" ${opts.active === n.key ? raw('aria-current="page"') : ''} class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors duration-150 ${
              opts.active === n.key ? 'bg-slate-100 text-slate-900 font-medium' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }">${icon(n.icon)} ${n.label}</a>`,
          )}
        </nav>
        <div class="ml-auto flex items-center gap-3 text-sm">
          <span class="hidden sm:inline max-w-[14rem] truncate text-slate-500">${opts.business}</span>
          <a href="/logout" class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors">${icon('logout')}<span class="hidden sm:inline">Log out</span></a>
        </div>
      </div>
      <nav class="md:hidden -mx-4 px-4 flex gap-1 overflow-x-auto pb-2 text-sm" aria-label="Main mobile">
        ${NAV.map(
          (n) => html`<a href="${n.href}" class="inline-flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-lg ${
            opts.active === n.key ? 'bg-slate-900 text-white font-medium' : 'bg-slate-100 text-slate-700'
          }">${icon(n.icon)} ${n.label}</a>`,
        )}
      </nav>
    </div>
  </header>
  <main id="main" class="max-w-6xl mx-auto px-4 py-6 sm:py-10 pb-16">
    ${flashBanner(opts.flash)}
    ${opts.body}
  </main>
  ${GLOBAL_JS}
</body>
</html>`;
}

/** Bare page for login, the public pay page and errors. */
export function barePage(opts: { title: string; body: Raw; bg?: string }) {
  return html`<!doctype html>
<html lang="en">
<head>${HEAD(opts.title)}</head>
<body class="${opts.bg ?? 'bg-slate-50'} text-slate-900 antialiased min-h-screen">
  ${opts.body}
  ${GLOBAL_JS}
</body>
</html>`;
}

/** Page header with title, optional subtitle and right-side actions. */
export const pageHeader = (title: string, sub?: unknown, actions?: unknown) => html`
  <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
    <div class="min-w-0">
      <h1 class="text-2xl sm:text-[28px] font-semibold tracking-tight text-slate-900">${title}</h1>
      ${sub ? html`<p class="text-sm text-slate-500 mt-1">${sub}</p>` : ''}
    </div>
    ${actions ? html`<div class="flex flex-wrap gap-2">${actions}</div>` : ''}
  </div>`;

export const card = (body: unknown, cls = '') => html`<section class="bg-white rounded-2xl border border-slate-200 shadow-card ${cls}">${body}</section>`;
