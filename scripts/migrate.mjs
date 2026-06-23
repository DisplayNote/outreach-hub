// Applies supabase/migrations/*.sql in lexical order, tracked in a _migrations
// table. Connects as DATABASE_URL_ADMIN (the server owner) so migrations can
// manage roles/policies; the app connects as DATABASE_URL (app_user) at runtime.
import { readdirSync, readFileSync } from 'node:fs';
import { Client } from 'pg';

const dir = new URL('../supabase/migrations/', import.meta.url);

const client = new Client({
  connectionString: process.env.DATABASE_URL_ADMIN,
  // TLS is conditional: a local Docker Postgres has no TLS (PGSSL=disable),
  // while Azure Postgres Flexible Server is verified — never rejectUnauthorized:false.
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
});

await client.connect();
await client.query(
  'create table if not exists public._migrations (name text primary key, applied_at timestamptz default now())',
);
const done = new Set(
  (await client.query('select name from public._migrations')).rows.map((r) => r.name),
);

for (const name of readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  if (done.has(name)) continue;
  const sql = readFileSync(new URL(name, dir), 'utf8');
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('insert into public._migrations(name) values ($1)', [name]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    console.error(`migration ${name} failed`, e);
    process.exit(1);
  }
  console.log(`applied ${name}`);
}

await client.end();
