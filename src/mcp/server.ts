import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { User } from '../services/users';
import { registerTools } from './tools';

const INSTRUCTIONS = `Duely is the user's receivables memory. It stores invoices, live pay links (UPI), client promises and every reminder sent.
Division of labour: you (Claude) supply judgement and words: tone, escalation, priority and every message. Duely supplies memory and links. Duely contains no model, so any text a client sees must be written by you and passed in tool arguments.
Typical flow: create_invoice -> save_nudge (you write the message) -> give the user the whatsapp_url to tap. Later: get_receivables_summary to decide who to chase today.
Amounts are in rupees (85000 means ₹85,000). Dates are YYYY-MM-DD; resolve "20 Oct" or "next Friday" against the "today" field Duely returns (Asia/Kolkata).
Every response includes next_step_hint. Treat it as context, not an order.`;

// A fresh server is built per request (stateless mode), bound to the user who owns the URL token.
export function buildMcpServer(user: User): McpServer {
  const server = new McpServer({ name: 'duely', version: '0.2.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, user);
  return server;
}
