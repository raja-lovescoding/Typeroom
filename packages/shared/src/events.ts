export const CLIENT_EVENTS = {
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  START_RACE: 'start_race',
  RACE_AGAIN: 'race_again',
  KEYSTROKE: 'keystroke',
} as const;

export const SERVER_EVENTS = {
  ROOM_STATE: 'room_state',
  RACE_COUNTDOWN: 'race_countdown',
  RACE_PROGRESS: 'race_progress',
  RACE_RESULTS: 'race_results',
  ERROR: 'error',
} as const;
