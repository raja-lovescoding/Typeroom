import { describe, expect, it } from 'vitest';
import { generateRoomCode } from '../src/domain/roomCode.js';
import { canTransition, transitionRoom } from '../src/domain/roomStateMachine.js';

describe('room state machine', () => {
  it('allows only legal transitions', () => {
    expect(canTransition('LOBBY', 'COUNTDOWN')).toBe(true);
    expect(canTransition('LOBBY', 'RACING')).toBe(false);
    expect(() => transitionRoom('LOBBY', 'RACING')).toThrow();
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
