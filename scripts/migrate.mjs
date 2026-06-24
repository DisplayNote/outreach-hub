// Applies supabase/migrations/*.sql in lexical order, tracked in a _migrations
// table. Connects as DATABASE_URL_ADMIN (the server owner) so migrations can
// manage roles/policies; the app connects as DATABASE_URL (app_user) at runtime.
import { readdirSync, readFileSync } from 'node:fs';
import { Client } from 'pg';

if (!process.env.DATABASE_URL_ADMIN) {
  console.error('migrate: DATABASE_URL_ADMIN is required. Set it before running migrations.');
  process.exit(1);
}

const dir = new URL('../supabase/migrations/', import.meta.url);

const client = new Client({
  connectionString: process.env.DATABASE_URL_ADMIN,
  // TLS is conditional: a local Docker Postgres has no TLS (PGSSL=disable in
  // non-prod), while Azure Postgres Flexible Server is verified — never
  // rejectUnauthorized:false.
  ssl:
    process.env.PGSSL === 'disable' && process.env.NODE_ENV !== 'production'
      ? false
      : { rejectUnauthorized: true },
});

await client.connect();

// Serialize concurrent runners (two deploys / a CI job + a manual run): the loser
// waits here, then sees the applied rows and no-ops. Session lock auto-releases
// on disconnect; we also release explicitly.
await client.query("select pg_advisory_lock(hashtext('outreach_migrations'))");

try {
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

  // Post-migration: (re)assert app_user privileges + password every run. Done
  // here (not in a tracked migration) so it covers tables added by future
  // migrations, the column-restriction is always applied LAST (after the blanket
  // grant), and the password comes from env/Key Vault — never committed SQL.
  await client.query('grant usage on schema public to app_user');
  await client.query('grant select, insert, update, delete on all tables in schema public to app_user');
  await client.query('grant execute on all functions in schema public to app_user');
  await client.query(
    'alter default privileges in schema public grant select, insert, update, delete on tables to app_user',
  );
  await client.query('alter default privileges in schema public grant execute on functions to app_user');
  // Column-level least privilege (mirror the legacy `authenticated` grant): a
  // member may change ONLY organizations.settings — not rename the org or touch
  // id/created_at. Applied after the blanket grant so it wins.
  await client.query('revoke update on public.organizations from app_user');
  await client.query('grant update (settings) on public.organizations to app_user');

  // Set/rotate the app_user password from APP_USER_PASSWORD (local dev) or the
  // Key Vault secret the deploy injects (Azure). escapeLiteral prevents injection;
  // ALTER ROLE cannot use bind parameters for the password literal.
  const appPw = process.env.APP_USER_PASSWORD;
  if (appPw) {
    await client.query(`alter role app_user with password ${client.escapeLiteral(appPw)}`);
  } else if (process.env.NODE_ENV === 'production') {
    console.error('migrate: APP_USER_PASSWORD is required in production (set it from Key Vault).');
    process.exit(1);
  } else {
    console.warn('migrate: APP_USER_PASSWORD unset — app_user has no password (local dev: set APP_USER_PASSWORD).');
  }
} finally {
  await client.query("select pg_advisory_unlock(hashtext('outreach_migrations'))");
  await client.end();
}
