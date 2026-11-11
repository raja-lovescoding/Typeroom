import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_EVENTS, SERVER_EVENTS, type RaceProgressPayload } from '@typeroom/shared';
import { fixedTexts, RaceClient, RaceClientError, startTestServer, type TestServer } from './harness/index.js';
import type { RealtimeOptions } from '../src/realtime/gateway.js';

const { ROOM_STATE, RACE_COUNTDOWN, RACE_PROGRESS, RACE_RESULTS } = SERVER_EVENTS;

let server: TestServer | undefined;
let clients: RaceClient[] = [];

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  clients = [];
  await server?.close();
  server = undefined;
});

async function boot(overrides: Partial<RealtimeOptions> = {}): Promise<TestServer> {
  server = await startTestServer(overrides);
  return server;
}

async function connect(username: string): Promise<RaceClient> {
  if (!server) throw new Error('boot() first');
  const client = await RaceClient.connect(server.url, username);
  clients.push(client);
  return client;
}

/** Host creates a room, guest joins, host starts; resolves once the race is live for both. */
async function raceInProgress(text: string): Promise<{ host: RaceClient; guest: RaceClient; code: string }> {
  const host = await connect('Host');
  const guest = await connect('Guest');
  const { room } = await host.createRoom();
  await guest.joinRoom(room.code);
  await host.startRace();
  await host.waitFor(RACE_PROGRESS, (payload) => payload.text === text);
  await guest.waitFor(RACE_PROGRESS, (payload) => payload.text === text);
  return { host, guest, code: room.code };
}

function playerIn(payload: RaceProgressPayload, playerId: string | undefined) {
  const player = payload.players.find((item) => item.playerId === playerId);
  if (!player) throw new Error(`player ${playerId} missing from progress`);
  return player;
}

