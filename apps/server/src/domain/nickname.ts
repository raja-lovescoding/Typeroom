import { usernameSchema } from '@typeroom/shared';

/**
 * Server-side nickname policy: the shared schema enforces length and the character allow-list,
 * then a small profanity blocklist runs here. The blocklist deliberately stays on the server so it
 * isn't shipped to every browser.
 *
 * Matching works on what the name *looks like*: accents are stripped, common digit substitutions
 * are undone (n1gg3r -> nigger), repeated letters are tolerated (fuuuck), and separators between
 * very short pieces are ignored (f.u.c.k, fu-ck). Two tiers keep false positives down:
 *
 *  - SUBSTRING terms are long or unambiguous enough to block wherever they appear.
 *  - WORD terms are short and appear inside innocent words (class, Dickens, grape), so they only
 *    block when they are a whole word of the name (a plural "s" is tolerated).
 *
 * This is a guard rail, not a moderation system: it cannot read intent. The Terms of Use and the
 * operator's right to remove rooms cover the rest.
 */

const SUBSTRING_TERMS = [
  'fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'bitch', 'whore', 'slut', 'retard', 'dildo',
  'twat', 'porn', 'rapist', 'jizz', 'asshole', 'motherf', 'bastard', 'blowjob', 'handjob', 'cumshot',
] as const;

const WORD_TERMS = [
  'ass', 'arse', 'cock', 'dick', 'cum', 'fag', 'rape', 'nazi', 'hitler', 'kkk', 'sex', 'tit', 'tits',
  'piss', 'wank', 'pedo', 'spic', 'kike', 'chink', 'coon', 'boob', 'penis', 'vagina', 'anal', 'nsfw',
  'heil', 'isis', 'jihad', 'negro', 'tranny', 'dyke', 'gook', 'wetback', 'raghead', 'skank', 'hoe',
] as const;

/** Innocent words that contain a SUBSTRING term; removed before substring matching. */
const EXCEPTIONS = ['scunthorpe', 'shiitake', 'therapist', 'retardant', 'cockpit', 'saltpetre', 'matsushita'] as const;

const LEET: Readonly<Record<string, string>> = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' };

const letters = (term: string) => [...term].map((char) => `${char}+`).join('');
const SUBSTRING_PATTERNS = SUBSTRING_TERMS.map((term) => new RegExp(letters(term), 'u'));
const WORD_PATTERNS = WORD_TERMS.map((term) => new RegExp(`^${letters(term)}s*$`, 'u'));

export type NicknameVerdict =
  | { ok: true; value: string }
  | { ok: false; reason: 'invalid' | 'blocked'; message: string };

export function checkNickname(raw: unknown): NicknameVerdict {
  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid nickname' };
  }
  if (containsBlockedTerm(parsed.data)) {
    return { ok: false, reason: 'blocked', message: 'That nickname is not allowed. Please choose another.' };
  }
  return { ok: true, value: parsed.data };
}

export function containsBlockedTerm(name: string): boolean {
  // "1" reads as either i or l, so check both readings.
  for (const one of ['i', 'l'] as const) {
    for (const candidate of candidates(name, one)) {
      if (WORD_PATTERNS.some((pattern) => pattern.test(candidate))) return true;
      const scrubbed = EXCEPTIONS.reduce((value, word) => value.replaceAll(word, ' '), candidate);
      if (SUBSTRING_PATTERNS.some((pattern) => pattern.test(scrubbed))) return true;
    }
  }
  return false;
}

/**
 * The strings to test: every word of the name (camelCase split too) and each run of short pieces
 * glued back together (f.u.c.k -> fuck). Longer words are never glued, so "Pass Hit" stays clean.
 */
function candidates(name: string, one: 'i' | 'l'): string[] {
  const words = name
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .split(/[\s_.-]+/u)
    .map((word) => fold(word, one))
    .filter(Boolean);
  const result = new Set(words);
  let run: string[] = [];
  const flush = () => {
    if (run.length > 1) result.add(run.join(''));
    run = [];
  };
  for (const word of words) {
    if (word.length <= 2) run.push(word);
    else flush();
  }
  flush();
  return [...result];
}

function fold(value: string, one: 'i' | 'l'): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0-9]/g, (digit) => (digit === '1' ? one : (LEET[digit] ?? digit)));
}
