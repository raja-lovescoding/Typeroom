import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_EVENTS, SERVER_EVENTS, type RaceConfig } from '@typeroom/shared';
import { fixedTexts, RaceClient, RaceClientError, startTestServer, type TestServer } from './harness/index.js';
import type { RealtimeOptions } from '../src/realtime/gateway.js';

const { ROOM_STATE, ROOM_CLOSED, RACE_COUNTDOWN, RACE_PROGRESS, RACE_RESULTS } = SERVER_EVENTS;

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

describe('race modes', () => {
  it('lets only the host change the mode, only in the lobby, and broadcasts it', async () => {
    const texts = fixedTexts('go far');
    await boot({ textProvider: texts });
    const host = await connect('Host');
    const guest = await connect('Guest');
    const { room } = await host.createRoom({ config: { mode: 'quote', length: 'short' } });
    expect(room.config).toEqual({ mode: 'quote', length: 'short' });
    expect(room.hostPlayerId).toBe(host.playerId);
    const joined = await guest.joinRoom(room.code);
    expect(joined.room.config).toEqual({ mode: 'quote', length: 'short' });

    const timeMode: RaceConfig = { mode: 'time', seconds: 30, punctuation: true };
    await host.setConfig(timeMode);
    await guest.waitFor(ROOM_STATE, (state) => state.config.mode === 'time');

    await expect(guest.setConfig({ mode: 'words', count: 10, punctuation: false })).rejects.toThrow('Only the host');
    for (const bad of [{ mode: 'time', seconds: 45 }, { mode: 'words', count: 10, cheat: true }, { mode: 'custom', text: 'café' }, 'words']) {
      expect(await host.requestRaw(CLIENT_EVENTS.SET_RACE_CONFIG, { config: bad })).toEqual({ error: 'Invalid race mode' });
    }

    await host.startRace();
    const countdown = await guest.waitFor(RACE_COUNTDOWN);
    expect(countdown.config).toEqual(timeMode);
    expect(countdown.timeLimitMs).toBe(30_000);
    expect(texts.requests).toEqual([timeMode]);
    await expect(host.setConfig({ mode: 'words', count: 10, punctuation: false })).rejects.toThrow('only be changed in the lobby');
  });

  it('races on the host’s custom text, normalised to plain keyboard characters', async () => {
    const texts = fixedTexts('never used');
    await boot({ textProvider: texts });
    const host = await connect('Host');
    const guest = await connect('Guest');
    const { room } = await host.createRoom({ config: { mode: 'custom', text: '  It’s   “ours” — ok\n' } });
    expect(room.config).toEqual({ mode: 'custom', text: 'It\'s "ours" - ok' });
    await guest.joinRoom(room.code);
    await host.startRace();

    const countdown = await guest.waitFor(RACE_COUNTDOWN);
    expect(countdown.text).toBe('It\'s "ours" - ok');
    expect(countdown.source).toBeUndefined();
    expect(texts.requests).toEqual([]);

    await guest.waitFor(RACE_PROGRESS);
    await host.type(countdown.text);
    await guest.type(countdown.text);
    const { results } = await host.waitFor(RACE_RESULTS);
    expect(results.every((result) => result.finishTimeMs !== null && result.accuracy === 100)).toBe(true);
  });

  it('passes the quote attribution through to every racer', async () => {
    await boot({
      textProvider: { getRaceText: () => ({ text: 'be brief', source: 'Typeroom original' }) },
    });
    const host = await connect('Host');
    const guest = await connect('Guest');
    const { room } = await host.createRoom({ config: { mode: 'quote', length: 'short' } });
    await guest.joinRoom(room.code);
    await host.startRace();
    for (const client of [host, guest]) {
      expect(await client.waitFor(RACE_COUNTDOWN)).toMatchObject({ text: 'be brief', source: 'Typeroom original' });
    }
  });

  it('gives untimed races a limit long enough for slow typists', async () => {
    await boot({ textProvider: fixedTexts('x'.repeat(500)), minRaceWpm: 20, raceLimitMs: 1_000 });
    const host = await connect('Host');
    await host.createRoom();
    await host.startRace();
    // 500 characters = 100 words; at 20 WPM that is five minutes.
    expect((await host.waitFor(RACE_COUNTDOWN)).timeLimitMs).toBe(300_000);
    host.leave();
  });
});

