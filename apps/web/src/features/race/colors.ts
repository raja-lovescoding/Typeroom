import type { CSSProperties } from 'react';

/**
 * Identity colours: you are always the theme accent; every other player gets a ghost colour in
 * fixed join order (the server keeps players in join order, max 5 per room → at most 4 ghosts).
 * A player's colour therefore never changes with rank.
 */
export function colorFor(players: ReadonlyArray<{ playerId: string }>, playerId: string, selfId: string): string {
  if (playerId === selfId) return 'var(--accent)';
  const others = players.filter((player) => player.playerId !== selfId);
  const order = Math.max(0, others.findIndex((player) => player.playerId === playerId));
  return `var(--ghost-${(order % 4) + 1})`;
}

export const caretColor = (color: string): CSSProperties => ({ '--caret-color': color }) as CSSProperties;
