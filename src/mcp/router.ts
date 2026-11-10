import { Router, Request, Response, NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './server';

const TOKEN_RE = /^[A-Za-z0-9_-]{21,64}$/;

function rpcError(res: Response, status: number, code: number, message: string) {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

// Permissive CORS so browser-based clients (e.g. MCP Inspector "direct" mode) can connect.
function cors(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

export const mcpRouter = Router();

mcpRouter.use('/mcp/:token', cors);

mcpRouter.post('/mcp/:token', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  if (!TOKEN_RE.test(token)) {
    rpcError(res, 404, -32001, 'Unknown Duely connector URL. Copy your URL again from the Connect page.');
    return;
  }

  const server = buildMcpServer({ token });
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request failed:', (err as Error).message);
    if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
  }
});

// Stateless server: no SSE stream to resume, no session to delete.
const notAllowed = (_req: Request, res: Response) => {
  res.setHeader('Allow', 'POST');
  rpcError(res, 405, -32000, 'Method not allowed.');
};
mcpRouter.get('/mcp/:token', notAllowed);
mcpRouter.delete('/mcp/:token', notAllowed);
