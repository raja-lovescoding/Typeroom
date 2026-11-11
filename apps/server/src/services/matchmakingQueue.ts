import { randomUUID } from 'node:crypto';
import {
  bandForWpm,
  QUICK_RACE_LOBBY_WAIT_MS,
  QUICK_RACE_MAX_RACERS,
  type QueueUpdatePayload,
  type QuickRaceConfig,
  type WpmBand,
} from '@typeroom/shared';
import type { BotRandom } from '../domain/bot.js';
import { ghostBaseWpm, ghostCountFor, ghostNames, sampleGhostWpm } from '../domain/ghost.js';

/**
 * Quick Race matchmaking. Players are grouped into lobbies by race mode. A lobby's
 * timer starts with its first player; when it ends (or the lobby fills with humans) the lobby is
 * locked and handed off as a `QuickMatch`: 2+ humans race each other, a lone human gets 1–3 ghosts.
 *
 * Everything here is process memory: nothing about the queue is written to the database. The
 * gateway only talks to the `MatchmakingQueue` interface, so a shared (e.g. Redis) implementation
 * can replace `InMemoryMatchmakingQueue` when the server runs as more than one process.
 */

export interface QueueMember {
  playerId: string;
  username: string;
  /** Server-only: links the member back to its guest session at handoff. Never broadcast. */
  token: string;
  socketId: string | undefined;
  connected: boolean;
  /** Rolling average WPM from the server's rating store at join time; undefined for newcomers. */
  averageWpm: number | undefined;
  joinedAt: number;
}

export interface Lobby {
  readonly id: string;
  readonly band: WpmBand;
  readonly config: QuickRaceConfig;
  /** Race mode key: quick lobbies mix available players who want the same race. */
  readonly key: string;
  /** In join order. */
  readonly members: Map<string, QueueMember>;
  readonly createdAt: number;
  endsAt: number;
  /** Locked lobbies accept no new players; they are about to be (or have been) handed off. */
  locked: boolean;
}

export interface GhostSeat {
  playerId: string;
  username: string;
  targetWpm: number;
}

/** A locked lobby ready to become a race room. */
export interface QuickMatch {
  lobbyId: string;
  band: WpmBand;
  config: QuickRaceConfig;
  humans: QueueMember[];
  ghosts: GhostSeat[];
}

export interface JoinRequest {
  playerId: string;
  username: string;
  token: string;
  socketId: string;
  averageWpm: number | undefined;
  config: QuickRaceConfig;
}

export type JoinOutcome =
  | { status: 'queued'; lobby: Lobby }
  /** The player was already in a lobby on a socket that has gone away; this socket takes over. */
  | { status: 'reattached'; lobby: Lobby }
  | { status: 'rejected'; reason: 'already_queued' };

export interface QueueListener {
  /** Membership, connection state or lock changed: broadcast the lobby. */
  onUpdate(lobby: Lobby): void;
  /** The lobby timer ended (or the lobby filled): build the race. The lobby no longer exists. */
  onMatch(match: QuickMatch): void;
  /** A disconnected member's grace window ran out, or their lobby started without anyone online. */
  onExpired(member: QueueMember): void;
}

export interface QueueStats {
  lobbies: number;
  openLobbies: number;
  players: number;
  timers: { lobby: number; grace: number };
}

export interface MatchmakingQueue {
  join(request: JoinRequest, now?: number): JoinOutcome;
  /** Removes the player from their lobby. Returns false if they weren't queued. */
  leave(playerId: string): boolean;
  /** The member's socket closed; they keep their seat for the grace window. Ignored for stale sockets. */
  disconnect(playerId: string, socketId: string): void;
  lobbyOf(playerId: string): Lobby | undefined;
  view(lobby: Lobby, now?: number): QueueUpdatePayload;
  stats(): QueueStats;
  /** Drops every lobby and timer; returns the members that were queued so they can be told. */
  close(): QueueMember[];
}

export interface MatchmakingOptions {
  waitMs: number;
  maxRacers: number;
  /** How long a disconnected member keeps their seat. */
  graceMs: number;
  random: BotRandom;
}

