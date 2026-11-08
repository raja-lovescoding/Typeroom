import { randomUUID } from 'node:crypto';
import type {
  Player,
  RacePlayer,
  RaceResult,
  RoomState,
} from '@typeroom/shared';
import { generateRoomCode } from '../domain/roomCode.js';
import { scoreKeystroke } from '../domain/scoring.js';
import { transitionRoom } from '../domain/roomStateMachine.js';

export interface RoomPlayer extends Player {
  token?: string;
  position: number;
  correctChars: number;
  errors: number;
  keystrokeTimes: number[];
  status: RacePlayer['status'];
  finishTimeMs: number | null;
  socketId?: string;
}

export interface Room {
  code: string;
  state: RoomState;
  hostPlayerId: string;
  players: Map<string, RoomPlayer>;
  text: string | null;
  startsAt: number | null;
  raceStartedAt: number | null;
  countdownTimer?: ReturnType<typeof setTimeout>;
  tickTimer?: ReturnType<typeof setInterval>;
  finishTimer?: ReturnType<typeof setTimeout>;
  disconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
}

export interface KeystrokeResult {
  accepted: boolean;
  finished: boolean;
  reason?: 'before_start' | 'wrong_index' | 'finished' | 'not_racing' | 'burst';
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  createRoom(host: Omit<RoomPlayer, 'position' | 'correctChars' | 'errors' | 'keystrokeTimes' | 'status' | 'finishTimeMs'>, botTargetWpm?: number): Room {
    const code = generateRoomCode(new Set(this.rooms.keys()));
    const player: RoomPlayer = {
      ...host,
      position: 0,
      correctChars: 0,
      errors: 0,
      keystrokeTimes: [],
      status: 'racing',
      finishTimeMs: null,
    };
    player.status = 'racing';
    const room: Room = {
      code,
      state: 'LOBBY',
      hostPlayerId: player.playerId,
      players: new Map([[player.playerId, player]]),
      text: null,
      startsAt: null,
      raceStartedAt: null,
      disconnectTimers: new Map(),
    };
    this.rooms.set(code, room);
    if (botTargetWpm !== undefined) {
      const botId = `bot-${randomUUID()}`;
      room.players.set(botId, {
        playerId: botId,
        username: `Bot (${botTargetWpm} WPM)`,
        connected: true,
        isBot: true,
        position: 0,
        correctChars: 0,
        errors: 0,
        keystrokeTimes: [],
        status: 'racing',
        finishTimeMs: null,
      });
    }
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  list(): IterableIterator<Room> {
    return this.rooms.values();
  }

  joinRoom(code: string, player: Omit<RoomPlayer, 'position' | 'correctChars' | 'errors' | 'keystrokeTimes' | 'status' | 'finishTimeMs'>): Room {
    const room = this.rooms.get(code);
    if (!room) throw new Error('Room not found');
    if (room.state !== 'LOBBY') throw new Error('Room is not accepting players');
    if (room.players.size >= 5) throw new Error('Room is full');
    const existing = room.players.get(player.playerId);
    if (existing) {
      existing.connected = true;
      if (player.socketId) existing.socketId = player.socketId;
      return room;
    }
    room.players.set(player.playerId, {
      ...player,
      position: 0,
      correctChars: 0,
      errors: 0,
      keystrokeTimes: [],
      status: 'racing',
      finishTimeMs: null,
    });
    return room;
  }

  leaveRoom(code: string, playerId: string): boolean {
    const room = this.rooms.get(code);
    if (!room) return false;
    room.players.delete(playerId);
    const timer = room.disconnectTimers.get(playerId);
    if (timer) clearTimeout(timer);
    room.disconnectTimers.delete(playerId);
    if (room.players.size === 0 || room.hostPlayerId === playerId) {
      this.close(code);
      return true;
    }
    return false;
  }

  transition(room: Room, state: RoomState): void {
    room.state = transitionRoom(room.state, state);
  }

  startRace(room: Room, text: string, now: number, countdownMs = 5_000): void {
    this.transition(room, 'COUNTDOWN');
    room.text = text;
    room.startsAt = now + countdownMs;
    room.raceStartedAt = null;
    for (const player of room.players.values()) {
      player.position = 0;
      player.correctChars = 0;
      player.errors = 0;
      player.keystrokeTimes = [];
      player.status = 'racing';
      player.finishTimeMs = null;
    }
  }

  beginRace(room: Room, now: number): void {
    this.transition(room, 'RACING');
    room.raceStartedAt = now;
  }

  handleKeystroke(room: Room, playerId: string, char: string, index: number, now: number): KeystrokeResult {
    const player = room.players.get(playerId);
    if (!player || room.state !== 'RACING' || !room.text || room.raceStartedAt === null) {
      return { accepted: false, finished: false, reason: 'not_racing' };
    }
    if (now < room.raceStartedAt) return { accepted: false, finished: false, reason: 'before_start' };
    if (player.status === 'finished' || player.status === 'dnf') {
      return { accepted: false, finished: false, reason: 'finished' };
    }
    if (index !== player.position) return { accepted: false, finished: false, reason: 'wrong_index' };
    player.keystrokeTimes = player.keystrokeTimes.filter((time) => now - time < 1_000);
    if (player.keystrokeTimes.length >= 25) return { accepted: false, finished: false, reason: 'burst' };
    player.keystrokeTimes.push(now);
    const result = scoreKeystroke(room.text, player.position, char, now - room.raceStartedAt, player.correctChars, player.errors);
    player.position = result.position;
    if (result.correct) player.correctChars += 1;
    else player.errors += 1;
    if (player.position === room.text.length) {
      player.status = 'finished';
      player.finishTimeMs = now - room.raceStartedAt;
    }
    return { accepted: true, finished: player.status === 'finished' };
  }

  markDisconnected(room: Room, playerId: string): void {
    const player = room.players.get(playerId);
    if (player && player.status === 'racing') player.status = 'disconnected';
    if (room.state === 'RACING' && player) player.connected = false;
  }

  reconnect(room: Room, playerId: string, socketId: string): void {
    const player = room.players.get(playerId);
    if (!player) throw new Error('Player not found');
    player.connected = true;
    player.socketId = socketId;
    if (player.status === 'disconnected') player.status = 'racing';
    const timer = room.disconnectTimers.get(playerId);
    if (timer) clearTimeout(timer);
    room.disconnectTimers.delete(playerId);
  }

  markDnf(room: Room, playerId: string): void {
    const player = room.players.get(playerId);
    if (player && player.status === 'disconnected') player.status = 'dnf';
  }

  progress(room: Room, now: number): RacePlayer[] {
    return [...room.players.values()].map((player) => {
      const elapsed = room.raceStartedAt === null ? 0 : Math.max(1, now - room.raceStartedAt);
      const total = player.correctChars + player.errors;
      return {
        playerId: player.playerId,
        username: player.username,
        connected: player.connected,
        isBot: player.isBot,
        position: player.position,
        wpm: Math.round((player.correctChars / 5 / (elapsed / 60_000)) * 10) / 10,
        accuracy: total === 0 ? 100 : Math.round((player.correctChars / total) * 100),
        status: player.status,
      };
    });
  }

  results(room: Room, now: number): RaceResult[] {
    const elapsed = room.raceStartedAt === null ? 0 : Math.max(1, now - room.raceStartedAt);
    return [...room.players.values()]
      .sort((a, b) => {
        if (a.finishTimeMs === null) return 1;
        if (b.finishTimeMs === null) return -1;
        return a.finishTimeMs - b.finishTimeMs;
      })
      .map((player, index) => {
        const total = player.correctChars + player.errors;
        return {
          playerId: player.playerId,
          rank: index + 1,
          username: player.username,
          wpm: Math.round((player.correctChars / 5 / (Math.max(1, player.finishTimeMs ?? elapsed) / 60_000)) * 10) / 10,
          accuracy: total === 0 ? 100 : Math.round((player.correctChars / total) * 100),
          finishTimeMs: player.finishTimeMs,
          isBot: player.isBot,
        };
      });
  }

  allDone(room: Room): boolean {
    return [...room.players.values()].every((player) => player.status === 'finished' || player.status === 'dnf');
  }

  close(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    if (room.tickTimer) clearInterval(room.tickTimer);
    if (room.finishTimer) clearTimeout(room.finishTimer);
    for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
    this.rooms.delete(code);
  }

  snapshot(room: Room): { code: string; state: RoomState; players: Player[] } {
    return {
      code: room.code,
      state: room.state,
      players: [...room.players.values()].map((player) => ({
        playerId: player.playerId,
        username: player.username,
        connected: player.connected,
        isBot: player.isBot,
      })),
    };
  }
}
