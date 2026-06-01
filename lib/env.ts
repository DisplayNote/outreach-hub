import { z } from 'zod';

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const emptyStringAsUndefined = (value: unknown) => (value === '' ? undefined : value);

const serverEnvSchema = publicEnvSchema
  .extend({
    SUPABASE_INTERNAL_URL: z.preprocess(
      emptyStringAsUndefined,
      z.string().url().optional(),
    ),
    SUPABASE_SERVICE_ROLE_KEY: z.preprocess(
      emptyStringAsUndefined,
      z.string().min(1).optional(),
    ),
    EMAIL_DRIVER: z
      .enum(['mock', 'mailpit', 'graph-dev', 'graph-prod'])
      .default('mock'),
    // Phase 4 — Telnyx AMD "Mode B" server env. All optional: the local/mock
    // path needs none of them (see isDiallerMockEnabled). AMD_MODE / no-answer
    // timeout have safe defaults matching legacy/worker.js.
    TELNYX_API_KEY: z.preprocess(emptyStringAsUndefined, z.string().min(1).optional()),
    TELNYX_CONNECTION_ID: z.preprocess(emptyStringAsUndefined, z.string().min(1).optional()),
    TELNYX_PUBLIC_KEY: z.preprocess(emptyStringAsUndefined, z.string().min(1).optional()),
    BRIDGE_SIP_USERNAME: z.preprocess(emptyStringAsUndefined, z.string().min(1).optional()),
    AMD_MODE: z.enum(['premium', 'detect', 'detect_beep']).default('premium'),
    NO_ANSWER_TIMEOUT_MS: z.coerce.number().int().positive().default(22000),
    // Phase 5 — shared secret gating the scheduled email runner/scanner routes
    // (Vercel Cron). Optional: unset in dev (manual trigger only).
    CRON_SECRET: z.preprocess(emptyStringAsUndefined, z.string().min(1).optional()),
    // The single org the cron sender/scanner serves (the org whose mailbox the
    // configured email driver/token points at). One global driver = one mailbox,
    // so cron must NOT fan out across orgs; set this per deployment.
    CRON_ORG_ID: z.preprocess(emptyStringAsUndefined, z.string().uuid().optional()),
    // The mailbox the cron sender sends FROM, when the org hasn't set
    // settings.senderEmail. A supported deploy-time config path so the scheduled
    // sender doesn't silently no-op waiting for someone to hand-patch the JSONB.
    CRON_SENDER_EMAIL: z.preprocess(emptyStringAsUndefined, z.string().email().optional()),
    // Comma-separated email allowlist gating the /admin panel. A deploy-time
    // value (must NOT be self-editable from inside the app), kept in env rather
    // than the DB precisely so a DB write can never grant admin. Empty/unset =>
    // nobody is an admin (the panel 404s for everyone).
    ADMIN_EMAIL_ALLOWLIST: z.preprocess(emptyStringAsUndefined, z.string().optional()),
  })
  // SUPABASE_SERVER_URL is NOT a required input — it is DERIVED here from
  // SUPABASE_INTERNAL_URL (when set) else NEXT_PUBLIC_SUPABASE_URL. So
  // parseServerEnv succeeds with only the public URL present (see env.test.ts).
  .transform((env) => ({
    ...env,
    SUPABASE_SERVER_URL: env.SUPABASE_INTERNAL_URL ?? env.NEXT_PUBLIC_SUPABASE_URL,
  }));

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

function formatEnvIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

type EnvRecord = Record<string, string | undefined>;

export function parsePublicEnv(env: EnvRecord): PublicEnv {
  const parsed = publicEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid public env: ${formatEnvIssues(parsed.error)}`);
  }

  return parsed.data;
}

export function parseServerEnv(env: EnvRecord): ServerEnv {
  const parsed = serverEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid server env: ${formatEnvIssues(parsed.error)}`);
  }

  return parsed.data;
}

export function getPublicEnv(): PublicEnv {
  // Read each NEXT_PUBLIC_* var directly so Next.js inlines its value into the
  // client bundle at build time. Passing `process.env` wholesale would not be
  // inlined and would be empty in the browser (see Next.js env handling).
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}

