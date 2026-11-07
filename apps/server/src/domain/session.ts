import { randomBytes, randomUUID } from 'node:crypto';

export interface GuestSession {
  playerId: string;
  token: string;
  username: string;
}

export function createGuestSession(username: string): GuestSession {
  return { playerId: randomUUID(), token: randomBytes(32).toString('hex'), username };
}
