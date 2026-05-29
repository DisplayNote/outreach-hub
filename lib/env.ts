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
 * Dev-only mock authentication toggle. Double-gated: it requires both a
 * non-production NODE_ENV and an explicit `AUTH_MOCK_ENABLED=true`, so it can
 * never be switched on in a production deployment (Vercel sets
 * NODE_ENV=production, and the flag is only ever written into local
 * `.env.local`). When true, `/login` offers a dev sign-in and `/auth/mock`
 * establishes a session for a seeded local test user — no Microsoft round-trip.
 */
export function isAuthMockEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.AUTH_MOCK_ENABLED === 'true';
}
