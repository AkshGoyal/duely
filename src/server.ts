import express from 'express';
import { migrate } from './db';
import { mcpRouter } from './mcp/router';
import { ensureDemoUser } from './services/users';

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

app.get('/', (_req, res) => {
  res.type('text').send('Duely is running. MCP endpoint: POST /mcp/:token');
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