/**
 * The admin email allowlist, parsed from `ADMIN_EMAIL_ALLOWLIST`: comma-split,
 * trimmed, lowercased, blanks dropped. Returns `[]` when unset, so an empty
 * allowlist makes nobody an admin. Compare against a user's email lowercased
 * (see `isAdminEmail`).
 */
export function getAdminEmails(env: EnvRecord = process.env): string[] {
  const raw = env.ADMIN_EMAIL_ALLOWLIST;
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '');
}

/**
 * Loopback hosts that identify the local Supabase dev stack. Includes both the
 * bracketed and bare IPv6 loopback forms: the WHATWG URL parser used by Node
 * yields `[::1]` for `URL.hostname`, but bare `::1` is included too so the gate
 * holds regardless of the runtime's host-serialisation.
 */
const LOCAL_SUPABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True only when `url` points at the local Supabase dev stack (loopback host). */
function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_SUPABASE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Dev-only mock authentication toggle. Triple-gated, so the `/auth/mock`
 * backdoor (which signs in a seeded user with a hard-coded password) can never
 * be activated against shared infrastructure:
 *   1. NODE_ENV must not be `production` (Vercel sets NODE_ENV=production),
 *   2. `AUTH_MOCK_ENABLED` must be explicitly `true`, and
 *   3. NEXT_PUBLIC_SUPABASE_URL must point at the local stack (loopback host),
 *      so a staging/self-hosted deploy aimed at a remote Supabase project
 *      (e.g. `*.supabase.co`) cannot enable it even if the flag is set.
 * When true, `/login` offers a dev sign-in and `/auth/mock` establishes a
 * session for a seeded local test user — no Microsoft round-trip.
 */
export function isAuthMockEnabled(env: EnvRecord = process.env): boolean {
  return (
    env.NODE_ENV !== 'production' &&
    env.AUTH_MOCK_ENABLED === 'true' &&
    isLocalSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)
  );
}

/**
 * Dev-only mock Telnyx-dialler toggle for AMD "Mode B" (PHASE_4_SPEC §7).
 * Triple-gated identically to {@link isAuthMockEnabled}, so the mock backend —
 * which fabricates call events with no real telephony — can never run against
 * shared infrastructure:
 *   1. NODE_ENV must not be `production`,
 *   2. `DIALLER_MOCK_ENABLED` must be explicitly `true`, and
 *   3. NEXT_PUBLIC_SUPABASE_URL must point at the local stack (loopback host).
 * When true, `createAmdRuntime()` selects the in-process MockTelnyxBackend and
 * the webhook route accepts mock-originated events without a Telnyx signature.
 */
export function isDiallerMockEnabled(env: EnvRecord = process.env): boolean {
  return (
    env.NODE_ENV !== 'production' &&
    env.DIALLER_MOCK_ENABLED === 'true' &&
    isLocalSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)
  );
}

/**
 * Dev-only gate for the mock email path (PHASE_5_SPEC §9): the "simulate
 * reply/bounce" affordance is inert unless we're non-prod, on the `mock`
 * driver, and pointed at the local stack. Unlike the auth/dialler gates this
 * keys off EMAIL_DRIVER (not a separate flag), since a real Graph driver must
 * never be simulated against.
 *
 * Scoped to `mock` only (NOT `mailpit`): the simulator enqueues onto the
 * process-global dev inbox, and only MockDriver.fetchReplies drains that queue.
 * MailpitDriver.fetchReplies reads Mailpit's real REST API, so under mailpit
 * the simulate buttons would report success while scans never see the message —
 * an honest gate refuses them there (use a real round-trip via Mailpit instead).
 * An UNSET EMAIL_DRIVER counts as `mock` to mirror the driver factory's default
 * (getServerEnv defaults it to `mock`), so the simulator works in a bare local setup.
 */
export function isEmailMockEnabled(env: EnvRecord = process.env): boolean {
  return (
    env.NODE_ENV !== 'production' &&
    (env.EMAIL_DRIVER ?? 'mock') === 'mock' &&
    isLocalSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)
  );
}