describe('realtime gateway (Socket.IO integration)', () => {
  it('runs create → join → countdown → race → results → race again for two clients', async () => {
    await boot({ textProvider: fixedTexts('go far', 'be kind') });
    const host = await connect('Host');
    const guest = await connect('Guest');

    const created = await host.createRoom();
    expect(created.room.state).toBe('LOBBY');
    expect(created.token).toMatch(/^[0-9a-f]{64}$/);

    const joined = await guest.joinRoom(created.room.code);
    expect(joined.room.players.map((player) => player.username)).toEqual(['Host', 'Guest']);
    await host.waitFor(ROOM_STATE, (state) => state.players.length === 2);

    // Only the host may start.
    await expect(guest.startRace()).rejects.toThrow(RaceClientError);

    await host.startRace();
    for (const client of [host, guest]) {
      const countdown = await client.waitFor(RACE_COUNTDOWN);
      expect(countdown).toEqual({
        startsInMs: server!.options.countdownMs,
        text: 'go far',
        config: { mode: 'words', count: 25, punctuation: false },
        timeLimitMs: server!.options.raceLimitMs,
      });
      await client.waitFor(ROOM_STATE, (state) => state.state === 'COUNTDOWN');
    }

    // Keystrokes during the countdown are ignored.
    host.keystroke('g', 0);

    // Late joiners are refused once the race is under way.
    const late = await connect('Late');
    await expect(late.joinRoom(created.room.code)).rejects.toThrow('Room is not accepting players');

    const firstTick = await guest.waitFor(RACE_PROGRESS);
    expect(firstTick.text).toBe('go far');
    expect(firstTick.players.every((player) => player.position === 0 && player.status === 'racing')).toBe(true);

    await host.type('go far');
    await guest.waitFor(RACE_PROGRESS, (payload) => playerIn(payload, host.playerId).status === 'finished');
    await guest.type('go far');

    for (const client of [host, guest]) {
      const { results } = await client.waitFor(RACE_RESULTS);
      expect(results.map((result) => [result.rank, result.username])).toEqual([[1, 'Host'], [2, 'Guest']]);
      for (const result of results) {
        expect(result.accuracy).toBe(100);
        expect(result.finishTimeMs).not.toBeNull();
        expect(result.wpm).toBeGreaterThan(0);
      }
    }
    expect(server!.inspect().timers.total).toBe(0);

    // Race again: back to the lobby with the same players, then a fresh race with the next text.
    const beforeAgain = host.mark();
    await host.raceAgain();
    for (const client of [host, guest]) {
      await client.waitFor(ROOM_STATE, (state) => state.state === 'LOBBY' && state.players.length === 2, { after: beforeAgain });
    }
    await host.startRace();
    const secondCountdown = await guest.waitFor(RACE_COUNTDOWN, () => true, { after: beforeAgain });
    expect(secondCountdown.text).toBe('be kind');
    await host.waitFor(RACE_PROGRESS, (payload) => payload.text === 'be kind', { after: beforeAgain });
    expect(host.latestSelf()).toMatchObject({ position: 0, status: 'racing' });

    await guest.type('be kind');
    await host.waitFor(RACE_PROGRESS, (payload) => playerIn(payload, guest.playerId).status === 'finished', { after: beforeAgain });
    await host.type('be kind');
    const second = await host.waitFor(RACE_RESULTS, () => true, { after: beforeAgain });
    expect(second.results.map((result) => result.username)).toEqual(['Guest', 'Host']);

    // Session tokens are secrets: they must never appear in anything broadcast to clients.
    const broadcast = JSON.stringify([...host.events, ...guest.events].map((item) => item.payload));
    expect(broadcast).not.toContain(host.token);
    expect(broadcast).not.toContain(guest.token);
  });

  it('ignores impossible, inflated and malformed positions from a client', async () => {
    await boot({ textProvider: fixedTexts('abcdef') });
    const { host, guest } = await raceInProgress('abcdef');

    host.keystroke('f', 5); // skip ahead to the last character
    host.keystroke('a', 6); // past the end of the text
    host.keystroke('b', 1_000_000);
    host.emitRaw(CLIENT_EVENTS.KEYSTROKE, { char: 'a', index: 0, position: 6 }); // extra field: strict schema
    host.emitRaw(CLIENT_EVENTS.KEYSTROKE, { char: 'a', index: -1 });
    host.emitRaw(CLIENT_EVENTS.KEYSTROKE, { char: 'abcdef', index: 0 });
    host.emitRaw(CLIENT_EVENTS.KEYSTROKE, { char: 'a', index: 0.5 });
    host.emitRaw(CLIENT_EVENTS.KEYSTROKE, 'abcdef');
    let progress = await guest.nextProgress(2);
    expect(playerIn(progress, host.playerId)).toMatchObject({ position: 0, status: 'racing', accuracy: 100 });

    // A wrong character at the right index costs accuracy but never advances the caret.
    host.keystroke('z', 0);
    host.keystroke('a', 0);
    host.keystroke('b', 1);
    host.keystroke('b', 1); // replay of an already-accepted index
    progress = await guest.nextProgress(2);
    expect(playerIn(progress, host.playerId)).toMatchObject({ position: 2, accuracy: 67 });

    // A client cannot move anyone else.
    expect(playerIn(progress, guest.playerId).position).toBe(0);
  });

  it('caps a burst of keystrokes so a client cannot teleport through the text', async () => {
    const text = 'the quick brown fox jumps over the lazy dog again';
    await boot({ textProvider: fixedTexts(text) });
    const { host, guest } = await raceInProgress(text);

    await host.type(text); // every character at once, all correct and in order
    const progress = await guest.nextProgress(2);
    const position = playerIn(progress, host.playerId).position;
    expect(position).toBe(25);
    expect(playerIn(progress, host.playerId).status).toBe('racing');
  });

  it('resumes the same position when a racer reconnects within the grace window', async () => {
    await boot({ textProvider: fixedTexts('steady hands'), disconnectGraceMs: 5_000 });
    const { host, guest } = await raceInProgress('steady hands');

    await host.type('stea');
    await guest.waitFor(RACE_PROGRESS, (payload) => playerIn(payload, host.playerId).position === 4);
    const playerId = host.playerId;

    await host.disconnect();
    const dropped = await guest.waitFor(RACE_PROGRESS, (payload) => playerIn(payload, playerId).status === 'disconnected');
    expect(playerIn(dropped, playerId)).toMatchObject({ connected: false, position: 4 });
    await guest.waitFor(ROOM_STATE, (state) => state.players.some((player) => player.playerId === playerId && !player.connected));
    expect(server!.inspect().timers.disconnect).toBe(1);

    const beforeRejoin = guest.mark();
    const rejoined = await host.reconnect();
    expect(rejoined.playerId).toBe(playerId);
    expect(rejoined.room.state).toBe('RACING');
    expect(server!.inspect().timers.disconnect).toBe(0);
    const resumed = await guest.waitFor(
      RACE_PROGRESS,
      (payload) => playerIn(payload, playerId).status === 'racing' && playerIn(payload, playerId).connected,
      { after: beforeRejoin },
    );
    expect(playerIn(resumed, playerId).position).toBe(4);

    // The position was not reset: restarting from index 0 is rejected, continuing from 4 is accepted.
    host.keystroke('s', 0);
    await host.type('dy hands', 4);
    await guest.type('steady hands');

    const { results } = await guest.waitFor(RACE_RESULTS);
    const hostResult = results.find((result) => result.playerId === playerId);
    expect(hostResult).toMatchObject({ accuracy: 100 });
    expect(hostResult?.finishTimeMs).not.toBeNull();
  });

  it('marks a racer DNF once the grace window passes and refuses their keystrokes after rejoining', async () => {
    await boot({ textProvider: fixedTexts('slow and steady'), disconnectGraceMs: 300 });
    const { host, guest } = await raceInProgress('slow and steady');

    await guest.type('sl');
    await host.waitFor(RACE_PROGRESS, (payload) => playerIn(payload, guest.playerId).position === 2);
    const disconnectedAt = Date.now();
    await guest.disconnect();

    const dnf = await host.waitFor(RACE_PROGRESS, (payload) => playerIn(payload, guest.playerId).status === 'dnf');
    expect(Date.now() - disconnectedAt).toBeGreaterThanOrEqual(250);
    expect(playerIn(dnf, guest.playerId).position).toBe(2);

    // Coming back late reattaches the session but does not revive the racer.
    await guest.reconnect();
    guest.keystroke('o', 2);
    const after = await host.nextProgress(2);
    expect(playerIn(after, guest.playerId)).toMatchObject({ status: 'dnf', position: 2, connected: true });

    await host.type('slow and steady');
    const { results } = await host.waitFor(RACE_RESULTS);
    expect(results.map((result) => [result.username, result.finishTimeMs === null])).toEqual([['Host', false], ['Guest', true]]);
  });

  it('ends the race when the last unfinished racer drops and never returns', async () => {
    await boot({ textProvider: fixedTexts('done') });
    const { host, guest } = await raceInProgress('done');

    await host.type('done');
    await guest.waitFor(RACE_PROGRESS, (payload) => playerIn(payload, host.playerId).status === 'finished');
    await guest.disconnect();

    const { results } = await host.waitFor(RACE_RESULTS, () => true, { timeoutMs: 2_000 });
    expect(results[1]).toMatchObject({ username: 'Guest', finishTimeMs: null });
    expect(server!.inspect().timers.total).toBe(0);
  });

  describe('cleanup', () => {
    it('clears every room, bot and disconnect timer when the host leaves mid-race', async () => {
      await boot({ disconnectGraceMs: 10_000 });
      const host = await connect('Host');
      const guest = await connect('Guest');
      const { room } = await host.createRoom({ bot: { targetWpm: 40 } });
      await guest.joinRoom(room.code);
      await host.startRace();
      await host.waitFor(RACE_PROGRESS);
      await guest.disconnect();
      await vi.waitFor(() => expect(server!.inspect().timers).toMatchObject({ tick: 1, finish: 1, disconnect: 1, bot: 1 }));

      host.leave();
      await vi.waitFor(() => expect(server!.inspect()).toMatchObject({ rooms: 0, timers: { total: 0 } }));

      // Nothing keeps ticking for the departed room.
      const cursor = host.mark();
      await new Promise((resolve) => setTimeout(resolve, server!.options.tickIntervalMs * 3));
      expect(host.received(RACE_PROGRESS, cursor)).toHaveLength(0);
    });

    it('cancels pending disconnect timers when the race hits its time limit, with no progress after results', async () => {
      await boot({ raceLimitMs: 400, disconnectGraceMs: 10_000 });
      const { host, guest } = await raceInProgress('go far');
      await guest.disconnect();
      await vi.waitFor(() => expect(server!.inspect().timers.disconnect).toBe(1));

      const { results } = await host.waitFor(RACE_RESULTS);
      expect(results.every((result) => result.finishTimeMs === null)).toBe(true);
      expect(server!.inspect()).toMatchObject({ rooms: 1, timers: { total: 0 } });

      const cursor = host.mark();
      await new Promise((resolve) => setTimeout(resolve, server!.options.tickIntervalMs * 3));
      expect(host.received(RACE_PROGRESS, cursor)).toHaveLength(0);
    });

    it('releases every Node timer when the server shuts down mid-race', async () => {
      const activeTimeouts = () => process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
      const baseline = activeTimeouts();

      await boot({ disconnectGraceMs: 10_000 });
      const host = await connect('Host');
      const guest = await connect('Guest');
      const { room } = await host.createRoom({ bot: { targetWpm: 60 } });
      await guest.joinRoom(room.code);
      await host.startRace();
      await host.waitFor(RACE_PROGRESS);
      await guest.disconnect();
      await vi.waitFor(() => expect(server!.inspect().timers.disconnect).toBe(1));
      expect(activeTimeouts()).toBeGreaterThan(baseline);

      await Promise.all(clients.map((client) => client.close()));
      clients = [];
      await server!.close();
      expect(server!.inspect()).toMatchObject({ rooms: 0, sessions: 0, timers: { total: 0 } });
      server = undefined;
      await vi.waitFor(() => expect(activeTimeouts()).toBeLessThanOrEqual(baseline));
    });
  });
});
