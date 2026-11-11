import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bandForWpm,
  DEFAULT_QUICK_RACE_CONFIG,
  DEFAULT_WPM_BAND,
  GHOST_WPM_SPREAD,
  QUICK_RACE_LOBBY_WAIT_MS,
  QUICK_RACE_MAX_RACERS,
  queueJoinSchema,
  type QuickRaceConfig,
} from '@typeroom/shared';
import type { BotRandom } from '../src/domain/bot.js';
import { ghostBaseWpm, ghostCountFor, ghostNames, GhostTypist, sampleGhostWpm } from '../src/domain/ghost.js';
import { InMemoryMatchmakingQueue, type JoinRequest, type Lobby, type QueueMember, type QuickMatch } from '../src/services/matchmakingQueue.js';
import { InMemoryRatingStore } from '../src/services/ratingStore.js';
import { RoomManager } from '../src/services/roomManager.js';

/** Deterministic PRNG (mulberry32) so ghost behaviour is reproducible. */
function seeded(seed: number): BotRandom {
  let state = seed >>> 0;
  return {
    next: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    },
  };
}

const fixed = (value: number): BotRandom => ({ next: () => value });

const WAIT = QUICK_RACE_LOBBY_WAIT_MS;
const GRACE = 5_000;

describe('WPM bands', () => {
  it('puts players with no history in the default 40-70 band', () => {
    expect(DEFAULT_WPM_BAND).toBe('40-70');
    expect(bandForWpm(undefined)).toBe('40-70');
    expect(bandForWpm(Number.NaN)).toBe('40-70');
  });

  it('uses inclusive lower and exclusive upper bounds', () => {
    expect(bandForWpm(0)).toBe('0-40');
    expect(bandForWpm(39.9)).toBe('0-40');
    expect(bandForWpm(40)).toBe('40-70');
    expect(bandForWpm(69.9)).toBe('40-70');
    expect(bandForWpm(70)).toBe('70-100');
    expect(bandForWpm(100)).toBe('100+');
    expect(bandForWpm(240)).toBe('100+');
  });

  it('rejects client claims about band, rating or role in queue:join', () => {
    expect(queueJoinSchema.safeParse({ username: 'Ada' }).success).toBe(true);
    expect(queueJoinSchema.safeParse({ username: 'Ada', band: '100+' }).success).toBe(false);
    expect(queueJoinSchema.safeParse({ username: 'Ada', averageWpm: 150 }).success).toBe(false);
    expect(queueJoinSchema.safeParse({ username: 'Ada', isGhost: true }).success).toBe(false);
    // Strangers never race on someone's custom text.
    expect(queueJoinSchema.safeParse({ username: 'Ada', config: { mode: 'custom', text: 'hello' } }).success).toBe(false);
  });
});

