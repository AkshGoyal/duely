import express from 'express';
import { migrate } from './db';
import { mcpRouter } from './mcp/router';
import { ensureDemoUser } from './services/users';
import { authRouter, loadUser, sessions } from './web/auth';
import { dashboardRouter } from './web/dashboard';
import { html } from './web/html';
import { invoicesRouter } from './web/invoices';
import { barePage } from './web/layout';
import { payRouter } from './web/pay';

const app = express();
app.set('trust proxy', 1); // behind Railway/Render TLS proxy
app.disable('x-powered-by');

// Never log tokens: log the route shape only.
app.use((req, _res, next) => {
  const path = req.path.replace(/^\/(mcp|pay)\/[^/]+/, '/$1/:token');
  console.log(`${req.method} ${path}`);
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));

// Startup state, reported by /health so a failed boot is visible without reading logs.
const state: { db: 'starting' | 'ready' | 'error'; error?: string } = { db: 'starting' };

app.get('/health', (_req, res) => {
  res.status(state.db === 'error' ? 503 : 200).json({
    ok: state.db === 'ready',
    service: 'duely',
    db: state.db,
    ...(state.error ? { error: state.error } : {}),
    time: new Date().toISOString(),
  });
});

app.use(mcpRouter);

// Web app: cookie session + current user for everything below.
app.use(sessions, loadUser);
app.use(payRouter);
app.use(authRouter);
app.use(dashboardRouter);
app.use(invoicesRouter);

const messagePage = (title: string, msg: string) =>
  String(
    barePage({
      title: `${title} · Duely`,
      body: html`<div class="min-h-screen flex flex-col items-center justify-center px-4 text-center">
        <p class="text-lg font-semibold">${title}</p>
        <p class="mt-2 text-sm text-slate-500">${msg}</p>
        <a href="/" class="mt-6 text-sm font-medium text-brand-700 hover:underline">Go to dashboard</a>
      </div>`,
    }),
  );

app.use((_req, res) => {
  res.status(404).send(messagePage('Page not found', "That page doesn't exist, or the invoice belongs to another account."));
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  if (res.headersSent) return;
  res.status(500).send(messagePage('Something went wrong', 'Please try again. If it keeps happening, the database may still be starting.'));
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Listen first (so /health answers), then migrate with retries: private DB networking can lag at boot. */
async function main() {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => console.log(`Duely listening on :${port}`));
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await migrate();
      await ensureDemoUser();
      state.db = 'ready';
      delete state.error;
      console.log('Database ready');
      return;
    } catch (e) {
      const err = e as Error & { code?: string };
      state.error = `${[err.code, err.message].filter(Boolean).join(': ') || 'unknown error'} (attempt ${attempt}/10)`;
      console.error('Database init failed:', state.error);
      await sleep(Math.min(2000 * attempt, 10_000));
    }
  }
  state.db = 'error';
}

main();
