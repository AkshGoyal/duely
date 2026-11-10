import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface McpContext {
  token: string;
}

// A fresh server is built per request (stateless mode).
export function buildMcpServer(_ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: 'duely', version: '0.1.0' },
    {
      instructions:
        'Duely keeps invoices, payment links and client promises on record. ' +
        'You (Claude) write every message; Duely stores it and keeps the pay link live.',
    },
  );

  server.registerTool(
    'ping',
    {
      title: 'Ping Duely',
      description: 'Health check. Returns "pong" and the server time. Use it to confirm the Duely connector works.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, message: 'pong', server_time: new Date().toISOString() }),
        },
      ],
    }),
  );

  return server;
}