describe('InMemoryMatchmakingQueue', () => {
  let matches: QuickMatch[];
  let updates: Lobby[];
  let expired: QueueMember[];
  let queue: InMemoryMatchmakingQueue;

  const request = (playerId: string, overrides: Partial<JoinRequest> = {}): JoinRequest => ({
    playerId,
    username: playerId,
    token: `token-${playerId}-0123456789`,
    socketId: `socket-${playerId}`,
    averageWpm: undefined,
    config: DEFAULT_QUICK_RACE_CONFIG,
    ...overrides,
  });

  const make = (random: BotRandom = seeded(1)) => new InMemoryMatchmakingQueue({
    onUpdate: (lobby) => updates.push(lobby),
    onMatch: (match) => matches.push(match),
    onExpired: (member) => expired.push(member),
  }, { waitMs: WAIT, graceMs: GRACE, random });

  beforeEach(() => {
    vi.useFakeTimers();
    matches = [];
    updates = [];
    expired = [];
    queue = make();
  });

  afterEach(() => {
    queue.close();
    vi.useRealTimers();
  });

  describe('band assignment', () => {
    it('matches players across rolling-average bands while retaining the lobby band', () => {
      const newcomer = queue.join(request('new'));
      const mid = queue.join(request('mid', { averageWpm: 62 }));
      const slow = queue.join(request('slow', { averageWpm: 31 }));
      const fast = queue.join(request('fast', { averageWpm: 128 }));
      if (newcomer.status === 'rejected' || mid.status === 'rejected' || slow.status === 'rejected' || fast.status === 'rejected') throw new Error('rejected');
      expect(newcomer.lobby.band).toBe('40-70');
      expect(mid.lobby.id).toBe(newcomer.lobby.id);
      expect(slow.lobby.id).toBe(newcomer.lobby.id);
      expect(fast.lobby.id).toBe(newcomer.lobby.id);
      expect(new Set([newcomer.lobby.id]).size).toBe(1);
    });

    it('keeps different race modes in different lobbies', () => {
      const quote: QuickRaceConfig = { mode: 'quote', length: 'short' };
      const a = queue.join(request('a'));
      const b = queue.join(request('b', { config: quote }));
      const c = queue.join(request('c', { config: { mode: 'quote', length: 'short' } }));
      if (a.status === 'rejected' || b.status === 'rejected' || c.status === 'rejected') throw new Error('rejected');
      expect(a.lobby.id).not.toBe(b.lobby.id);
      expect(c.lobby.id).toBe(b.lobby.id);
      expect(queue.stats()).toMatchObject({ lobbies: 2, openLobbies: 2, players: 3 });
    });
  });

  describe('lobby timer', () => {
    it('starts with the first player and is not reset by later joiners', () => {
      queue.join(request('a'));
      vi.advanceTimersByTime(5_000);
      const later = queue.join(request('b'));
      if (later.status === 'rejected') throw new Error('rejected');
      expect(queue.view(later.lobby, Date.now())).toMatchObject({ msLeft: 5_000, secondsLeft: 5, seatsFilled: 2, maxSeats: QUICK_RACE_MAX_RACERS });
      vi.advanceTimersByTime(4_999);
      expect(matches).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(matches).toHaveLength(1);
    });

    it('starts 2+ humans against each other with no ghosts when the timer ends', () => {
      queue.join(request('a'));
      queue.join(request('b'));
      queue.join(request('c'));
      vi.advanceTimersByTime(WAIT);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.humans.map((member) => member.playerId)).toEqual(['a', 'b', 'c']);
      expect(matches[0]?.ghosts).toEqual([]);
      expect(queue.stats()).toEqual({ lobbies: 0, openLobbies: 0, players: 0, timers: { lobby: 0, grace: 0 } });
    });

    it('fills a lone human\'s race with 1-3 ghosts at the timer', () => {
      for (const [value, ghosts] of [[0, 1], [0.5, 2], [0.999, 3]] as const) {
        queue.close();
        matches = [];
        queue = make(fixed(value));
        queue.join(request('solo'));
        vi.advanceTimersByTime(WAIT);
        expect(matches).toHaveLength(1);
        expect(matches[0]?.humans).toHaveLength(1);
        expect(matches[0]?.ghosts).toHaveLength(ghosts);
      }
    });

    it('gives ghosts distinct bot-style names and speeds within ±10% of the human\'s average', () => {
      queue.close();
      queue = make(seeded(7));
      queue.join(request('solo', { averageWpm: 80 }));
      vi.advanceTimersByTime(WAIT);
      const ghosts = matches[0]?.ghosts ?? [];
      expect(ghosts.length).toBeGreaterThanOrEqual(1);
      expect(new Set(ghosts.map((ghost) => ghost.username)).size).toBe(ghosts.length);
      for (const ghost of ghosts) {
        expect(ghost.playerId).toMatch(/^ghost-/);
        expect(ghost.username).toMatch(/^[A-Z][a-z]+-\d{2}$/);
        expect(ghost.targetWpm).toBeGreaterThanOrEqual(80 * (1 - GHOST_WPM_SPREAD) - 0.5);
        expect(ghost.targetWpm).toBeLessThanOrEqual(80 * (1 + GHOST_WPM_SPREAD) + 0.5);
      }
    });
  });

  describe('5-human cap', () => {
    it('starts immediately with 5 humans and no ghosts, and opens a new lobby for the 6th', () => {
      for (const id of ['a', 'b', 'c', 'd', 'e']) queue.join(request(id));
      const full = queue.lobbyOf('a');
      expect(full?.locked).toBe(true);
      const sixth = queue.join(request('f'));
      if (sixth.status === 'rejected') throw new Error('rejected');
      expect(sixth.lobby.id).not.toBe(full?.id);
      expect(sixth.lobby.members.size).toBe(1);

      // Hand-off happens on the next tick, after the join is acknowledged, not after 15s.
      expect(matches).toHaveLength(0);
      vi.advanceTimersByTime(0);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.humans).toHaveLength(5);
      expect(matches[0]?.ghosts).toEqual([]);
      expect(queue.lobbyOf('f')?.id).toBe(sixth.lobby.id);
    });

    it('never builds a race larger than 5', () => {
      for (let humans = 1; humans <= 5; humans += 1) {
        for (const value of [0, 0.5, 0.999]) expect(humans + ghostCountFor(humans, fixed(value))).toBeLessThanOrEqual(5);
      }
      expect(ghostCountFor(2)).toBe(0);
      expect(ghostCountFor(0)).toBe(0);
    });
  });

  describe('leaving during the timer', () => {
    it('re-evaluates the minimum: a lobby down to one human gets ghosts', () => {
      queue.join(request('a'));
      queue.join(request('b'));
      expect(queue.leave('b')).toBe(true);
      expect(updates.at(-1)?.members.size).toBe(1);
      vi.advanceTimersByTime(WAIT);
      expect(matches[0]?.humans.map((member) => member.playerId)).toEqual(['a']);
      expect(matches[0]?.ghosts.length).toBeGreaterThanOrEqual(1);
    });

    it('destroys a lobby that drops to zero humans, with its timer', () => {
      queue.join(request('a'));
      expect(queue.stats().timers.lobby).toBe(1);
      queue.leave('a');
      expect(queue.stats()).toEqual({ lobbies: 0, openLobbies: 0, players: 0, timers: { lobby: 0, grace: 0 } });
      vi.advanceTimersByTime(WAIT * 2);
      expect(matches).toHaveLength(0);
      expect(queue.leave('a')).toBe(false);
    });
  });

  describe('duplicates and reconnects', () => {
    it('rejects a second join while the first seat is live', () => {
      queue.join(request('a'));
      expect(queue.join(request('a'))).toEqual({ status: 'rejected', reason: 'already_queued' });
      expect(queue.join(request('a', { socketId: 'another-tab' }))).toEqual({ status: 'rejected', reason: 'already_queued' });
      expect(queue.lobbyOf('a')?.members.size).toBe(1);
    });

    it('lets a reconnecting player take their seat back within the grace window, without double-queuing', () => {
      const first = queue.join(request('a'));
      queue.join(request('b'));
      queue.disconnect('a', 'socket-a');
      expect(queue.lobbyOf('a')?.members.get('a')?.connected).toBe(false);
      expect(queue.stats().timers.grace).toBe(1);
      vi.advanceTimersByTime(GRACE - 1);
      const again = queue.join(request('a', { socketId: 'socket-a2' }));
      expect(again.status).toBe('reattached');
      if (first.status === 'rejected' || again.status === 'rejected') throw new Error('rejected');
      expect(again.lobby.id).toBe(first.lobby.id);
      expect(again.lobby.members.size).toBe(2);
      expect(again.lobby.members.get('a')?.socketId).toBe('socket-a2');
      expect(queue.stats().timers.grace).toBe(0);
    });

    it('ignores a disconnect from a stale socket', () => {
      queue.join(request('a', { socketId: 'new' }));
      queue.disconnect('a', 'old');
      expect(queue.lobbyOf('a')?.members.get('a')?.connected).toBe(true);
    });

    it('drops a disconnected player when the grace window passes', () => {
      queue.join(request('a'));
      queue.join(request('b'));
      queue.disconnect('b', 'socket-b');
      vi.advanceTimersByTime(GRACE);
      expect(expired.map((member) => member.playerId)).toEqual(['b']);
      expect(queue.lobbyOf('b')).toBeUndefined();
      expect(queue.lobbyOf('a')?.members.size).toBe(1);
    });

    it('does not start a ghost-only race when nobody is online at the timer', () => {
      queue.close();
      queue = new InMemoryMatchmakingQueue({
        onUpdate: () => undefined,
        onMatch: (match) => matches.push(match),
        onExpired: (member) => expired.push(member),
      }, { waitMs: 1_000, graceMs: 5_000 });
      queue.join(request('a'));
      queue.disconnect('a', 'socket-a');
      vi.advanceTimersByTime(1_000);
      expect(matches).toHaveLength(0);
      expect(expired.map((member) => member.playerId)).toEqual(['a']);
      expect(queue.stats().timers).toEqual({ lobby: 0, grace: 0 });
    });
  });

  describe('lobby lock', () => {
    it('hands a lobby off exactly once; later queuers open a new lobby', () => {
      queue.join(request('a'));
      queue.join(request('b'));
      vi.advanceTimersByTime(WAIT);
      expect(matches).toHaveLength(1);
      const started = matches[0]?.lobbyId;
      expect(queue.lobbyOf('a')).toBeUndefined();

      const late = queue.join(request('late'));
      if (late.status === 'rejected') throw new Error('rejected');
      expect(late.lobby.id).not.toBe(started);
      expect(late.lobby.members.size).toBe(1);
      vi.advanceTimersByTime(WAIT);
      expect(matches).toHaveLength(2);
      expect(matches[1]?.humans.map((member) => member.playerId)).toEqual(['late']);
    });

    it('a player whose race started can queue again (no stale membership)', () => {
      queue.join(request('a'));
      vi.advanceTimersByTime(WAIT);
      expect(queue.join(request('a')).status).toBe('queued');
    });
  });

  it('close() clears every lobby and timer and returns who was queued', () => {
    queue.join(request('a'));
    queue.join(request('b', { averageWpm: 150 }));
    queue.disconnect('b', 'socket-b');
    expect(queue.close().map((member) => member.playerId).sort()).toEqual(['a', 'b']);
    expect(queue.stats()).toEqual({ lobbies: 0, openLobbies: 0, players: 0, timers: { lobby: 0, grace: 0 } });
  });
});