export const DEFAULT_MATCHMAKING_OPTIONS: MatchmakingOptions = {
  waitMs: QUICK_RACE_LOBBY_WAIT_MS,
  maxRacers: QUICK_RACE_MAX_RACERS,
  graceMs: 5_000,
  random: { next: Math.random },
};

export function configKey(config: QuickRaceConfig): string {
  switch (config.mode) {
    case 'time': return `time:${config.seconds}:${config.punctuation ? 1 : 0}`;
    case 'words': return `words:${config.count}:${config.punctuation ? 1 : 0}`;
    case 'quote': return `quote:${config.length}`;
  }
}

export class InMemoryMatchmakingQueue implements MatchmakingQueue {
  private readonly lobbies = new Map<string, Lobby>();
  /** lobby key -> id of the lobby currently accepting players for it */
  private readonly open = new Map<string, string>();
  /** playerId -> lobby id; makes "one queue at a time" and every lookup O(1) */
  private readonly byPlayer = new Map<string, string>();
  private readonly lobbyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly options: MatchmakingOptions;

  constructor(
    private readonly listener: QueueListener,
    options: Partial<MatchmakingOptions> = {},
  ) {
    this.options = { ...DEFAULT_MATCHMAKING_OPTIONS, ...options };
  }

  join(request: JoinRequest, now = Date.now()): JoinOutcome {
    const current = this.lobbyOf(request.playerId);
    if (current) {
      const member = current.members.get(request.playerId);
      if (!member || member.connected) return { status: 'rejected', reason: 'already_queued' };
      member.connected = true;
      member.socketId = request.socketId;
      member.username = request.username;
      this.clearGrace(request.playerId);
      this.listener.onUpdate(current);
      return { status: 'reattached', lobby: current };
    }

    const band = bandForWpm(request.averageWpm);
    // Quick Race accepts any available speed; the band remains useful for display and ghost tuning.
    const key = configKey(request.config);
    const openId = this.open.get(key);
    const lobby = (openId ? this.lobbies.get(openId) : undefined) ?? this.createLobby(key, band, request.config, now);
    lobby.members.set(request.playerId, {
      playerId: request.playerId,
      username: request.username,
      token: request.token,
      socketId: request.socketId,
      connected: true,
      averageWpm: request.averageWpm,
      joinedAt: now,
    });
    this.byPlayer.set(request.playerId, lobby.id);
    // A full house of humans doesn't wait: lock now, hand off on the next turn of the event loop
    // (after this join has been acknowledged).
    if (lobby.members.size >= this.options.maxRacers) {
      this.lock(lobby);
      lobby.endsAt = now;
      this.schedule(lobby, 0);
    }
    this.listener.onUpdate(lobby);
    return { status: 'queued', lobby };
  }

  leave(playerId: string): boolean {
    const lobby = this.lobbyOf(playerId);
    if (!lobby) return false;
    this.remove(lobby, playerId);
    if (this.lobbies.has(lobby.id)) this.listener.onUpdate(lobby);
    return true;
  }

  disconnect(playerId: string, socketId: string): void {
    const lobby = this.lobbyOf(playerId);
    const member = lobby?.members.get(playerId);
    if (!lobby || !member || member.socketId !== socketId) return;
    member.connected = false;
    member.socketId = undefined;
    this.clearGrace(playerId);
    this.graceTimers.set(playerId, setTimeout(() => {
      this.graceTimers.delete(playerId);
      const stillThere = this.lobbyOf(playerId);
      const stale = stillThere?.members.get(playerId);
      if (!stillThere || !stale || stale.connected) return;
      this.remove(stillThere, playerId);
      this.listener.onExpired(stale);
      if (this.lobbies.has(stillThere.id)) this.listener.onUpdate(stillThere);
    }, this.options.graceMs));
    this.listener.onUpdate(lobby);
  }

  lobbyOf(playerId: string): Lobby | undefined {
    const id = this.byPlayer.get(playerId);
    return id ? this.lobbies.get(id) : undefined;
  }

