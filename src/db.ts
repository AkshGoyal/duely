import fs from 'node:fs';
import path from 'node:path';
import { Pool, types, PoolClient } from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings (no timezone shifting) and BIGINT as numbers
// (paise totals stay far below 2^53).
types.setTypeParser(1082, (v: string) => v);
types.setTypeParser(20, (v: string) => Number(v));


export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 10_000,
});
pool.on('error', (e) => console.error('Postgres pool error:', e.message));

export async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export async function migrate(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set on this service');
  const dir = path.join(process.cwd(), 'db', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  console.log(`Migrations applied: ${files.join(', ')}`);
}
