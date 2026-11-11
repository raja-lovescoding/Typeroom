import { describe, expect, it } from 'vitest';
import { generateRoomCode } from '../src/domain/roomCode.js';
import { canTransition, transitionRoom } from '../src/domain/roomStateMachine.js';
import { BotPlayer } from '../src/domain/bot.js';
import { scoreKeystroke } from '../src/domain/scoring.js';
import { RateLimiter } from '../src/lib/rateLimiter.js';
import { RoomManager } from '../src/services/roomManager.js';

describe('room state machine', () => {
  it('allows only legal transitions', () => {
    expect(canTransition('LOBBY', 'COUNTDOWN')).toBe(true);
    expect(canTransition('LOBBY', 'RACING')).toBe(false);
    expect(() => transitionRoom('LOBBY', 'RACING')).toThrow();
  });

  it('accepts every legal lifecycle transition and rejects every other transition', () => {
    const legal: Array<[Parameters<typeof canTransition>[0], Parameters<typeof canTransition>[1]]> = [
      ['LOBBY', 'COUNTDOWN'], ['LOBBY', 'CLOSED'], ['COUNTDOWN', 'RACING'],
      ['COUNTDOWN', 'LOBBY'], ['COUNTDOWN', 'CLOSED'], ['RACING', 'RESULTS'],
      ['RACING', 'CLOSED'], ['RESULTS', 'LOBBY'], ['RESULTS', 'CLOSED'],
    ];
    for (const [from, to] of legal) expect(canTransition(from, to)).toBe(true);
    for (const from of ['LOBBY', 'COUNTDOWN', 'RACING', 'RESULTS', 'CLOSED'] as const) {
      for (const to of ['LOBBY', 'COUNTDOWN', 'RACING', 'RESULTS', 'CLOSED'] as const) {
        if (!legal.some(([legalFrom, legalTo]) => legalFrom === from && legalTo === to)) {
          expect(canTransition(from, to)).toBe(false);
        }
      }
    }
  });
});

describe('room code generator', () => {
  it('generates six unambiguous characters and avoids collisions', () => {
    const values = [0, 0.1];
    const code = generateRoomCode(new Set(['AAAAAA']), () => values.shift() ?? 0.1);
    expect(code).toHaveLength(6);
    expect(code).not.toBe('AAAAAA');
    expect(code).not.toMatch(/[01OI]/);
  });
});

describe('authoritative scoring', () => {
  it('requires the correct character to advance and computes accuracy', () => {
    const wrong = scoreKeystroke('ab', 0, 'x', 60_000, 0, 0);
    expect(wrong.position).toBe(0);
    expect(wrong.accuracy).toBe(0);
    const correct = scoreKeystroke('ab', 0, 'a', 60_000, 0, 1);
    expect(correct.position).toBe(1);
    expect(correct.wpm).toBe(0.2);
    expect(correct.accuracy).toBe(50);
  });

  it('enforces start time, index, finish, and burst validation', () => {
    const manager = new RoomManager();
    const room = manager.createRoom({ playerId: 'human', username: 'Human', token: 'secret-token-123456', connected: true, isBot: false });
    expect(manager.snapshot(room).players[0]).not.toHaveProperty('token');
    manager.startRace(room, { text: 'ab' }, 1_000, 0);
    manager.beginRace(room, 1_000);
    expect(manager.handleKeystroke(room, 'human', 'a', 0, 999).reason).toBe('before_start');
    expect(manager.handleKeystroke(room, 'human', 'a', 1, 1_001).reason).toBe('wrong_index');
    expect(manager.handleKeystroke(room, 'human', 'a', 0, 1_001).accepted).toBe(true);
    expect(manager.handleKeystroke(room, 'human', 'b', 1, 1_002).finished).toBe(true);
    expect(manager.handleKeystroke(room, 'human', 'x', 2, 1_003).reason).toBe('finished');
    expect(manager.handleKeystroke(room, 'ghost', 'x', 0, 1_003).reason).toBe('not_racing');
    const burstRoom = manager.createRoom({ playerId: 'burst', username: 'Burst', token: 'secret-token-123457', connected: true, isBot: false });
    manager.startRace(burstRoom, { text: 'a'.repeat(30) }, 2_000, 0);
    manager.beginRace(burstRoom, 2_000);
    for (let index = 0; index < 25; index += 1) manager.handleKeystroke(burstRoom, 'burst', 'x', 0, 2_001);
    expect(manager.handleKeystroke(burstRoom, 'burst', 'x', 0, 2_001).reason).toBe('burst');
  });

  it('lets a player recover from wrong characters without advancing the caret', () => {
    const manager = new RoomManager();
    const room = manager.createRoom({ playerId: 'human', username: 'Human', token: 'secret-token-123458', connected: true, isBot: false });
    manager.startRace(room, { text: 'ab' }, 1_000, 0);
    manager.beginRace(room, 1_000);
    expect(manager.handleKeystroke(room, 'human', 'x', 0, 1_001).accepted).toBe(true);
    expect(room.players.get('human')?.position).toBe(0);
    expect(manager.handleKeystroke(room, 'human', 'a', 0, 1_002).accepted).toBe(true);
    expect(manager.handleKeystroke(room, 'human', 'b', 1, 1_003).finished).toBe(true);
    expect(manager.results(room, 1_003)[0]?.accuracy).toBe(67);
  });
});

