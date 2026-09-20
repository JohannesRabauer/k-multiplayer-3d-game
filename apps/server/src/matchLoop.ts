import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";
import {
  getSpawn,
  raycastCircle,
  raycastObstacles,
  resolveMovement,
  PLAYER_RADIUS
} from "@scooter-shooter/simulation";
import type { PlayerSnapshot, ServerMessage } from "@scooter-shooter/protocol";

import type { Room, RoomPlayer } from "./rooms.js";

/** Authoritative simulation rate. 20 Hz keeps Cloud Run CPU cost negligible. */
export const TICK_RATE_HZ = 20;
export const TICK_INTERVAL_MS = Math.round(1000 / TICK_RATE_HZ);

/** Largest time step credited to a single input frame, as an anti-speed guard. */
const MAX_FRAME_STEP_MS = 60;
/** Most input frames processed per player per tick, bounding catch-up. */
const MAX_FRAMES_PER_TICK = 8;
/** A player that stops sending anything for this long is dropped. */
export const PLAYER_TIMEOUT_MS = 15_000;

const MOVE_SPEED = DEFAULT_GAME_CONFIG.movement.speedMetersPerSecond;
const MAX_HEALTH = DEFAULT_GAME_CONFIG.health.maximum;
const RESPAWN_DELAY_MS = DEFAULT_GAME_CONFIG.match.respawnDelayMs;
const SCORE_LIMIT = DEFAULT_GAME_CONFIG.match.scoreLimit;
const MATCH_DURATION_MS = DEFAULT_GAME_CONFIG.match.durationMs;
const PISTOL_DAMAGE = DEFAULT_GAME_CONFIG.pistol.damage;
const PISTOL_RANGE = DEFAULT_GAME_CONFIG.pistol.rangeMeters;
const MAGAZINE_SIZE = DEFAULT_GAME_CONFIG.pistol.magazineSize;

/** A match needs at least this many players before the timer starts. */
const MIN_PLAYERS_TO_START = DEFAULT_GAME_CONFIG.match.minimumPlayers;

export function respawnPlayer(
  room: Room,
  player: RoomPlayer,
  nowMs: number
): void {
  let index = 0;
  for (const other of room.players.values()) {
    if (other === player) {
      break;
    }
    if (other.team === player.team) {
      index += 1;
    }
  }

  const spawn = getSpawn(player.team, index);
  player.positionX = spawn.x;
  player.positionY = 0;
  player.positionZ = spawn.z;
  player.velocityX = 0;
  player.velocityZ = 0;
  player.yaw = spawn.yaw;
  player.pitch = 0;
  player.health = MAX_HEALTH;
  player.ammo = MAGAZINE_SIZE;
  player.isAlive = true;
  player.respawnAtMs = 0;
  player.lastSeenMs = nowMs;
}

export function toPlayerSnapshot(player: RoomPlayer): PlayerSnapshot {
  return {
    playerId: player.playerId,
    team: player.team,
    position: {
      x: round(player.positionX),
      y: round(player.positionY),
      z: round(player.positionZ)
    },
    velocity: {
      x: round(player.velocityX),
      y: 0,
      z: round(player.velocityZ)
    },
    yaw: round(player.yaw),
    pitch: round(player.pitch),
    health: player.health,
    ammo: player.ammo,
    isAlive: player.isAlive,
    lastProcessedInput: player.lastProcessedInput
  };
}

/**
 * Advances one room by a single tick and returns the messages that must be
 * broadcast. Movement is re-simulated from the client's own input frames so
 * that client-side prediction reconciles, but every step is clamped here so a
 * tampered client cannot move further or faster than the rules allow.
 */
