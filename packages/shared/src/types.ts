export type RoomState = 'LOBBY' | 'COUNTDOWN' | 'RACING' | 'RESULTS' | 'CLOSED';

export interface Player {
  playerId: string;
  username: string;
  connected: boolean;
  isBot: boolean;
}

export type PlayerStatus = 'racing' | 'finished' | 'disconnected' | 'dnf';

export interface RacePlayer extends Player {
  position: number;
  wpm: number;
  accuracy: number;
  status: PlayerStatus;
}

export interface RoomStatePayload {
  code: string;
  state: RoomState;
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
}

export interface RaceResultsPayload {
  code: string;
  results: RaceResult[];
}
