import { Pool, PoolConfig, QueryResult } from 'pg';
import { DbConfig } from '../types';

let pool: Pool | null = null;

export function createPool(config: DbConfig): Pool {
  const poolConfig: PoolConfig = {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
  pool = new Pool(poolConfig);
  return pool;
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createPool() first.');
  }
  return pool;
}

export async function testConnection(): Promise<boolean> {
  try {
    const client = await getPool().connect();
    const result = await client.query('SELECT 1 AS ok');
    client.release();
    return result.rows[0]?.ok === 1;
  } catch (err) {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
