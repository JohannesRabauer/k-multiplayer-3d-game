import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";

export interface BotShotContext {
  readonly distanceMeters: number;
  readonly isTargetMoving: boolean;
}

/**
 * Probability that a bot shot connects. Bots are reliable at knife range and
 * become progressively worse toward the edge of their engagement range, so they
 * can no longer snipe the player across the arena with perfect accuracy.
 */
export function computeBotHitChance(context: BotShotContext): number {
  const config = DEFAULT_GAME_CONFIG.bots;
  if (
    !Number.isFinite(context.distanceMeters) ||
    context.distanceMeters > config.attackRangeMeters
  ) {
    return 0;
  }

  const span = config.attackRangeMeters - config.accurateRangeMeters;
  const falloff =
    span <= 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            (context.distanceMeters - config.accurateRangeMeters) / span
          )
        );
  const accuracy =
    config.closeRangeAccuracy +
    (config.longRangeAccuracy - config.closeRangeAccuracy) * falloff;
  const penalty = context.isTargetMoving
    ? config.movingTargetAccuracyPenalty
    : 0;
  return Math.min(1, Math.max(0, accuracy - penalty));
}

/** Damage a connecting bot shot deals. */
export function getBotShotDamage(): number {
  return DEFAULT_GAME_CONFIG.bots.damage;
}