export function stepRoom(room: Room, nowMs: number): readonly ServerMessage[] {
  const messages: ServerMessage[] = [];
  room.tick += 1;

  advancePhase(room, nowMs, messages);

  for (const player of room.players.values()) {
    if (!player.isAlive) {
      if (player.respawnAtMs > 0 && nowMs >= player.respawnAtMs) {
        respawnPlayer(room, player, nowMs);
        messages.push({
          type: "respawn",
          playerId: player.playerId,
          position: {
            x: round(player.positionX),
            y: round(player.positionY),
            z: round(player.positionZ)
          },
          yaw: round(player.yaw),
          protectionEndsAtMs:
            nowMs + DEFAULT_GAME_CONFIG.match.spawnProtectionMs
        });
      }
      player.pendingInputs.length = 0;
      continue;
    }

    applyInputs(player);
  }

  messages.push({
    type: "snapshot",
    serverTick: room.tick,
    serverTimeMs: nowMs,
    players: [...room.players.values()].map(toPlayerSnapshot)
  });

  return messages;
}

function applyInputs(player: RoomPlayer): void {
  const frames = player.pendingInputs.splice(0, MAX_FRAMES_PER_TICK);
  if (frames.length === 0) {
    player.velocityX = 0;
    player.velocityZ = 0;
    return;
  }

  let previousTimeMs: number | undefined;
  let totalX = 0;
  let totalZ = 0;

  for (const frame of frames) {
    if (frame.sequence <= player.lastProcessedInput) {
      continue;
    }

    const rawStep =
      previousTimeMs === undefined
        ? TICK_INTERVAL_MS
        : frame.clientTimeMs - previousTimeMs;
    previousTimeMs = frame.clientTimeMs;
    const stepMs = clamp(rawStep, 0, MAX_FRAME_STEP_MS);

    // Never trust the magnitude a client sends; a unit vector is the most it
    // can ever be worth.
    const magnitude = Math.hypot(frame.movement.x, frame.movement.y);
    const scale = magnitude > 1 ? 1 / magnitude : 1;
    const distance = (MOVE_SPEED * stepMs) / 1000;
    const deltaX = frame.movement.x * scale * distance;
    const deltaZ = frame.movement.y * scale * distance;

    const resolved = resolveMovement(
      player.positionX,
      player.positionZ,
      player.positionX + deltaX,
      player.positionZ + deltaZ
    );
    totalX += resolved.x - player.positionX;
    totalZ += resolved.z - player.positionZ;
    player.positionX = resolved.x;
    player.positionZ = resolved.z;

    player.yaw = frame.aimYaw;
    player.pitch = clamp(frame.aimPitch, -Math.PI / 2, Math.PI / 2);
    player.lastProcessedInput = frame.sequence;
  }

  const elapsedSeconds = TICK_INTERVAL_MS / 1000;
  player.velocityX = round(totalX / elapsedSeconds);
  player.velocityZ = round(totalZ / elapsedSeconds);
}

/**
 * Resolves a shot against the authoritative world. The client sends where it
 * believes it was aiming, but the origin is snapped back to the server's own
 * position for the shooter so a client cannot shoot from somewhere it is not.
 */