describe('ghost typist', () => {
  /** Runs a ghost through `text` on a virtual clock; returns elapsed ms, keystrokes and delays. */
  function simulate(targetWpm: number, text: string, seed: number) {
    const ghost = new GhostTypist(targetWpm, seeded(seed));
    let elapsed = 0;
    let position = 0;
    let wrong = 0;
    const delays: number[] = [];
    const sent: Array<{ char: string; index: number }> = [];
    for (let next = ghost.nextChar(text); next; next = ghost.nextChar(text)) {
      expect(next.index).toBe(position); // never skips ahead, never goes back
      sent.push(next);
      if (next.char === text[next.index]) position += 1;
      else wrong += 1;
      if (position === text.length) break;
      const delay = ghost.nextDelay(text[next.index] ?? ' ');
      delays.push(delay);
      elapsed += delay;
    }
    return { elapsed, position, wrong, delays, sent };
  }

  const words = 'the quick lantern drifts over quiet water while seven tired travellers count distant stars and wonder about tomorrow';
  const text = Array.from({ length: 6 }, () => words).join(' ');

  it.each([35, 60, 90, 130])('averages close to its %i WPM target', (target) => {
    const runs = [1, 2, 3].map((seed) => simulate(target, text, seed));
    for (const run of runs) expect(run.position).toBe(text.length);
    const wpm = runs.reduce((sum, run) => sum + (text.length / 5) / (run.elapsed / 60_000), 0) / runs.length;
    expect(wpm).toBeGreaterThan(target * 0.88);
    expect(wpm).toBeLessThan(target * 1.12);
  });

  it('never types at a constant speed', () => {
    const { delays } = simulate(80, text, 4);
    const mean = delays.reduce((sum, value) => sum + value, 0) / delays.length;
    const sd = Math.sqrt(delays.reduce((sum, value) => sum + (value - mean) ** 2, 0) / delays.length);
    expect(sd / mean).toBeGreaterThan(0.3);
    expect(new Set(delays).size).toBeGreaterThan(30);
  });

  it('makes occasional mistakes and corrects each one at the same index', () => {
    const { sent, wrong } = simulate(80, text, 5);
    expect(wrong).toBeGreaterThan(0);
    expect(wrong).toBeLessThan(text.length * 0.08);
    sent.forEach((keystroke, at) => {
      if (keystroke.char === text[keystroke.index]) return;
      const next = sent[at + 1];
      expect(next).toEqual({ char: text[keystroke.index], index: keystroke.index });
    });
  });

  it('pauses between words more than inside them', () => {
    const ghost = new GhostTypist(80, seeded(6));
    const inside: number[] = [];
    const after: number[] = [];
    for (let next = ghost.nextChar(text); next; next = ghost.nextChar(text)) {
      const char = text[next.index] ?? ' ';
      const delay = ghost.nextDelay(char);
      if (next.char !== char) continue;
      (char === ' ' ? after : inside).push(delay);
    }
    const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(avg(after)).toBeGreaterThan(avg(inside) * 1.3);
  });

  it('stays under the server burst limit at the top of the 100+ band', () => {
    const { delays } = simulate(150, text, 8);
    let start = 0;
    let windowSum = 0;
    for (let end = 0; end < delays.length; end += 1) {
      windowSum += delays[end] ?? 0;
      while (windowSum > 1_000) windowSum -= delays[start++] ?? 0;
      expect(end - start + 1).toBeLessThanOrEqual(25);
    }
  });

  it('samples targets around the human (or band) average', () => {
    expect(ghostBaseWpm('70-100', undefined)).toBe(85);
    expect(ghostBaseWpm('70-100', 92)).toBe(92);
    expect(sampleGhostWpm(100, fixed(0))).toBe(90);
    expect(sampleGhostWpm(100, fixed(0.5))).toBe(100);
    expect(sampleGhostWpm(100, fixed(0.9999))).toBe(110);
    expect(ghostNames(3, new Set(['Wisp-10']), fixed(0))).not.toContain('Wisp-10');
  });
});

