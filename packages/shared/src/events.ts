export const CLIENT_EVENTS = {
  JOIN_ROOM: 'join_room',
  KEYSTROKE: 'keystroke',
} as const;

export const SERVER_EVENTS = {
  ROOM_STATE: 'room_state',
  PLAYER_DISCONNECTED: 'player_disconnected',
} as const;
