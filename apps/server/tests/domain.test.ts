import { describe, expect, it } from 'vitest';
import { generateRoomCode } from '../src/domain/roomCode.js';
import { canTransition, transitionRoom } from '../src/domain/roomStateMachine.js';
import { BotPlayer } from '../src/domain/bot.js';
import { scoreKeystroke } from '../src/domain/scoring.js';
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
    manager.startRace(room, 'ab', 1_000, 0);
    manager.beginRace(room, 1_000);
    expect(manager.handleKeystroke(room, 'human', 'a', 0, 999).reason).toBe('before_start');
    expect(manager.handleKeystroke(room, 'human', 'a', 1, 1_001).reason).toBe('wrong_index');
    expect(manager.handleKeystroke(room, 'human', 'a', 0, 1_001).accepted).toBe(true);
    expect(manager.handleKeystroke(room, 'human', 'b', 1, 1_002).finished).toBe(true);
    expect(manager.handleKeystroke(room, 'x', 2, 1_003).reason).toBe('not_racing');
    const burstRoom = manager.createRoom({ playerId: 'burst', username: 'Burst', token: 'secret-token-123457', connected: true, isBot: false });
    manager.startRace(burstRoom, 'a'.repeat(30), 2_000, 0);
    manager.beginRace(burstRoom, 2_000);
    for (let index = 0; index < 25; index += 1) manager.handleKeystroke(burstRoom, 'burst', 'x', 0, 2_001);
    expect(manager.handleKeystroke(burstRoom, 'burst', 'x', 0, 2_001).reason).toBe('burst');
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