export function resolveFire(
  room: Room,
  shooter: RoomPlayer,
  request: {
    readonly inputSequence: number;
    readonly aimDirection: { readonly x: number; readonly z: number };
  },
  nowMs: number
): readonly ServerMessage[] {
  const messages: ServerMessage[] = [];

  const rejected: ServerMessage = {
    type: "shotResult",
    shooterId: shooter.playerId,
    inputSequence: request.inputSequence,
    accepted: false,
    hitPlayerId: null,
    impactPoint: null
  };

  if (room.phase !== "in_progress" || !shooter.isAlive || shooter.ammo <= 0) {
    return [rejected];
  }

  const length = Math.hypot(request.aimDirection.x, request.aimDirection.z);
  if (length < 1e-6) {
    return [rejected];
  }
  const directionX = request.aimDirection.x / length;
  const directionZ = request.aimDirection.z / length;

  shooter.ammo = Math.max(0, shooter.ammo - 1);
  if (shooter.ammo === 0) {
    shooter.ammo = MAGAZINE_SIZE;
  }

  const wallDistance =
    raycastObstacles(
      shooter.positionX,
      shooter.positionZ,
      directionX,
      directionZ,
      PISTOL_RANGE
    ) ?? PISTOL_RANGE;

  let target: RoomPlayer | undefined;
  let targetDistance = wallDistance;

  for (const candidate of room.players.values()) {
    if (
      candidate === shooter ||
      !candidate.isAlive ||
      candidate.team === shooter.team
    ) {
      continue;
    }

    const distance = raycastCircle(
      shooter.positionX,
      shooter.positionZ,
      directionX,
      directionZ,
      candidate.positionX,
      candidate.positionZ,
      PLAYER_RADIUS,
      targetDistance
    );
    if (distance !== undefined && distance <= targetDistance) {
      target = candidate;
      targetDistance = distance;
    }
  }

  const impactPoint = {
    x: round(shooter.positionX + directionX * targetDistance),
    y: round(1.35),
    z: round(shooter.positionZ + directionZ * targetDistance)
  };

  messages.push({
    type: "shotResult",
    shooterId: shooter.playerId,
    inputSequence: request.inputSequence,
    accepted: true,
    hitPlayerId: target?.playerId ?? null,
    impactPoint
  });

  if (target === undefined) {
    return messages;
  }

  target.health = Math.max(0, target.health - PISTOL_DAMAGE);
  messages.push({
    type: "damage",
    attackerId: shooter.playerId,
    targetId: target.playerId,
    amount: PISTOL_DAMAGE,
    remainingHealth: target.health
  });

  if (target.health > 0) {
    return messages;
  }

  target.isAlive = false;
  target.respawnAtMs = nowMs + RESPAWN_DELAY_MS;
  if (shooter.team === "blue") {
    room.blueScore += 1;
  } else {
    room.redScore += 1;
  }

  messages.push({
    type: "elimination",
    attackerId: shooter.playerId,
    targetId: target.playerId,
    blueScore: room.blueScore,
    redScore: room.redScore
  });

  return messages;
}

function advancePhase(
  room: Room,
  nowMs: number,
  messages: ServerMessage[]
): void {
  const previousPhase = room.phase;

  switch (room.phase) {
    case "waiting_for_players": {
      if (room.players.size >= MIN_PLAYERS_TO_START) {
        room.phase = "in_progress";
        room.phaseEndsAtMs = nowMs + MATCH_DURATION_MS;
        for (const player of room.players.values()) {
          respawnPlayer(room, player, nowMs);
        }
      }
      break;
    }
    case "countdown": {
      if (nowMs >= room.phaseEndsAtMs) {
        room.phase = "in_progress";
        room.phaseEndsAtMs = nowMs + MATCH_DURATION_MS;
      }
      break;
    }
    case "in_progress": {
      const reachedScore =
        room.blueScore >= SCORE_LIMIT || room.redScore >= SCORE_LIMIT;
      if (reachedScore || nowMs >= room.phaseEndsAtMs) {
        room.phase = "ended";
        room.phaseEndsAtMs = nowMs + DEFAULT_GAME_CONFIG.match.resultDurationMs;
      } else if (room.players.size < MIN_PLAYERS_TO_START) {
        room.phase = "waiting_for_players";
        room.phaseEndsAtMs = 0;
      }
      break;
    }
    case "ended": {
      if (nowMs >= room.phaseEndsAtMs) {
        room.blueScore = 0;
        room.redScore = 0;
        room.phase =
          room.players.size >= MIN_PLAYERS_TO_START
            ? "in_progress"
            : "waiting_for_players";
        room.phaseEndsAtMs =
          room.phase === "in_progress" ? nowMs + MATCH_DURATION_MS : 0;
        for (const player of room.players.values()) {
          respawnPlayer(room, player, nowMs);
        }
      }
      break;
    }
  }

  if (room.phase !== previousPhase) {
    messages.push(buildMatchState(room, nowMs));
  }
}

export function buildMatchState(room: Room, nowMs: number): ServerMessage {
  const winningTeam =
    room.phase === "ended"
      ? room.blueScore === room.redScore
        ? null
        : room.blueScore > room.redScore
          ? "blue"
          : "red"
      : null;

  return {
    type: "matchState",
    phase: room.phase,
    blueScore: room.blueScore,
    redScore: room.redScore,
    remainingMs: Math.max(0, Math.round(room.phaseEndsAtMs - nowMs)),
    winningTeam
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
