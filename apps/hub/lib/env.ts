import { z } from 'zod';

const subscriptionTierSchema = z.enum(['free', 'starter', 'pro', 'enterprise']);

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),

    /** PostgreSQL connection string — required on Fly.io, optional locally */
    DATABASE_URL: z.string().min(1).optional(),

    /** json = file store (local default), postgres = DATABASE_URL required */
    STORE_DRIVER: z.enum(['json', 'postgres']).default('json'),

    AUTH_SECRET: z.string().min(16),
    AUTH_URL: z.string().url().optional(),
    AUTH_GOOGLE_ID: z.string().min(1),
    AUTH_GOOGLE_SECRET: z.string().min(1),

    ADMIN_SECRET: z.string().min(8),
    ADMIN_EMAILS: z.string().default(''),

    NEXT_PUBLIC_DASHBOARD_REMOTE: z
      .string()
      .url()
      .default('http://localhost:3001/remoteEntry.js'),

    NEXT_PUBLIC_CALENDAR_REMOTE: z
      .string()
      .url()
      .default('http://localhost:3003/remoteEntry.js')
      .optional(),

    NEXT_PUBLIC_NOTES_REMOTE: z
      .string()
      .url()
      .default('http://localhost:3004/remoteEntry.js')
      .optional(),

    NEXT_PUBLIC_CANVAS_REMOTE: z
      .string()
      .url()
      .default('http://localhost:3008/remoteEntry.js')
      .optional(),

    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORE_DRIVER === 'postgres' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        message:
          'DATABASE_URL is required when STORE_DRIVER=postgres. On Fly.io: fly secrets set DATABASE_URL=... Locally: use docker compose or a hosted Postgres URL.',
        path: ['DATABASE_URL'],
      });
    }

    if (env.NODE_ENV === 'production' && env.STORE_DRIVER === 'json') {
      ctx.addIssue({
        code: 'custom',
        message:
          'STORE_DRIVER=json is not allowed in production. Set STORE_DRIVER=postgres and provide DATABASE_URL.',
        path: ['STORE_DRIVER'],
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  cached = parsed.data;
  return cached;
}

export function getAdminEmails(): Set<string> {
  const env = getEnv();
  return new Set(
    env.ADMIN_EMAILS.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getStoreDriver(): 'json' | 'postgres' {
  return process.env.STORE_DRIVER === 'postgres' ? 'postgres' : 'json';
}

export function isPostgresStore(): boolean {
  return getStoreDriver() === 'postgres';
}
