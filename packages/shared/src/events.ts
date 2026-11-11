export const CLIENT_EVENTS = {
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  SET_RACE_CONFIG: 'set_race_config',
  START_RACE: 'start_race',
  RACE_AGAIN: 'race_again',
  KEYSTROKE: 'keystroke',
  QUEUE_JOIN: 'queue:join',
  QUEUE_LEAVE: 'queue:leave',
} as const;

export const SERVER_EVENTS = {
  ROOM_STATE: 'room_state',
  ROOM_CLOSED: 'room_closed',
  RACE_COUNTDOWN: 'race_countdown',
  RACE_PROGRESS: 'race_progress',
  RACE_RESULTS: 'race_results',
  QUEUE_UPDATE: 'queue:update',
  QUEUE_MATCHED: 'queue:matched',
  QUEUE_CLOSED: 'queue:closed',
  ERROR: 'error',
} as const;
