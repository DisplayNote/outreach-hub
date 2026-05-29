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
  return parsePublicEnv(process.env);
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
