import { randomUUID } from 'node:crypto';
import {
  DEFAULT_RACE_CONFIG,
  MAX_PLAYERS_PER_ROOM,
  type Player,
  type RaceConfig,
  type RacePlayer,
  type RaceResult,
  type RoomKind,
  type RoomState,
  type RoomStatePayload,
} from '@typeroom/shared';
import { generateRoomCode } from '../domain/roomCode.js';
import { scoreKeystroke } from '../domain/scoring.js';
import { transitionRoom } from '../domain/roomStateMachine.js';

export interface RoomPlayer extends Player {
  token?: string;
  /** Target speed for bots; undefined for humans. */
  botWpm?: number;
  position: number;
  correctChars: number;
  errors: number;
  keystrokeTimes: number[];
  status: RacePlayer['status'];
  finishTimeMs: number | null;
  series: { second: number; raw: number; net: number; errors: number }[];
  socketId?: string;
}

export type NewPlayer = Omit<RoomPlayer, 'position' | 'correctChars' | 'errors' | 'keystrokeTimes' | 'series' | 'status' | 'finishTimeMs' | 'isGhost'> & {
  /** Only matchmaking ghosts set this. */
  isGhost?: boolean;
};

export interface Room {
  code: string;
  /** Quick rooms are built by matchmaking: no host controls, no race-again, no late joiners. */
  kind: RoomKind;
  state: RoomState;
  hostPlayerId: string;
  config: RaceConfig;
  players: Map<string, RoomPlayer>;
  text: string | null;
  /** Attribution of the current text (quote mode). */
  source: string | null;
  startsAt: number | null;
  raceStartedAt: number | null;
  /** Hard limit of the current race, from its start. */
  timeLimitMs: number | null;
  /** Set while no human in the room is connected; used to close abandoned rooms. */
  idleSince?: number;
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

/** Server-side cap on keystrokes per player per rolling second. */
const BURST_LIMIT = 25;

function freshPlayer(player: NewPlayer): RoomPlayer {
  return { isGhost: false, ...player, position: 0, correctChars: 0, errors: 0, keystrokeTimes: [], series: [], status: 'racing', finishTimeMs: null };
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  createRoom(
    host: NewPlayer,
    options: { botTargetWpm?: number | undefined; config?: RaceConfig | undefined; kind?: RoomKind } = {},
  ): Room {
    const code = generateRoomCode(new Set(this.rooms.keys()));
    const player = freshPlayer(host);
    const room: Room = {
      code,
      kind: options.kind ?? 'private',
      state: 'LOBBY',
      hostPlayerId: player.playerId,
      config: options.config ?? DEFAULT_RACE_CONFIG,
      players: new Map([[player.playerId, player]]),
      text: null,
      source: null,
      startsAt: null,
      raceStartedAt: null,
      timeLimitMs: null,
      disconnectTimers: new Map(),
    };
    this.rooms.set(code, room);
    if (options.botTargetWpm !== undefined) {
      const botId = `bot-${randomUUID()}`;
      room.players.set(botId, freshPlayer({
        playerId: botId,
        username: `Bot (${options.botTargetWpm} WPM)`,
        connected: true,
        isBot: true,
        isGhost: false,
        botWpm: options.botTargetWpm,
      }));
    }
    return room;
  }

  /** Seats a matchmaking ghost. Ghosts are bots driven by the race loop like the practice bot. */
  addGhost(room: Room, ghost: { playerId: string; username: string; targetWpm: number }): void {
    if (room.state !== 'LOBBY') throw new Error('Room is not accepting players');
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) throw new Error('Room is full');
    room.players.set(ghost.playerId, freshPlayer({
      playerId: ghost.playerId,
      username: ghost.username,
      connected: true,
      isBot: true,
      isGhost: true,
      botWpm: ghost.targetWpm,
    }));
  }

  /** True when any racer in the room is a ghost: such races never count towards stats. */
  hasGhosts(room: Room): boolean {
    return [...room.players.values()].some((player) => player.isGhost);
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  list(): IterableIterator<Room> {
    return this.rooms.values();
  }

  joinRoom(code: string, player: NewPlayer): Room {
    const room = this.rooms.get(code);
    if (!room) throw new Error('Room not found');
    const existing = room.players.get(player.playerId);
    if (existing) {
      existing.connected = true;
      if (player.socketId) existing.socketId = player.socketId;
      return room;
    }
    if (room.state !== 'LOBBY') throw new Error('Room is not accepting players');
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) throw new Error('Room is full');
    room.players.set(player.playerId, freshPlayer(player));
    return room;
  }

  /**
   * Removes a player. Returns true when the room should close: nobody human is left, or (private
   * rooms only) the host left. Quick rooms have no real host, so they live on for whoever remains.
   */
  leaveRoom(code: string, playerId: string): boolean {
    const room = this.rooms.get(code);
    if (!room) return false;
    room.players.delete(playerId);
    const timer = room.disconnectTimers.get(playerId);
    if (timer) clearTimeout(timer);
    room.disconnectTimers.delete(playerId);
    if (room.kind === 'quick' && room.state === 'RESULTS') return true;
    const humansLeft = [...room.players.values()].some((player) => !player.isBot);
    if (!humansLeft) return true;
    if (room.kind === 'quick') {
      if (room.hostPlayerId === playerId) room.hostPlayerId = [...room.players.values()].find((player) => !player.isBot)?.playerId ?? playerId;
      return false;
    }
    return room.hostPlayerId === playerId;
  }

  setConfig(room: Room, config: RaceConfig): void {
    if (room.state !== 'LOBBY') throw new Error('The race mode can only be changed in the lobby');
    room.config = config;
  }

  transition(room: Room, state: RoomState): void {
    room.state = transitionRoom(room.state, state);
  }