  view(lobby: Lobby, now = Date.now()): QueueUpdatePayload {
    const msLeft = Math.max(0, Math.round(lobby.endsAt - now));
    const racers = [...lobby.members.values()].map((member) => ({ playerId: member.playerId, username: member.username, connected: member.connected }));
    return {
      lobbyId: lobby.id,
      band: lobby.band,
      config: lobby.config,
      racers,
      seatsFilled: racers.length,
      maxSeats: this.options.maxRacers,
      msLeft,
      secondsLeft: Math.ceil(msLeft / 1_000),
    };
  }

  stats(): QueueStats {
    return {
      lobbies: this.lobbies.size,
      openLobbies: this.open.size,
      players: this.byPlayer.size,
      timers: { lobby: this.lobbyTimers.size, grace: this.graceTimers.size },
    };
  }

  close(): QueueMember[] {
    const members = [...this.lobbies.values()].flatMap((lobby) => [...lobby.members.values()]);
    for (const timer of this.lobbyTimers.values()) clearTimeout(timer);
    for (const timer of this.graceTimers.values()) clearTimeout(timer);
    this.lobbyTimers.clear();
    this.graceTimers.clear();
    this.lobbies.clear();
    this.open.clear();
    this.byPlayer.clear();
    return members;
  }

  // ---- internals ------------------------------------------------------------------------------

  private createLobby(key: string, band: WpmBand, config: QuickRaceConfig, now: number): Lobby {
    const lobby: Lobby = {
      id: randomUUID(),
      band,
      config,
      key,
      members: new Map(),
      createdAt: now,
      endsAt: now + this.options.waitMs,
      locked: false,
    };
    this.lobbies.set(lobby.id, lobby);
    this.open.set(key, lobby.id);
    this.schedule(lobby, this.options.waitMs);
    return lobby;
  }

  private schedule(lobby: Lobby, delayMs: number): void {
    const previous = this.lobbyTimers.get(lobby.id);
    if (previous) clearTimeout(previous);
    this.lobbyTimers.set(lobby.id, setTimeout(() => {
      this.lobbyTimers.delete(lobby.id);
      this.launch(lobby);
    }, delayMs));
  }

  private lock(lobby: Lobby): void {
    lobby.locked = true;
    if (this.open.get(lobby.key) === lobby.id) this.open.delete(lobby.key);
  }

  /** The timer ended: decide the line-up and hand the lobby off. */
  private launch(lobby: Lobby): void {
    if (!this.lobbies.has(lobby.id)) return;
    this.lock(lobby);
    // Members who dropped and are still inside their grace window keep their seat; the race room
    // then gives them its own disconnect grace, exactly as for a private room.
    const humans = [...lobby.members.values()];
    this.destroy(lobby);
    // Nobody is online to race: don't start a race for ghosts alone.
    if (!humans.some((member) => member.connected)) {
      for (const member of humans) this.listener.onExpired(member);
      return;
    }
    const { random } = this.options;
    const ghostCount = ghostCountFor(humans.length, random);
    const lead = humans[0];
    const base = ghostBaseWpm(lobby.band, lead?.averageWpm);
    const names = ghostNames(ghostCount, new Set(humans.map((member) => member.username)), random);
    const ghosts = names.map((username) => ({ playerId: `ghost-${randomUUID()}`, username, targetWpm: sampleGhostWpm(base, random) }));
    this.listener.onMatch({ lobbyId: lobby.id, band: lobby.band, config: lobby.config, humans, ghosts });
  }

  private remove(lobby: Lobby, playerId: string): void {
    lobby.members.delete(playerId);
    this.byPlayer.delete(playerId);
    this.clearGrace(playerId);
    if (lobby.members.size === 0) this.destroy(lobby);
  }

  private destroy(lobby: Lobby): void {
    const timer = this.lobbyTimers.get(lobby.id);
    if (timer) clearTimeout(timer);
    this.lobbyTimers.delete(lobby.id);
    if (this.open.get(lobby.key) === lobby.id) this.open.delete(lobby.key);
    for (const playerId of lobby.members.keys()) {
      if (this.byPlayer.get(playerId) === lobby.id) this.byPlayer.delete(playerId);
      this.clearGrace(playerId);
    }
    this.lobbies.delete(lobby.id);
  }

  private clearGrace(playerId: string): void {
    const timer = this.graceTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(playerId);
  }
}
