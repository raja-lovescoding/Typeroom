import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('postgres://typeroom:typeroom@localhost:5433/typeroom'),
  DISCONNECT_GRACE_MS: z.coerce.number().int().positive().default(20_000),
  /**
   * Set to true only when the server sits behind a reverse proxy you control (the bundled nginx).
   * The client address used for rate limiting is then read from X-Forwarded-For; without a proxy
   * that header is client-controlled and must be ignored.
   */
  TRUST_PROXY: booleanFlag,
  /** Rooms with no connected human are closed after this long. */
  ROOM_IDLE_MS: z.coerce.number().int().positive().default(10 * 60_000),
});

export const env = envSchema.parse(process.env);
