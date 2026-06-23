import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getServerEnv } from '@/lib/env';

// Single shared pool. `app_user` is a NON-owner role so RLS applies at runtime;
// the owner role (used only for migrations) is never used by the app.
export const pool = new Pool({
  connectionString: getServerEnv().DATABASE_URL,
  max: Number(process.env.PGPOOL_MAX ?? 10),
  // TLS is conditional: a local Docker Postgres has no TLS (PGSSL=disable in
  // NON-production), while Azure Postgres Flexible Server presents a DigiCert
  // Global Root G2 cert (in Node's default CA store) which we VERIFY. The
  // NODE_ENV guard means a stray PGSSL=disable in production is ignored and TLS
  // stays on — secure by default. Never rejectUnauthorized:false.
  ssl:
    process.env.PGSSL === 'disable' && process.env.NODE_ENV !== 'production'
      ? false
      : { rejectUnauthorized: true },
});

export const db = drizzle(pool);