describe('race expiry and ranking', () => {
  const human = (playerId: string) => ({ playerId, username: playerId, token: `token-${playerId}-0123456789`, connected: true, isBot: false });

  it('in time mode, everyone still racing finishes with the full duration and the most correct characters wins', () => {
    const manager = new RoomManager();
    const room = manager.createRoom(human('slow'), { config: { mode: 'time', seconds: 15, punctuation: false } });
    manager.joinRoom(room.code, human('fast'));
    manager.joinRoom(room.code, human('gone'));
    manager.startRace(room, { text: 'abcdefghij' }, 0, 0, 15_000);
    manager.beginRace(room, 0);
    for (const [index, char] of [...'abc'].entries()) manager.handleKeystroke(room, 'slow', char, index, 100 + index);
    for (const [index, char] of [...'abcdef'].entries()) manager.handleKeystroke(room, 'fast', char, index, 100 + index);
    manager.markDisconnected(room, 'gone');

    manager.expire(room);
    expect(manager.allDone(room)).toBe(true);
    const results = manager.results(room, 15_000);
    expect(results.map((result) => [result.playerId, result.rank, result.finishTimeMs])).toEqual([
      ['fast', 1, 15_000], ['slow', 2, 15_000], ['gone', 3, null],
    ]);
    // 6 correct characters in 15 seconds = 4.8 WPM.
    expect(results[0]?.wpm).toBe(4.8);
  });

  it('in untimed modes, unfinished racers are DNF and ranked by how far they got', () => {
    const manager = new RoomManager();
    const room = manager.createRoom(human('a'), { config: { mode: 'words', count: 10, punctuation: false } });
    manager.joinRoom(room.code, human('b'));
    manager.joinRoom(room.code, human('c'));
    manager.startRace(room, { text: 'abc' }, 0, 0, 1_000);
    manager.beginRace(room, 0);
    manager.handleKeystroke(room, 'c', 'a', 0, 10);
    manager.handleKeystroke(room, 'c', 'b', 1, 20);
    manager.handleKeystroke(room, 'b', 'a', 0, 30);
    manager.handleKeystroke(room, 'a', 'a', 0, 40);
    manager.handleKeystroke(room, 'a', 'b', 1, 50);
    manager.handleKeystroke(room, 'a', 'c', 2, 60);
    manager.expire(room);
    expect([...room.players.values()].map((player) => player.status)).toEqual(['finished', 'dnf', 'dnf']);
    expect(manager.results(room, 1_000).map((result) => result.playerId)).toEqual(['a', 'c', 'b']);
  });

  it('only lets the race mode change in the lobby', () => {
    const manager = new RoomManager();
    const room = manager.createRoom(human('host'));
    expect(room.config).toEqual({ mode: 'words', count: 25, punctuation: false });
    manager.setConfig(room, { mode: 'quote', length: 'long' });
    expect(manager.snapshot(room).config).toEqual({ mode: 'quote', length: 'long' });
    manager.startRace(room, { text: 'x' }, 0, 0);
    expect(() => manager.setConfig(room, { mode: 'quote', length: 'short' })).toThrow();
  });

  it('closes the room when the last human leaves, even if a bot remains', () => {
    const manager = new RoomManager();
    const room = manager.createRoom(human('host'), { botTargetWpm: 60 });
    expect([...room.players.values()].find((player) => player.isBot)?.botWpm).toBe(60);
    manager.joinRoom(room.code, human('guest'));
    expect(manager.leaveRoom(room.code, 'guest')).toBe(false);
    expect(manager.leaveRoom(room.code, 'host')).toBe(true);
  });
});

describe('rate limiter', () => {
  it('limits within the window and forgets idle keys', () => {
    const limiter = new RateLimiter(2, 1_000);
    expect(limiter.allow('ip', 0)).toBe(true);
    expect(limiter.allow('ip', 10)).toBe(true);
    expect(limiter.allow('ip', 20)).toBe(false);
    expect(limiter.allow('ip', 1_011)).toBe(true);
    limiter.allow('other', 500);
    limiter.prune(1_400);
    expect(limiter.size).toBe(2);
    limiter.prune(2_100);
    expect(limiter.size).toBe(0);
  });
});

describe('bot timing', () => {
  it('types the complete text with deterministic random timing', () => {
    const bot = new BotPlayer(60, { next: () => 0.5 });
    const text = 'hello world';
    let totalDelay = 0;
    let typed = '';
    let next = bot.nextChar(text);
    while (next) {
      typed += next.char;
      totalDelay += bot.nextDelay(next.char);
      next = bot.nextChar(text);
    }
    expect(typed).toBe(text);
    expect(totalDelay / text.length).toBeGreaterThan(180);
    expect(totalDelay / text.length).toBeLessThan(260);
  });
});
