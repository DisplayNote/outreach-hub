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
  })
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
