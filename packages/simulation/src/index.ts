import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";

export {
  TeamDeathmatch,
  type MatchPhase,
  type TeamDeathmatchState
} from "./teamDeathmatch.js";

export {
  RoundMatch,
  type RoundMatchOptions,
  type RoundMatchState,
  type RoundOutcome,
  type RoundPhase
} from "./roundMatch.js";

export {
  computeBotHitChance,
  getBotShotDamage,
  type BotShotContext
} from "./botCombat.js";

export type Team = "blue" | "red";

export interface SpawnTransform {
  readonly x: number;
  readonly y: number;
  readonly yaw: number;
  readonly z: number;
}

export interface PlayerCombatState {
  readonly id: string;
  readonly team: Team;
  health: number;
  isAlive: boolean;
  respawnAtMs: number | undefined;
  spawnProtectionEndsAtMs: number;
}

export type DamageResult =
  | {
      readonly applied: false;
      readonly reason:
        | "friendly_fire"
        | "invalid_damage"
        | "spawn_protected"
        | "target_eliminated";
    }
  | {
      readonly applied: true;
      readonly eliminated: boolean;
      readonly remainingHealth: number;
    };

export function createPlayerCombatState(
  id: string,
  team: Team,
  nowMs: number
): PlayerCombatState {
  return {
    health: DEFAULT_GAME_CONFIG.health.maximum,
    id,
    isAlive: true,
    respawnAtMs: undefined,
    spawnProtectionEndsAtMs:
      nowMs + DEFAULT_GAME_CONFIG.match.spawnProtectionMs,
    team
  };
}

export function applyDamage(
  attacker: Readonly<PlayerCombatState>,
  target: PlayerCombatState,
  amount: number,
  nowMs: number
): DamageResult {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { applied: false, reason: "invalid_damage" };
  }
  if (!target.isAlive) {
    return { applied: false, reason: "target_eliminated" };
  }
  if (attacker.team === target.team) {
    return { applied: false, reason: "friendly_fire" };
  }
  if (nowMs < target.spawnProtectionEndsAtMs) {
    return { applied: false, reason: "spawn_protected" };
  }

  target.health = Math.max(0, target.health - Math.round(amount));
  const eliminated = target.health === 0;
  if (eliminated) {
    target.isAlive = false;
    target.respawnAtMs = nowMs + DEFAULT_GAME_CONFIG.match.respawnDelayMs;
  }

  return {
    applied: true,
    eliminated,
    remainingHealth: target.health
  };
}

export function tryRespawn(player: PlayerCombatState, nowMs: number): boolean {
  if (
    player.isAlive ||
    player.respawnAtMs === undefined ||
    nowMs < player.respawnAtMs
  ) {
    return false;
  }

  player.health = DEFAULT_GAME_CONFIG.health.maximum;
  player.isAlive = true;
  player.respawnAtMs = undefined;
  player.spawnProtectionEndsAtMs =
    nowMs + DEFAULT_GAME_CONFIG.match.spawnProtectionMs;
  return true;
}
