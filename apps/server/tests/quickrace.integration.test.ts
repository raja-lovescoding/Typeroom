import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_EVENTS, SERVER_EVENTS } from '@typeroom/shared';
import { fixedTexts, RaceClient, RaceClientError, startTestServer, type TestServer } from './harness/index.js';
import type { RealtimeOptions, RecordedRace } from '../src/realtime/gateway.js';
import { InMemoryRatingStore } from '../src/services/ratingStore.js';

const { QUEUE_UPDATE, QUEUE_CLOSED, RACE_COUNTDOWN, RACE_PROGRESS, RACE_RESULTS } = SERVER_EVENTS;

let server: TestServer | undefined;
let clients: RaceClient[] = [];

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  clients = [];
  await server?.close();
  server = undefined;
});

/** Always the same value: one ghost for a lone human, ghosts at exactly their base speed. */
const steady = { next: () => 0 } as const;

async function boot(overrides: Partial<RealtimeOptions> = {}): Promise<TestServer> {
  server = await startTestServer({ random: steady, ...overrides });
  return server;
}

async function connect(username: string): Promise<RaceClient> {
  if (!server) throw new Error('boot() first');
  const client = await RaceClient.connect(server.url, username);
  clients.push(client);
  return client;
}

describe('Quick Race matchmaking (Socket.IO integration)', () => {
  it('matches two humans, races them with no ghosts, and records the race', async () => {
    const recorded: RecordedRace[] = [];
    const ratings = new InMemoryRatingStore();
    await boot({ textProvider: fixedTexts('go far'), recordRace: (race) => recorded.push(race), ratings });
    const ada = await connect('Ada');
    const bo = await connect('Bo');

    const first = await ada.queueJoin();
    expect(first.queue).toMatchObject({ band: '40-70', seatsFilled: 1, maxSeats: 5, config: { mode: 'words', count: 25 } });
    expect(first.queue?.msLeft).toBeGreaterThan(0);
    const second = await bo.queueJoin();
    expect(second.queue?.lobbyId).toBe(first.queue?.lobbyId);
    const update = await ada.waitFor(QUEUE_UPDATE, (payload) => payload.seatsFilled === 2);
    expect(update.racers.map((racer) => racer.username)).toEqual(['Ada', 'Bo']);
    // The seat list never leaks session tokens.
    expect(JSON.stringify(update)).not.toContain(ada.token);

    const [matchA, matchB] = await Promise.all([ada.waitForMatch(), bo.waitForMatch()]);
    expect(matchA.room.code).toBe(matchB.room.code);
    expect(matchA.room).toMatchObject({ kind: 'quick', state: 'LOBBY' });
    expect(matchA.room.players.map((player) => [player.username, player.isGhost])).toEqual([['Ada', false], ['Bo', false]]);

    for (const client of [ada, bo]) {
      await client.waitFor(RACE_COUNTDOWN, (countdown) => countdown.text === 'go far');
      await client.waitFor(RACE_PROGRESS, (progress) => progress.text === 'go far');
    }
    await ada.type('go far');
    await bo.type('go far', 0, { intervalMs: 20 });
    const results = await ada.waitFor(RACE_RESULTS);
    expect(results.results.map((result) => result.username)).toEqual(['Ada', 'Bo']);
    expect(results.results.every((result) => !result.isGhost && !result.isBot)).toBe(true);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ kind: 'quick', code: matchA.room.code });
    expect(recorded[0]?.results.map((result) => result.username)).toEqual(['Ada', 'Bo']);
    expect(ratings.average(ada.playerId!)).toBeGreaterThan(0);
    expect(server!.inspect().queue).toMatchObject({ lobbies: 0, players: 0 });
  });

  it('fills a lone human\'s race with labelled ghosts that race through the normal loop and never count', async () => {
    const recorded: RecordedRace[] = [];
    const ratings = new InMemoryRatingStore();
    await boot({ textProvider: fixedTexts('go far'), recordRace: (race) => recorded.push(race), ratings });
    const solo = await connect('Solo');
    await solo.queueJoin();
    const match = await solo.waitForMatch();
    const ghosts = match.room.players.filter((player) => player.isGhost);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ isBot: true, isGhost: true, connected: true });
    expect(ghosts[0]?.username).toMatch(/^[A-Z][a-z]+-\d{2}$/);
    expect(match.room.players).toHaveLength(2);

    await solo.waitFor(RACE_PROGRESS, (progress) => progress.text === 'go far');
    // The ghost moves on its own, through the server's authoritative position model.
    const ghostId = ghosts[0]!.playerId;
    const moving = await solo.waitFor(RACE_PROGRESS, (progress) => (progress.players.find((player) => player.playerId === ghostId)?.position ?? 0) > 0);
    expect(moving.players.find((player) => player.playerId === ghostId)).toMatchObject({ isGhost: true, status: 'racing' });

    await solo.type('go far');
    const results = await solo.waitFor(RACE_RESULTS, () => true, { timeoutMs: 8_000 });
    expect(results.results).toHaveLength(2);
    const ghostResult = results.results.find((result) => result.isGhost);
    expect(ghostResult).toMatchObject({ isBot: true, isGhost: true, playerId: ghostId });
    expect(ghostResult?.finishTimeMs).not.toBeNull();

    // Ghost races never reach stats; the human's matchmaking average still learns from it.
    expect(recorded).toEqual([]);
    expect(ratings.average(solo.playerId!)).toBeGreaterThan(0);

    // Quick rooms can't be restarted: the player queues again instead…
    await expect(solo.raceAgain()).rejects.toThrow(/find a new race/);
    // …and is re-banded from that race (typing "go far" instantly is very fast).
    const again = await solo.queueJoin();
    expect(again.queue?.band).toBe('100+');
    // Queueing again left the finished room; with no human left in it, it closed.
    expect(server!.inspect().rooms).toBe(0);
  });

  it('keeps a seat through a mid-lobby disconnect, and drops a racer who never comes back', async () => {
    await boot({ textProvider: fixedTexts('go far'), quickRaceWaitMs: 1_200, queueGraceMs: 300 });
    const ada = await connect('Ada');
    const bo = await connect('Bo');
    const cy = await connect('Cy');
    await ada.queueJoin();
    await bo.queueJoin();
    await cy.queueJoin();
    await ada.waitFor(QUEUE_UPDATE, (payload) => payload.seatsFilled === 3);

    // Bo's connection blips and comes back inside the grace window: same seat, no duplicate.
    let cursor = ada.mark();
    await bo.reopen();
    await ada.waitFor(QUEUE_UPDATE, (payload) => payload.racers.some((racer) => racer.username === 'Bo' && !racer.connected), { after: cursor });
    cursor = ada.mark();
    const back = await bo.queueJoin();
    expect(back.queue?.seatsFilled).toBe(3);
    await ada.waitFor(QUEUE_UPDATE, (payload) => payload.racers.every((racer) => racer.connected), { after: cursor });

    // Cy closes the tab for good: removed when the grace window ends.
    cursor = ada.mark();
    await cy.disconnect();
    const afterDrop = await ada.waitFor(QUEUE_UPDATE, (payload) => payload.seatsFilled === 2, { after: cursor });
    expect(afterDrop.racers.map((racer) => racer.username)).toEqual(['Ada', 'Bo']);
    expect(server!.inspect().queue.players).toBe(2);

    const match = await ada.waitForMatch();
    await bo.waitForMatch();
    expect(match.room.players.map((player) => player.username)).toEqual(['Ada', 'Bo']);
    expect(match.room.players.some((player) => player.isGhost)).toBe(false);
    await ada.waitFor(RACE_PROGRESS, (progress) => progress.text === 'go far');
    await ada.type('go far');
    await bo.type('go far');
    await ada.waitFor(RACE_RESULTS);
  });

  it('re-evaluates the minimum when the other human disconnects for good: ghosts fill in', async () => {
    await boot({ textProvider: fixedTexts('go far'), quickRaceWaitMs: 800, queueGraceMs: 200 });
    const ada = await connect('Ada');
    const bo = await connect('Bo');
    await ada.queueJoin();
    await bo.queueJoin();
    await bo.disconnect();
    const match = await ada.waitForMatch();
    expect(match.room.players.filter((player) => !player.isGhost).map((player) => player.username)).toEqual(['Ada']);
    expect(match.room.players.filter((player) => player.isGhost)).toHaveLength(1);
  });

  it('puts a player whose lobby started while they were offline back into the race', async () => {
    await boot({ textProvider: fixedTexts('go far'), quickRaceWaitMs: 300, queueGraceMs: 2_000, countdownMs: 600 });
    const ada = await connect('Ada');
    const bo = await connect('Bo');
    await ada.queueJoin();
    await bo.queueJoin();
    await bo.disconnect();
    const match = await ada.waitForMatch();
    expect(match.room.players.find((player) => player.username === 'Bo')?.connected).toBe(false);

    await bo.reopen();
    const ack = await bo.queueJoin();
    expect(ack.queue).toBeUndefined();
    expect(ack.room?.code).toBe(match.room.code);
    await bo.waitFor(RACE_PROGRESS, (progress) => progress.players.find((player) => player.username === 'Bo')?.status === 'racing');
    expect(server!.inspect().queue.players).toBe(0);
  });

  it('starts at once when five humans are queued, and opens a fresh lobby for the sixth', async () => {
    await boot({ textProvider: fixedTexts('go far'), quickRaceWaitMs: 10_000 });
    const racers = await Promise.all(['A1', 'B2', 'C3', 'D4', 'E5'].map((name) => connect(name)));
    for (const racer of racers) await racer.queueJoin();
    const started = Date.now();
    const match = await racers[0]!.waitForMatch({ timeoutMs: 2_000 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(match.room.players).toHaveLength(5);
    expect(match.room.players.some((player) => player.isGhost)).toBe(false);

    const sixth = await connect('F6');
    const ack = await sixth.queueJoin();
    expect(ack.queue?.seatsFilled).toBe(1);
    expect(ack.queue?.lobbyId).not.toBe(match.lobbyId);
    // A queued player can't wander into the locked race either.
    await expect(sixth.joinRoom(match.room.code)).rejects.toThrow(RaceClientError);
  });

  it('rejects duplicate queueing from the same socket, another tab, or mid-race', async () => {
    await boot({ textProvider: fixedTexts('go far'), quickRaceWaitMs: 5_000 });
    const tab1 = await connect('Ada');
    await tab1.queueJoin();
    await expect(tab1.queueJoin()).rejects.toThrow('You are already in the queue');

    const tab2 = await connect('Ada');
    tab2.token = tab1.token!;
    await expect(tab2.queueJoin()).rejects.toThrow('You are already in the queue');
    expect(server!.inspect().queue).toMatchObject({ lobbies: 1, players: 1 });
  });

  it('queue:leave cancels, dissolves an empty lobby, and clears its timers', async () => {
    await boot({ quickRaceWaitMs: 5_000 });
    const ada = await connect('Ada');
    await ada.queueJoin();
    expect(server!.inspect().timers.lobby).toBe(1);
    const cursor = ada.mark();
    expect(await ada.queueLeave()).toEqual({ ok: true });
    expect(await ada.waitFor(QUEUE_CLOSED, () => true, { after: cursor })).toEqual({ reason: 'left' });
    expect(server!.inspect()).toMatchObject({ queue: { lobbies: 0, players: 0 }, timers: { total: 0 } });
    // Leaving twice is harmless.
    expect(await ada.queueLeave()).toEqual({ ok: false });
  });

  it('creating a private room while queued leaves the queue', async () => {
    await boot({ quickRaceWaitMs: 5_000 });
    const ada = await connect('Ada');
    await ada.queueJoin();
    await ada.createRoom();
    expect(await ada.waitFor(QUEUE_CLOSED)).toEqual({ reason: 'replaced' });
    expect(server!.inspect().queue.players).toBe(0);
  });

  it('validates payloads, ignores band claims, and rate-limits per socket', async () => {
    await boot({ quickRaceWaitMs: 5_000, queueRateLimit: { perSocket: { limit: 3, windowMs: 60_000 }, perAddress: { limit: 100, windowMs: 60_000 } } });
    const ada = await connect('Ada');
    expect(await ada.requestRaw(CLIENT_EVENTS.QUEUE_JOIN, { username: 'Ada', band: '100+' })).toEqual({ error: 'Invalid queue payload' });
    expect(await ada.requestRaw(CLIENT_EVENTS.QUEUE_JOIN, { username: 'Ada', config: { mode: 'custom', text: 'hi' } })).toEqual({ error: 'Invalid queue payload' });
    expect(await ada.requestRaw(CLIENT_EVENTS.QUEUE_JOIN, { username: 'x' })).toMatchObject({ error: expect.stringMatching(/at least/) });
    expect(await ada.requestRaw(CLIENT_EVENTS.QUEUE_JOIN, { username: 'Ada' })).toEqual({ error: 'Slow down: too many queue requests' });
    expect(server!.inspect().queue.players).toBe(0);
  });

  it('rate-limits per client address across sockets', async () => {
    await boot({ quickRaceWaitMs: 5_000, queueRateLimit: { perSocket: { limit: 100, windowMs: 60_000 }, perAddress: { limit: 2, windowMs: 60_000 } } });
    const a = await connect('Ada');
    const b = await connect('Bo');
    const c = await connect('Cy');
    await a.queueJoin();
    await b.queueJoin();
    await expect(c.queueJoin()).rejects.toThrow('Slow down');
  });

  it('tells queued players when the server shuts down', async () => {
    await boot({ quickRaceWaitMs: 5_000 });
    const ada = await connect('Ada');
    await ada.queueJoin();
    const closed = ada.waitFor(QUEUE_CLOSED);
    await server!.close();
    server = undefined;
    expect(await closed).toEqual({ reason: 'shutdown' });
  });

  it('leaving a finished quick race and queueing again works; the old room closes', async () => {
    // Everyone rated at 150 WPM, so the ghost finishes quickly.
    const fast = { average: () => 150, record: () => undefined, prune: () => undefined, size: 0 };
    await boot({ textProvider: fixedTexts('go far'), ratings: fast });
    const solo = await connect('Solo');
    await solo.queueJoin();
    const first = await solo.waitForMatch();
    await solo.waitFor(RACE_PROGRESS, (progress) => progress.text === 'go far');
    await solo.type('go far');
    await solo.waitFor(RACE_RESULTS, () => true, { timeoutMs: 8_000 });
    const cursor = solo.mark();
    await solo.queueJoin();
    const second = await solo.waitForMatch({ after: cursor });
    expect(second.room.code).not.toBe(first.room.code);
    await vi.waitFor(() => expect(server!.inspect().rooms).toBe(1));
  });
});
