import type { RoomState } from '@typeroom/shared';

export const ROOM_TRANSITIONS: Readonly<Record<RoomState, readonly RoomState[]>> = {
  LOBBY: ['COUNTDOWN', 'CLOSED'],
  COUNTDOWN: ['RACING', 'LOBBY', 'CLOSED'],
  RACING: ['RESULTS', 'CLOSED'],
  RESULTS: ['LOBBY', 'CLOSED'],
  CLOSED: [],
};

export function canTransition(from: RoomState, to: RoomState): boolean {
  return ROOM_TRANSITIONS[from].includes(to);
}

export function transitionRoom(from: RoomState, to: RoomState): RoomState {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal room transition: ${from} -> ${to}`);
  }
  return to;
}
