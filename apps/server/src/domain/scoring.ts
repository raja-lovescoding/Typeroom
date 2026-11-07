export interface Score {
  position: number;
  wpm: number;
  accuracy: number;
}

export function scoreKeystroke(
  text: string,
  position: number,
  char: string,
  elapsedMs: number,
  correctKeystrokes: number,
): Score {
  const expected = text[position];
  const correct = expected === char;
  const nextPosition = correct ? position + 1 : position;
  const total = correctKeystrokes + (correct ? 1 : 0);
  const minutes = Math.max(elapsedMs, 1) / 60_000;
  return {
    position: nextPosition,
    wpm: Math.round((total / 5 / minutes) * 10) / 10,
    accuracy: total === 0 ? 100 : Math.round((total / (correctKeystrokes + 1)) * 100),
  };
}
