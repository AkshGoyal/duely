// Prints the demo user's MCP connector URL. Run in a trusted shell only (it prints a secret).
import { pool } from '../db';
import { mcpUrl } from '../lib/tokens';
import { DEMO_EMAIL, ensureDemoUser } from '../services/users';
import { migrate } from '../db';

(async () => {
  await migrate();
  const u = await ensureDemoUser();
  console.log(`\nMCP connector URL for ${DEMO_EMAIL}:\n${mcpUrl(u.mcp_token)}\n`);
  await pool.end();
})();