describe('rating store', () => {
  it('sets the average from the first race, then moves it partway on each race', () => {
    const store = new InMemoryRatingStore({ weight: 0.5 });
    expect(store.average('p')).toBeUndefined();
    store.record('p', 90, 0);
    expect(store.average('p')).toBe(90);
    store.record('p', 50, 1);
    expect(store.average('p')).toBe(70);
    expect(store.entry('p')).toEqual({ average: 70, races: 2, updatedAt: 1 });
    store.record('p', Number.NaN);
    expect(store.average('p')).toBe(70);
  });

  it('is bounded: evicts least recently updated players and prunes stale ones', () => {
    const store = new InMemoryRatingStore({ maxEntries: 2, maxAgeMs: 100 });
    store.record('a', 50, 0);
    store.record('b', 50, 10);
    store.record('a', 60, 20);
    store.record('c', 70, 30);
    expect(store.average('b')).toBeUndefined();
    expect(store.size).toBe(2);
    store.prune(125);
    expect(store.average('a')).toBeUndefined();
    expect(store.average('c')).toBe(70);
  });
});

describe('quick rooms', () => {
  const human = (playerId: string) => ({ playerId, username: playerId, token: `token-${playerId}-0123456789`, connected: true, isBot: false });

  it('seats ghosts as bots flagged isGhost, up to the room cap', () => {
    const manager = new RoomManager();
    const room = manager.createRoom(human('a'), { kind: 'quick' });
    expect(manager.hasGhosts(room)).toBe(false);
    for (let index = 0; index < 4; index += 1) manager.addGhost(room, { playerId: `ghost-${index}`, username: `Wisp-1${index}`, targetWpm: 60 });
    expect(() => manager.addGhost(room, { playerId: 'ghost-x', username: 'Echo-11', targetWpm: 60 })).toThrow('Room is full');
    expect(manager.hasGhosts(room)).toBe(true);
    const snapshot = manager.snapshot(room);
    expect(snapshot.kind).toBe('quick');
    expect(snapshot.players.filter((player) => player.isGhost)).toHaveLength(4);
    expect(snapshot.players.every((player) => player.isGhost === player.isBot)).toBe(true);
  });

  it('stays open for the remaining humans when the first player leaves', () => {
    const manager = new RoomManager();
    const room = manager.createRoom(human('a'), { kind: 'quick' });
    manager.joinRoom(room.code, human('b'));
    expect(manager.leaveRoom(room.code, 'a')).toBe(false);
    expect(room.hostPlayerId).toBe('b');
    expect(manager.leaveRoom(room.code, 'b')).toBe(true);
  });

  it('private rooms still close when the host leaves', () => {
    const manager = new RoomManager();
    const room = manager.createRoom(human('a'));
    manager.joinRoom(room.code, human('b'));
    expect(manager.leaveRoom(room.code, 'a')).toBe(true);
  });
});
