import { Router } from 'express';
import { one } from '../db';
import { mcpUrl } from '../lib/tokens';
import { DEMO_EMAIL, rotateMcpToken, User } from '../services/users';
import { requireAuth, setFlash, takeFlash } from './auth';
import { html } from './html';
import { icon } from './icons';
import { appPage, card, pageHeader } from './layout';
import { btnDanger, btnSecondary, formatDateTime, inputCls } from './ui';

const STEPS = [
  { t: 'Copy the URL above', d: 'Keep it private, like a password.' },
  { t: 'Add it in claude.ai', d: 'Settings → Connectors → Add custom connector. Name it Duely.' },
  { t: 'Switch it on in a chat', d: 'Tools menu under the message box → Duely.' },
];

const PROMPTS = [
  'Acme Studios owes me ₹85,000 for the October retainer, INV-104, due 20 Oct. Create it in Duely and draft a WhatsApp nudge, firm but friendly.',
  'Who owes me money and what should I do today?',
  'Bluefin just paid INV-092 in full, UTR 412345678901. Mark it paid and draft a short thank-you.',
];

/** The shared demo account can't rotate, so one reviewer can't disconnect everyone else's Claude. */
const canRotate = (u: User) => u.email !== DEMO_EMAIL || process.env.ALLOW_DEMO_ROTATE === 'true';

export const connectRouter = Router();

connectRouter.get('/connect', requireAuth, async (req, res) => {
  const user = req.user!;
  const url = mcpUrl(user.mcp_token);
  const conn = await one<{ created_at: Date }>(
    `SELECT created_at FROM events WHERE user_id = $1 AND type = 'mcp_connected' ORDER BY id LIMIT 1`,
    [user.id],
  );
  const last = await one<{ created_at: Date }>(
    `SELECT created_at FROM events WHERE user_id = $1 AND source = 'claude' ORDER BY id DESC LIMIT 1`,
    [user.id],
  );

  const body = html`
    ${pageHeader('Connect Claude', 'Your Claude writes and decides. Duely stores and keeps links live.')}

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        ${card(html`<div class="p-5 sm:p-6">
          <div class="flex items-center justify-between gap-3 mb-3">
            <h2 class="text-sm font-semibold text-slate-900">Your connector URL</h2>
            ${conn
              ? html`<span class="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800">${icon('checkCircle', 'h-3.5 w-3.5')} Connected</span>`
              : html`<span class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"><span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span> Not used yet</span>`}
          </div>
          <div class="flex flex-col sm:flex-row gap-2">
            <input readonly aria-label="Connector URL" class="${inputCls} font-mono text-xs" value="${url}" onclick="this.select()" />
            <button type="button" class="${btnSecondary} shrink-0" data-copy="${url}">${icon('copy')}<span data-label>Copy URL</span></button>
          </div>
          ${last ? html`<p class="mt-3 text-xs text-slate-400">Last used by Claude ${formatDateTime(last.created_at)}</p>` : ''}
        </div>`)}

        ${card(html`<div class="p-5 sm:p-6">
          <h2 class="text-sm font-semibold text-slate-900 mb-4">Set up in 2 minutes</h2>
          <ol class="space-y-4">
            ${STEPS.map(
              (s, i) => html`<li class="flex gap-4">
                <span class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">${i + 1}</span>
                <div><p class="font-medium text-slate-900">${s.t}</p><p class="text-sm text-slate-600 mt-0.5">${s.d}</p></div>
              </li>`,
            )}
          </ol>
        </div>`)}

        ${card(html`<div class="p-5 sm:p-6">
          <h2 class="text-sm font-semibold text-slate-900 mb-4">Try saying <span class="font-normal text-slate-400">· tap to copy</span></h2>
          <ul class="space-y-2">
            ${PROMPTS.map(
              (p) => html`<li><button type="button" data-copy="${p}" class="group w-full text-left rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-800 transition-colors hover:border-brand-200 hover:bg-brand-50">
                <span class="flex items-start gap-3">${icon('message', 'h-4 w-4 mt-0.5 shrink-0 text-slate-400 group-hover:text-brand-600')}<span data-label>${p}</span></span>
              </button></li>`,
            )}
          </ul>
        </div>`)}
      </div>

      <aside class="space-y-6">


        ${card(html`<form method="post" action="/connect/rotate" class="p-5" data-confirm="Rotate the connector URL? The current URL stops working immediately and you will need to add the new one in Claude.">
          <h2 class="text-sm font-semibold text-slate-900">Rotate URL</h2>
          <p class="mt-1 text-sm text-slate-500">Leaked? Issue a new URL. The old one stops working.</p>
          ${canRotate(user)
            ? html`<button type="submit" class="${btnDanger} mt-4 w-full" data-loading="Rotating…">${icon('refresh')} Rotate connector URL</button>`
            : html`<button type="button" disabled class="${btnDanger} mt-4 w-full opacity-50 cursor-not-allowed">${icon('refresh')} Rotate connector URL</button>
              <p class="mt-2 text-xs text-slate-400">Off for the shared demo account.</p>`}
        </form>`)}
      </aside>
    </div>`;

  res.send(String(appPage({ title: 'Connect Claude', active: 'connect', business: user.business_name, flash: takeFlash(req), body })));
});

connectRouter.post('/connect/rotate', requireAuth, async (req, res) => {
  if (!canRotate(req.user!)) {
    setFlash(req, { type: 'error', msg: 'Rotation is turned off on the shared demo account.' });
    return res.redirect('/connect');
  }
  await rotateMcpToken(req.user!.id);
  setFlash(req, { type: 'ok', msg: 'New connector URL issued. Update it in claude.ai: Settings → Connectors → Duely.' });
  res.redirect('/connect');
});
