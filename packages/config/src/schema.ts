import { z } from 'zod';

/**
 * Every environment variable a Chatlium process reads.
 *
 * Error messages name variables but never echo any value (see load.ts), so
 * secrets such as DATABASE_URL and SESSION_SEALING_KEY cannot leak through them.
 * The Gemini API key itself is not configuration: processes receive only the
 * Secrets Manager secret ID and fetch the value at runtime.
 */

const url = (protocols: readonly string[]) =>
  z.url({
    protocol: new RegExp(`^(${protocols.join('|')})$`),
    error: `must be a URL with protocol ${protocols.map((p) => `${p}://`).join(' or ')}`,
  });

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'], {
      error: 'must be one of: development, test, production',
    })
    .default('development'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'], {
      error: 'must be one of: trace, debug, info, warn, error, fatal',
    })
    .default('info'),

  /** Public base URL of the web app, used to build the OIDC callback URL. */
  APP_BASE_URL: url(['http', 'https']),

  /** Application database connection (role chatlium_app, never a superuser). */
  DATABASE_URL: url(['postgres', 'postgresql']),
  REDIS_URL: url(['redis', 'rediss']),

  AWS_REGION: z
    .string({ error: 'is required' })
    .regex(/^[a-z]{2}(-[a-z]+)+-\d$/, { error: 'must be an AWS region such as us-east-1' }),
  /** Set only for local emulation (Floci). Unset in AWS. */
  AWS_ENDPOINT_URL: url(['http', 'https']).optional(),

  COGNITO_USER_POOL_ID: z
    .string({ error: 'is required' })
    .regex(/^[a-z]{2}(-[a-z]+)+-\d_[0-9A-Za-z]+$/, {
      error: 'must be a user pool ID such as us-east-1_AbC123',
    }),
  COGNITO_CLIENT_ID: z.string({ error: 'is required' }).min(1, { error: 'must not be empty' }),
  /** App client secret. Server-side only: sent to the token endpoint, never to a browser (ADR 0004). */
  COGNITO_CLIENT_SECRET: z.string({ error: 'is required' }).min(1, { error: 'must not be empty' }),
  /** Expected `iss` claim. Explicit because Floci and AWS issue different issuer hosts. */
  COGNITO_ISSUER: url(['http', 'https']),

  /** Key for sealing the session cookie. At least 32 characters. */
  SESSION_SEALING_KEY: z
    .string({ error: 'is required' })
    .min(32, { error: 'must be at least 32 characters' }),

  /** Secrets Manager secret ID holding the platform Gemini API key (not the key itself). */
  GEMINI_API_KEY_SECRET_ID: z
    .string({ error: 'is required' })
    .min(1, { error: 'must not be empty' }),
});

export type Config = Readonly<z.infer<typeof envSchema>>;
