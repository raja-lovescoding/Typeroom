import type { Player, RoomState } from '@typeroom/shared';
import { generateRoomCode } from '../domain/roomCode.js';
import { transitionRoom } from '../domain/roomStateMachine.js';

interface Room {
  code: string;
  state: RoomState;
  players: Map<string, Player>;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  getOrCreate(code?: string): Room {
    if (code) {
      const room = this.rooms.get(code);
      if (room) return room;
    }
    const roomCode = code ?? generateRoomCode(new Set(this.rooms.keys()));
    const room: Room = { code: roomCode, state: 'LOBBY', players: new Map() };
    this.rooms.set(roomCode, room);
    return room;
  }

  addPlayer(code: string, player: Player): Room {
    const room = this.getOrCreate(code);
    room.players.set(player.playerId, player);
    return room;
  }

  transition(code: string, state: RoomState): Room {
    const room = this.getOrCreate(code);
    room.state = transitionRoom(room.state, state);
    return room;
  }

  snapshot(code: string): { code: string; state: RoomState; players: Player[] } {
    const room = this.getOrCreate(code);
    return { code: room.code, state: room.state, players: [...room.players.values()] };
  }
}
