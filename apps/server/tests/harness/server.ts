import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRealtimeServer, type RaceTextSource, type RealtimeOptions, type RealtimeServer } from '../../src/realtime/gateway.js';

/** Fast timings so a full race lifecycle completes in well under a second. */
export const FAST_TEST_OPTIONS: Omit<RealtimeOptions, 'textProvider'> = {
  countdownMs: 150,
  raceLimitMs: 10_000,
  disconnectGraceMs: 400,
  tickIntervalMs: 50,
  joinRateLimit: { limit: 10_000, windowMs: 60_000 },
  corsOrigin: 'http://localhost',
};

export interface TestServer extends RealtimeServer {
  url: string;
  options: RealtimeOptions;
}

/** Hands out the given texts in order, cycling. Keeps races deterministic. */
export function fixedTexts(...texts: [string, ...string[]]): RaceTextSource {
  let next = 0;
  return {
    getRaceText: () => {
      const text = texts[next % texts.length] ?? texts[0];
      next += 1;
      return text;
    },
  };
}

/** Boots the real Socket.IO gateway on an ephemeral localhost port, without Express or PostgreSQL. */
export async function startTestServer(overrides: Partial<RealtimeOptions> = {}): Promise<TestServer> {
  const options: RealtimeOptions = { ...FAST_TEST_OPTIONS, textProvider: fixedTexts('go far'), ...overrides };
  const httpServer = createServer();
  const realtime = createRealtimeServer(httpServer, options);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  return { ...realtime, url: `http://127.0.0.1:${port}`, options };
}
