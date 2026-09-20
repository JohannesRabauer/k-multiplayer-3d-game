import { randomBytes, randomUUID } from "node:crypto";

import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type InputFrame,
  type RoomMember,
  type Team
} from "@scooter-shooter/protocol";

export interface RoomPlayer {
  readonly playerId: string;
  readonly accountId: string;
  readonly displayName: string;
  readonly reconnectToken: string;
  team: Team;
  positionX: number;
  positionY: number;
  positionZ: number;
  velocityX: number;
  velocityZ: number;
  yaw: number;
  pitch: number;
  health: number;
  ammo: number;
  isAlive: boolean;
  lastProcessedInput: number;
  respawnAtMs: number;
  lastSeenMs: number;
  pendingInputs: InputFrame[];
}

export interface Room {
  readonly roomId: string;
  readonly roomCode: string;
  readonly createdAtMs: number;
  readonly players: Map<string, RoomPlayer>;
  tick: number;
  blueScore: number;
  redScore: number;
  phase: "waiting_for_players" | "countdown" | "in_progress" | "ended";
  phaseEndsAtMs: number;
  lastActivityMs: number;
}

export interface RoomRegistryOptions {
  /** Maximum players allowed in a single room. */
  readonly maxPlayersPerRoom: number;
  /** Maximum rooms held in memory at once, as a cheap abuse guard. */
  readonly maxRooms: number;
  /** How long an empty room is kept before it is reaped. */
  readonly emptyRoomTtlMs: number;
}

export const DEFAULT_ROOM_REGISTRY_OPTIONS: RoomRegistryOptions = {
  maxPlayersPerRoom: 8,
  maxRooms: 64,
  emptyRoomTtlMs: 120_000
};

export type JoinFailure = "room_not_found" | "room_unavailable" | "server_full";

export type JoinResult =
  | { readonly ok: true; readonly room: Room; readonly player: RoomPlayer }
  | { readonly ok: false; readonly reason: JoinFailure };

export function generateRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  let code = "";
  for (const byte of bytes) {
    code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length] ?? "A";
  }
  return code;
}

export function toRoomMember(player: RoomPlayer): RoomMember {
  return {
    playerId: player.playerId,
    displayName: player.displayName,
    team: player.team
  };
}

/**
 * Holds every active room in memory. This is deliberately single-instance: the
 * Cloud Run service runs with max-instances=1 so that a room code always
 * resolves to the one process that owns it. Sharing rooms across instances
 * needs an external coordinator and is tracked separately.
 */
export class RoomRegistry {
  readonly #options: RoomRegistryOptions;
  readonly #roomsByCode = new Map<string, Room>();

  constructor(options: RoomRegistryOptions = DEFAULT_ROOM_REGISTRY_OPTIONS) {
    this.#options = options;
  }

  get roomCount(): number {
    return this.#roomsByCode.size;
  }

  getByCode(roomCode: string): Room | undefined {
    return this.#roomsByCode.get(roomCode);
  }

  listRooms(): readonly Room[] {
    return [...this.#roomsByCode.values()];
  }

  createRoom(nowMs: number): Room | undefined {
    this.reapEmptyRooms(nowMs);
    if (this.#roomsByCode.size >= this.#options.maxRooms) {
      return undefined;
    }

    let roomCode = generateRoomCode();
    let attempts = 0;
    while (this.#roomsByCode.has(roomCode)) {
      attempts += 1;
      if (attempts > 16) {
        return undefined;
      }
      roomCode = generateRoomCode();
    }

    const room: Room = {
      roomId: randomUUID(),
      roomCode,
      createdAtMs: nowMs,
      players: new Map<string, RoomPlayer>(),
      tick: 0,
      blueScore: 0,
      redScore: 0,
      phase: "waiting_for_players",
      phaseEndsAtMs: 0,
      lastActivityMs: nowMs
    };
    this.#roomsByCode.set(roomCode, room);
    return room;
  }

  join(
    room: Room,
    identity: { readonly accountId: string; readonly displayName: string },
    nowMs: number
  ): JoinResult {
    if (room.players.size >= this.#options.maxPlayersPerRoom) {
      return { ok: false, reason: "room_unavailable" };
    }

    const player: RoomPlayer = {
      playerId: randomUUID(),
      accountId: identity.accountId,
      displayName: identity.displayName,
      reconnectToken: randomBytes(24).toString("hex"),
      team: this.#pickTeam(room),
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      velocityX: 0,
      velocityZ: 0,
      yaw: 0,
      pitch: 0,
      health: 100,
      ammo: 12,
      isAlive: true,
      lastProcessedInput: 0,
      respawnAtMs: 0,
      lastSeenMs: nowMs,
      pendingInputs: []
    };

    room.players.set(player.playerId, player);
    room.lastActivityMs = nowMs;
    return { ok: true, room, player };
  }

  joinByCode(
    roomCode: string,
    identity: { readonly accountId: string; readonly displayName: string },
    nowMs: number
  ): JoinResult {
    const room = this.#roomsByCode.get(roomCode);
    if (room === undefined) {
      return { ok: false, reason: "room_not_found" };
    }
    return this.join(room, identity, nowMs);
  }

  leave(room: Room, playerId: string, nowMs: number): void {
    room.players.delete(playerId);
    room.lastActivityMs = nowMs;
  }

  reapEmptyRooms(nowMs: number): number {
    let reaped = 0;
    for (const [roomCode, room] of this.#roomsByCode) {
      const isEmpty = room.players.size === 0;
      const isStale =
        nowMs - room.lastActivityMs >= this.#options.emptyRoomTtlMs;
      if (isEmpty && isStale) {
        this.#roomsByCode.delete(roomCode);
        reaped += 1;
      }
    }
    return reaped;
  }

  /** Keeps teams as even as possible, favouring blue on a tie. */
  #pickTeam(room: Room): Team {
    let blue = 0;
    let red = 0;
    for (const player of room.players.values()) {
      if (player.team === "blue") {
        blue += 1;
      } else {
        red += 1;
      }
    }
    return blue <= red ? "blue" : "red";
  }
}
