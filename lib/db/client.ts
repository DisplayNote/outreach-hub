import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

// Single shared pool. `app_user` is a NON-owner role so RLS applies at runtime;
// the owner role (used only for migrations) is never used by the app.
//
// Read DATABASE_URL directly from process.env (NOT via getServerEnv's zod parse)
// so importing this module never throws at load time — node-postgres connects
// lazily, so a missing URL only surfaces when a query actually runs. This keeps
// test files that merely import the db (e.g. DATABASE_URL_TEST-gated suites that
// then skip) from failing to load in CI. getServerEnv still validates
// DATABASE_URL as required for the app's normal server boot.
//
// Exception: fail fast in production so a misconfigured deploy surfaces
// immediately at startup rather than at the first DB query.
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required in production');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
