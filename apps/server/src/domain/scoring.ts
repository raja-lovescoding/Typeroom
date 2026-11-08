export interface Score {
  position: number;
  wpm: number;
  accuracy: number;
  correct: boolean;
}

export function scoreKeystroke(
  text: string,
  position: number,
  char: string,
  elapsedMs: number,
  correctKeystrokes: number,
  errors = 0,
): Score {
  const expected = text[position];
  const correct = expected === char;
  const nextPosition = correct ? position + 1 : position;
  const total = correctKeystrokes + errors + 1;
  const minutes = Math.max(elapsedMs, 1) / 60_000;
  return {
    position: nextPosition,
    wpm: Math.round(((correctKeystrokes + (correct ? 1 : 0)) / 5 / minutes) * 10) / 10,
    accuracy: Math.round(((correctKeystrokes + (correct ? 1 : 0)) / total) * 100),
    correct,
  };
}
