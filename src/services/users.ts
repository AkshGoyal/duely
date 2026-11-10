import bcrypt from 'bcryptjs';
import { one, query } from '../db';
import { newMcpToken } from '../lib/tokens';

export interface User {
  id: number;
  email: string;
  password_hash: string;
  business_name: string;
  upi_id: string | null;
  mcp_token: string;
  created_at: Date;
}

export const DEMO_EMAIL = 'demo@duely.app';
export const DEMO_PASSWORD = 'duely-demo-2026';

export const findUserByMcpToken = (token: string) =>
  one<User>('SELECT * FROM users WHERE mcp_token = $1', [token]);
export const findUserById = (id: number) => one<User>('SELECT * FROM users WHERE id = $1', [id]);
export const findUserByEmail = (email: string) =>
  one<User>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);

/**
 * Makes sure the demo account exists so the connector works before the seed script runs.
 * DEMO_MCP_TOKEN (optional) fixes its connector token at creation time; otherwise a random one is made.
 */
export async function ensureDemoUser(): Promise<User> {
  const existing = await findUserByEmail(DEMO_EMAIL);
  if (existing) return existing;
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const token = process.env.DEMO_MCP_TOKEN || newMcpToken();
  const [u] = await query<User>(
    `INSERT INTO users (email, password_hash, business_name, upi_id, mcp_token)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING *`,
    [DEMO_EMAIL, hash, 'Pixel & Pine Studio', 'pixelandpine@okhdfcbank', token],
  );
  console.log('Demo user ready: ' + DEMO_EMAIL);
  return u;
}

/** Issues a new connector token; the old URL stops working immediately. */
export async function rotateMcpToken(userId: number): Promise<string> {
  const token = newMcpToken();
  await query('UPDATE users SET mcp_token = $2 WHERE id = $1', [userId, token]);
  return token;
}
