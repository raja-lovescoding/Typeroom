export type RoomState = 'LOBBY' | 'COUNTDOWN' | 'RACING' | 'RESULTS' | 'CLOSED';

export interface Player {
  playerId: string;
  username: string;
  connected: boolean;
}

export interface RoomStatePayload {
  code: string;
  state: RoomState;
  players: Player[];
}
