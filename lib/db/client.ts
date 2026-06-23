import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getServerEnv } from '@/lib/env';

// Single shared pool. `app_user` is a NON-owner role so RLS applies at runtime;
// the owner role (used only for migrations) is never used by the app.
export const pool = new Pool({
  connectionString: getServerEnv().DATABASE_URL,
  max: Number(process.env.PGPOOL_MAX ?? 10),
  // TLS is conditional: a local Docker Postgres has no TLS (PGSSL=disable),
  // while Azure Postgres Flexible Server presents a DigiCert Global Root G2 cert
  // (in Node's default CA store) which we VERIFY — never rejectUnauthorized:false.
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
});

export const db = drizzle(pool);