  startRace(
    room: Room,
    race: { text: string; source?: string | undefined },
    now: number,
    countdownMs = 5_000,
    timeLimitMs = 120_000,
  ): void {
    this.transition(room, 'COUNTDOWN');
    room.text = race.text;
    room.source = race.source ?? null;
    room.startsAt = now + countdownMs;
    room.raceStartedAt = null;
    room.timeLimitMs = timeLimitMs;
    for (const player of room.players.values()) {
      player.position = 0;
      player.correctChars = 0;
      player.errors = 0;
      player.keystrokeTimes = [];
      player.series = [];
      player.status = player.connected ? 'racing' : 'disconnected';
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
    if (player.keystrokeTimes.length >= BURST_LIMIT) return { accepted: false, finished: false, reason: 'burst' };
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

  exitRace(room: Room, playerId: string): void {
    const player = room.players.get(playerId);
    if (!player || (room.state !== 'COUNTDOWN' && room.state !== 'RACING')) return;
    player.connected = false;
    player.status = 'exited';
  }

  /** The socket went away. During a race the racer keeps their position until the grace window ends. */
  markDisconnected(room: Room, playerId: string): void {
    const player = room.players.get(playerId);
    if (!player) return;
    player.connected = false;
    if (player.status === 'racing' && (room.state === 'RACING' || room.state === 'COUNTDOWN')) player.status = 'disconnected';
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

  /**
   * The race clock ran out. In time mode that is the normal end: everyone still connected
   * finishes with the full duration. In every other mode, anyone who hasn't finished is DNF.
   */
  expire(room: Room): void {
    const limit = room.timeLimitMs ?? 0;
    for (const player of room.players.values()) {
      if (room.config.mode === 'time' && player.status === 'racing') {
        player.status = 'finished';
        player.finishTimeMs = limit;
      } else if (player.status === 'racing' || player.status === 'disconnected') {
        player.status = 'dnf';
      }
    }
  }

  progress(room: Room, now: number): RacePlayer[] {
    return [...room.players.values()].map((player) => {
      const elapsed = room.raceStartedAt === null ? 0 : Math.max(1, Math.min(now - room.raceStartedAt, room.timeLimitMs ?? Infinity));
      const total = player.correctChars + player.errors;
      const second = Math.round(elapsed / 1_000 * 10) / 10;
      const lastSample = player.series.at(-1);
      if (second > (lastSample?.second ?? 0)) {
        const minutes = elapsed / 60_000;
        player.series.push({
          second,
          raw: Math.round((total / 5 / minutes) * 10) / 10,
          net: Math.round((player.correctChars / 5 / minutes) * 10) / 10,
          errors: player.errors,
        });
      }
      return {
        playerId: player.playerId,
        username: player.username,
        connected: player.connected,
        isBot: player.isBot,
        isGhost: player.isGhost,
        position: player.position,
        wpm: Math.round((player.correctChars / 5 / ((player.finishTimeMs ?? elapsed) / 60_000)) * 10) / 10,
        accuracy: total === 0 ? 100 : Math.round((player.correctChars / total) * 100),
        status: player.status,
      };
    });
  }

  /**
   * Final standings. Finishers rank above everyone else. In time mode all finishers raced the same
   * duration, so the most correct characters wins; otherwise the fastest finish wins. Racers who
   * didn't finish are ordered by how far they got.
   */
  results(room: Room, now: number): RaceResult[] {
    const elapsed = room.raceStartedAt === null ? 0 : Math.max(1, now - room.raceStartedAt);
    const byTime = room.config.mode === 'time';
    return [...room.players.values()]
      .sort((a, b) => {
        if (a.finishTimeMs !== null && b.finishTimeMs !== null) {
          if (byTime) return b.correctChars - a.correctChars || a.errors - b.errors;
          return a.finishTimeMs - b.finishTimeMs;
        }
        if (a.finishTimeMs !== null) return -1;
        if (b.finishTimeMs !== null) return 1;
        return b.position - a.position;
      })
      .map((player, index) => {
        const total = player.correctChars + player.errors;
        const second = Math.round(elapsed / 1_000 * 10) / 10;
        const lastSample = player.series.at(-1);
        if (second > (lastSample?.second ?? 0)) {
          const minutes = elapsed / 60_000;
          player.series.push({
            second,
            raw: Math.round((total / 5 / minutes) * 10) / 10,
            net: Math.round((player.correctChars / 5 / minutes) * 10) / 10,
            errors: player.errors,
          });
        }
        return {
          playerId: player.playerId,
          rank: index + 1,
          username: player.username,
          wpm: Math.round((player.correctChars / 5 / (Math.max(1, player.finishTimeMs ?? elapsed) / 60_000)) * 10) / 10,
          accuracy: total === 0 ? 100 : Math.round((player.correctChars / total) * 100),
          finishTimeMs: player.finishTimeMs,
          isBot: player.isBot,
          isGhost: player.isGhost,
          series: player.series,
        };
      });
  }

  allDone(room: Room): boolean {
    return [...room.players.values()].every((player) => player.status === 'finished' || player.status === 'dnf' || player.status === 'exited');
  }

  close(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    if (room.tickTimer) clearInterval(room.tickTimer);
    if (room.finishTimer) clearTimeout(room.finishTimer);
    for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
    room.state = 'CLOSED';
    this.rooms.delete(code);
  }

  snapshot(room: Room): RoomStatePayload {
    return {
      code: room.code,
      state: room.state,
      kind: room.kind,
      hostPlayerId: room.hostPlayerId,
      config: room.config,
      players: [...room.players.values()].map((player) => ({
        playerId: player.playerId,
        username: player.username,
        connected: player.connected,
        isBot: player.isBot,
        isGhost: player.isGhost,
      })),
    };
  }
}