describe('nicknames over the wire', () => {
  it('rejects blocked and malformed nicknames with a specific reason', async () => {
    await boot();
    const client = await connect('placeholder');
    expect(await client.requestRaw(CLIENT_EVENTS.CREATE_ROOM, { username: 'Sh1t Head' })).toEqual({
      error: 'That nickname is not allowed. Please choose another.',
    });
    expect(await client.requestRaw(CLIENT_EVENTS.CREATE_ROOM, { username: '<img onerror=x>' })).toEqual({
      error: 'Use letters, numbers, spaces, _ . or -',
    });
    expect(await client.requestRaw(CLIENT_EVENTS.CREATE_ROOM, { username: 'x' })).toMatchObject({ error: expect.stringContaining('at least') });

    const { room } = await (await connect('Host')).createRoom();
    expect(await client.requestRaw(CLIENT_EVENTS.JOIN_ROOM, { username: 'f.u.c.k', code: room.code })).toEqual({
      error: 'That nickname is not allowed. Please choose another.',
    });
    expect(server!.inspect().rooms).toBe(1);
  });

  it('stores the normalised nickname that everyone else sees', async () => {
    await boot();
    const host = await RaceClient.connect(server!.url, '  Ada    Lovelace ');
    clients.push(host);
    const { room } = await host.createRoom();
    expect(room.players[0]?.username).toBe('Ada Lovelace');
  });
});

describe('room lifecycle', () => {
  it('tells everyone when the host leaves and the room closes', async () => {
    await boot();
    const host = await connect('Host');
    const guest = await connect('Guest');
    const { room } = await host.createRoom();
    await guest.joinRoom(room.code);

    host.leave();
    expect(await guest.waitFor(ROOM_CLOSED)).toEqual({ code: room.code, reason: 'host_left' });
    expect(server!.inspect().rooms).toBe(0);
    await expect(guest.request(CLIENT_EVENTS.START_RACE, {})).rejects.toThrow(RaceClientError);
  });

  it('a guest leaving keeps the room open and updates the roster', async () => {
    await boot();
    const host = await connect('Host');
    const guest = await connect('Guest');
    const { room } = await host.createRoom();
    await guest.joinRoom(room.code);
    const cursor = host.mark();
    guest.leave();
    const state = await host.waitFor(ROOM_STATE, (payload) => payload.players.length === 1, { after: cursor });
    expect(state.players.map((player) => player.username)).toEqual(['Host']);
    expect(server!.inspect().rooms).toBe(1);
  });

  it('closes rooms nobody is connected to after the idle window, and forgets their sessions', async () => {
    await boot({ roomIdleMs: 1_000 });
    const host = await connect('Host');
    const guest = await connect('Guest');
    const { room } = await host.createRoom();
    await guest.joinRoom(room.code);

    await guest.disconnect();
    await host.waitFor(ROOM_STATE, (state) => state.players.some((player) => !player.connected));
    const now = Date.now();
    server!.sweep(now + 5_000);
    expect(server!.inspect().rooms).toBe(1); // the host is still here

    await host.disconnect();
    // Socket.IO drops the socket and runs our disconnect handler in the same tick.
    await vi.waitFor(() => expect(server!.io.of('/').sockets.size).toBe(0));
    server!.sweep(now); // starts the idle clock
    server!.sweep(now + 999);
    expect(server!.inspect().rooms).toBe(1);
    server!.sweep(now + 1_000);
    expect(server!.inspect()).toMatchObject({ rooms: 0, sessions: 0, timers: { total: 0 } });
  });

  it('lets a lobby player reconnect with their token and keep their seat', async () => {
    await boot();
    const host = await connect('Host');
    const guest = await connect('Guest');
    const { room } = await host.createRoom();
    await guest.joinRoom(room.code);
    const before = guest.playerId;
    await guest.disconnect();
    await host.waitFor(ROOM_STATE, (state) => state.players.some((player) => player.playerId === before && !player.connected));
    const rejoined = await guest.reconnect();
    expect(rejoined.playerId).toBe(before);
    expect(rejoined.room.players).toHaveLength(2);
    expect(rejoined.room.players.every((player) => player.connected)).toBe(true);
  });

  it('gives a player who is offline when the race starts the grace window, then DNF', async () => {
    await boot({ textProvider: fixedTexts('ok'), disconnectGraceMs: 200 });
    const host = await connect('Host');
    const guest = await connect('Guest');
    const { room } = await host.createRoom();
    await guest.joinRoom(room.code);
    await guest.disconnect();
    await host.waitFor(ROOM_STATE, (state) => state.players.some((player) => !player.connected));

    await host.startRace();
    await host.waitFor(RACE_PROGRESS);
    await host.type('ok');
    const { results } = await host.waitFor(RACE_RESULTS);
    expect(results.map((result) => [result.username, result.finishTimeMs === null])).toEqual([['Host', false], ['Guest', true]]);
    expect(server!.inspect().timers.total).toBe(0);
  });

  it('moves a player out of their old room when they join another', async () => {
    await boot();
    const first = await connect('First');
    const second = await connect('Second');
    const roamer = await connect('Roamer');
    const a = await first.createRoom();
    const b = await second.createRoom();
    await roamer.joinRoom(a.room.code);
    await first.waitFor(ROOM_STATE, (state) => state.players.length === 2);
    const cursor = first.mark();
    await roamer.joinRoom(b.room.code);
    await first.waitFor(ROOM_STATE, (state) => state.players.length === 1, { after: cursor });
  });
});
