import { html, Raw } from './html';

const HEAD = (title: string) => html`
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
          colors: { brand: { 50: '#ecfdf5', 100: '#d1fae5', 600: '#059669', 700: '#047857', 800: '#065f46' } },
        },
      },
    };
  </script>
  <style>
    body { font-feature-settings: 'tnum' 1; }
    .num { font-variant-numeric: tabular-nums; }
  </style>`;

export interface Flash {
  type: 'ok' | 'error';
  msg: string;
}

function flashBanner(flash?: Flash) {
  if (!flash) return '';
  const cls = flash.type === 'ok' ? 'bg-brand-50 text-brand-800 border-brand-100' : 'bg-red-50 text-red-800 border-red-200';
  return html`<div class="mb-6 rounded-lg border px-4 py-3 text-sm ${cls}" role="status">${flash.msg}</div>`;
}

const NAV = [
  { href: '/', label: 'Invoices', key: 'dashboard' },
  { href: '/invoices/new', label: 'New invoice', key: 'new' },
];

/** Signed-in app shell. */
export function appPage(opts: { title: string; active?: string; business: string; flash?: Flash; body: Raw }) {
  return html`<!doctype html>
<html lang="en">
<head>${HEAD(`${opts.title} · Duely`)}</head>
<body class="bg-slate-50 text-slate-900 antialiased min-h-screen">
  <header class="bg-white border-b border-slate-200">
    <div class="max-w-6xl mx-auto px-4 h-14 flex items-center gap-6">
      <a href="/" class="flex items-center gap-2 font-semibold tracking-tight">
        <span class="inline-flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-white text-sm">₹</span>
        Duely
      </a>
      <nav class="flex items-center gap-1 text-sm overflow-x-auto">
        ${NAV.map(
          (n) => html`<a href="${n.href}" class="px-3 py-1.5 rounded-md whitespace-nowrap ${
            opts.active === n.key ? 'bg-slate-100 text-slate-900 font-medium' : 'text-slate-600 hover:text-slate-900'
          }">${n.label}</a>`,
        )}
      </nav>
      <div class="ml-auto flex items-center gap-3 text-sm">
        <span class="hidden sm:inline text-slate-500">${opts.business}</span>
        <a href="/logout" class="text-slate-600 hover:text-slate-900">Log out</a>
      </div>
    </div>
  </header>
  <main class="max-w-6xl mx-auto px-4 py-8">
    ${flashBanner(opts.flash)}
    ${opts.body}
  </main>
  <script>
    document.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-copy]');
      if (!b) return;
      try { await navigator.clipboard.writeText(b.dataset.copy); } catch (_) {}
      const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => (b.textContent = t), 1500);
    });
  </script>
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
</body>
</html>`;
}
