import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@typeroom/shared';

export function generateRoomCode(existing: ReadonlySet<string>, random = Math.random): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
    }
    if (!existing.has(code)) return code;
  }
  throw new Error('Unable to generate a unique room code');
}
