import type { WpmBand } from './constants.js';
import type { QuickRaceConfig, RaceConfig } from './schemas.js';

export type RoomState = 'LOBBY' | 'COUNTDOWN' | 'RACING' | 'RESULTS' | 'CLOSED';
/** `private`: created by a host and shared by code. `quick`: assembled by matchmaking. */
export type RoomKind = 'private' | 'quick';

export interface Player {
  playerId: string;
  username: string;
  connected: boolean;
  isBot: boolean;
  /** A server-simulated matchmaking racer. Ghosts are also bots; they never count towards stats. */
  isGhost: boolean;
}

export type PlayerStatus = 'racing' | 'finished' | 'disconnected' | 'dnf' | 'exited';

export interface RaceSample {
  second: number;
  raw: number;
  net: number;
  errors: number;
}

export interface RacePlayer extends Player {
  position: number;
  wpm: number;
  accuracy: number;
  status: PlayerStatus;
}

export interface RoomStatePayload {
  code: string;
  state: RoomState;
  kind: RoomKind;
  hostPlayerId: string;
  config: RaceConfig;
  players: Player[];
}

export interface RaceProgressPayload {
  code: string;
  text: string;
  startsAt: number;
  players: RacePlayer[];
}

export interface RaceResult {
  playerId: string;
  rank: number;
  username: string;
  wpm: number;
  accuracy: number;
  finishTimeMs: number | null;
  isBot: boolean;
  isGhost: boolean;
  series: RaceSample[];
}

export interface RaceResultsPayload {
  code: string;
  results: RaceResult[];
}

export interface QueueRacer {
  playerId: string;
  username: string;
  connected: boolean;
}

/** Broadcast to everyone in a matchmaking lobby whenever it changes. */
export interface QueueUpdatePayload {
  lobbyId: string;
  band: WpmBand;
  config: QuickRaceConfig;
  racers: QueueRacer[];
  seatsFilled: number;
  maxSeats: number;
  /** Time until the lobby starts, measured when the update was sent (immune to client clock skew). */
  msLeft: number;
  secondsLeft: number;
}
