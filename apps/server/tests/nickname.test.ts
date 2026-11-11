import { describe, expect, it } from 'vitest';
import { MAX_USERNAME_LENGTH } from '@typeroom/shared';
import { checkNickname, containsBlockedTerm } from '../src/domain/nickname.js';

describe('nickname filter', () => {
  it('accepts ordinary names and returns the normalised value', () => {
    for (const name of ['Ada', 'grace_hopper', 'Linus T.', 'Zoë-42', 'タイピスト', 'Mx Kim', 'speedy.typer', 'xX_Ninja_Xx']) {
      expect(checkNickname(name)).toEqual({ ok: true, value: name });
    }
    expect(checkNickname('  spaced    out  ')).toEqual({ ok: true, value: 'spaced out' });
  });

  it('enforces length limits', () => {
    expect(checkNickname('a')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkNickname('')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkNickname('x'.repeat(MAX_USERNAME_LENGTH))).toMatchObject({ ok: true });
    expect(checkNickname('x'.repeat(MAX_USERNAME_LENGTH + 1))).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('enforces the character allow-list', () => {
    for (const name of ['<b>bold</b>', 'name@site', 'semi;colon', 'quote"d', 'zero​width', 'emoji🙂', '-dash-first', 'new\u0000line']) {
      expect(checkNickname(name), name).toMatchObject({ ok: false, reason: 'invalid' });
    }
    expect(checkNickname(42)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkNickname(undefined)).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('blocks profanity, including common disguises', () => {
    const blocked = [
      'fuck', 'FUCK', 'MotherFucker', 'fuuuuck', 'f.u.c.k', 'f u c k', 'fu-ck', 'xXfuckXx', 'Shit Happens',
      'sh1t', 'b1tch', 'n1gg3r', 'fäggot', 'a.s.s', 'Big Dick', 'BigDick', 'dicks', 'Hitler', 'nazis',
      'the rapist', 'Total_Retard',
    ];
    for (const name of blocked) {
      expect(checkNickname(name), name).toMatchObject({ ok: false, reason: 'blocked' });
    }
  });

  it('does not block innocent names that merely contain a short term (Scunthorpe problem)', () => {
    const innocent = [
      'Scunthorpe', 'Class Act', 'Glass', 'Passion', 'Charles Dickens', 'Peacock', 'Cocktail', 'grape',
      'Therapist', 'Sussex', 'Essex', 'Titan', 'Analyst', 'Pass Hit', 'shiitake', 'Assassin', 'Hancock',
      'Cumbria', 'Matsushita', 'Wanderer',
    ];
    for (const name of innocent) {
      expect(containsBlockedTerm(name), name).toBe(false);
    }
  });
});
