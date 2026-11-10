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

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'duely', time: new Date().toISOString() });
});

app.use(mcpRouter);

app.get('/', (_req, res) => {
  res.type('text').send('Duely is running. MCP endpoint: POST /mcp/:token');
});

async function main() {
  await migrate();
  await ensureDemoUser();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => console.log(`Duely listening on :${port}`));
}

main().catch((e) => {
  console.error('Startup failed:', e.message);
  process.exit(1);
});
