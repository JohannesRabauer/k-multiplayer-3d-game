import { z } from "zod";

export const GAME_CONFIG_VERSION = 1 as const;

const millisecondsSchema = z.number().int().positive();

export const gameConfigSchema = z
  .object({
    version: z.literal(GAME_CONFIG_VERSION),
    match: z
      .object({
        initialMaxPlayers: z.number().int().min(2).max(20),
        supportedMaxPlayers: z.number().int().min(2).max(20),
        minimumPlayers: z.number().int().min(2).max(20),
        durationMs: millisecondsSchema,
        countdownMs: millisecondsSchema,
        resultDurationMs: millisecondsSchema,
        scoreLimit: z.number().int().positive(),
        respawnDelayMs: millisecondsSchema,
        spawnProtectionMs: millisecondsSchema
      })
      .strict(),
    movement: z
      .object({
        speedMetersPerSecond: z.number().positive().max(20),
        inputDeadZone: z.number().min(0).max(0.5),
        maximumInputMagnitude: z.number().positive().max(1),
        minimumPitchRadians: z
          .number()
          .min(-Math.PI / 2)
          .max(0),
        maximumPitchRadians: z
          .number()
          .min(0)
          .max(Math.PI / 2)
      })
      .strict(),
    camera: z
      .object({
        aimPitchRadiansPerSecond: z
          .number()
          .positive()
          .max(Math.PI * 4),
        aimYawRadiansPerSecond: z
          .number()
          .positive()
          .max(Math.PI * 4),
        angularSensibility: z.number().positive(),
        collisionRadiusMeters: z.number().positive().max(5),
        initialRadiusMeters: z.number().positive().max(50),
        maximumPitchRadians: z.number().min(0).max(Math.PI),
        maximumRadiusMeters: z.number().positive().max(100),
        minimumPitchRadians: z.number().min(0).max(Math.PI),
        minimumRadiusMeters: z.number().positive().max(50)
      })
      .strict(),
    health: z
      .object({
        maximum: z.number().int().positive().max(10_000)
      })
      .strict(),
    rounds: z
      .object({
        roundsToWin: z.number().int().positive().max(9),
        roundDurationMs: millisecondsSchema,
        warmupMs: millisecondsSchema,
        intermissionMs: millisecondsSchema,
        resultDurationMs: millisecondsSchema
      })
      .strict(),
    bots: z
      .object({
        attackRangeMeters: z.number().positive().max(100),
        accurateRangeMeters: z.number().positive().max(100),
        closeRangeAccuracy: z.number().min(0).max(1),
        longRangeAccuracy: z.number().min(0).max(1),
        movingTargetAccuracyPenalty: z.number().min(0).max(1),
        reactionTimeMs: millisecondsSchema,
        attackIntervalMs: millisecondsSchema,
        burstRecoveryMs: millisecondsSchema,
        damage: z.number().int().positive().max(100),
        missSpreadDegrees: z.number().positive().max(45)
      })
      .strict(),
    pistol: z
      .object({
        damage: z.number().int().positive(),
        magazineSize: z.number().int().positive().max(100),
        fireIntervalMs: millisecondsSchema,
        reloadDurationMs: millisecondsSchema,
        rangeMeters: z.number().positive().max(1_000),
        autoFireThreshold: z.number().min(0).max(1),
        lagCompensationMaximumMs: z.number().int().nonnegative().max(1_000)
      })
      .strict(),
    network: z
      .object({
        serverTickRateHz: z.number().int().min(10).max(60),
        snapshotRateHz: z.number().int().min(1).max(60),
        maximumInputBatchSize: z.number().int().min(1).max(64),
        maximumMessageBytes: z.number().int().min(1_024).max(1_048_576),
        reconnectGracePeriodMs: millisecondsSchema,
        reconnectAttemptWindowMs: millisecondsSchema
      })
      .strict()
  })
  .strict()
  .superRefine((config, context) => {
    if (config.match.initialMaxPlayers > config.match.supportedMaxPlayers) {
      context.addIssue({
        code: "custom",
        message: "initialMaxPlayers cannot exceed supportedMaxPlayers",
        path: ["match", "initialMaxPlayers"]
      });
    }

    if (config.match.minimumPlayers > config.match.initialMaxPlayers) {
      context.addIssue({
        code: "custom",
        message: "minimumPlayers cannot exceed initialMaxPlayers",
        path: ["match", "minimumPlayers"]
      });
    }

    if (
      config.movement.minimumPitchRadians >= config.movement.maximumPitchRadians
    ) {
      context.addIssue({
        code: "custom",
        message: "minimumPitchRadians must be lower than maximumPitchRadians",
        path: ["movement", "minimumPitchRadians"]
      });
    }

    if (
      config.camera.minimumPitchRadians >= config.camera.maximumPitchRadians
    ) {
      context.addIssue({
        code: "custom",
        message:
          "camera minimumPitchRadians must be lower than maximumPitchRadians",
        path: ["camera", "minimumPitchRadians"]
      });
    }

    if (config.camera.minimumRadiusMeters > config.camera.initialRadiusMeters) {
      context.addIssue({
        code: "custom",
        message: "camera minimumRadiusMeters cannot exceed initialRadiusMeters",
        path: ["camera", "minimumRadiusMeters"]
      });
    }

    if (config.camera.initialRadiusMeters > config.camera.maximumRadiusMeters) {
      context.addIssue({
        code: "custom",
        message: "camera initialRadiusMeters cannot exceed maximumRadiusMeters",
        path: ["camera", "initialRadiusMeters"]
      });
    }

    if (config.network.snapshotRateHz > config.network.serverTickRateHz) {
      context.addIssue({
        code: "custom",
        message: "snapshotRateHz cannot exceed serverTickRateHz",
        path: ["network", "snapshotRateHz"]
      });
    }

    if (config.bots.accurateRangeMeters > config.bots.attackRangeMeters) {
      context.addIssue({
        code: "custom",
        message: "bot accurateRangeMeters cannot exceed attackRangeMeters",
        path: ["bots", "accurateRangeMeters"]
      });
    }

    if (config.bots.longRangeAccuracy > config.bots.closeRangeAccuracy) {
      context.addIssue({
        code: "custom",
        message: "bot longRangeAccuracy cannot exceed closeRangeAccuracy",
        path: ["bots", "longRangeAccuracy"]
      });
    }
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;

export const DEFAULT_GAME_CONFIG: Readonly<GameConfig> = gameConfigSchema.parse(
  {
    version: GAME_CONFIG_VERSION,
    match: {
      initialMaxPlayers: 4,
      supportedMaxPlayers: 20,
      minimumPlayers: 2,
      durationMs: 240_000,
      countdownMs: 10_000,
      resultDurationMs: 8_000,
      scoreLimit: 20,
      respawnDelayMs: 3_000,
      spawnProtectionMs: 1_500
    },
    movement: {
      speedMetersPerSecond: 6,
      inputDeadZone: 0.1,
      maximumInputMagnitude: 1,
      minimumPitchRadians: -Math.PI / 3,
      maximumPitchRadians: Math.PI / 3
    },
    camera: {
      aimPitchRadiansPerSecond: Math.PI * 0.65,
      aimYawRadiansPerSecond: Math.PI,
      angularSensibility: 2_500,
      collisionRadiusMeters: 0.35,
      initialRadiusMeters: 9,
      maximumPitchRadians: Math.PI / 2.1,
      maximumRadiusMeters: 11,
      minimumPitchRadians: Math.PI / 5,
      minimumRadiusMeters: 4
    },
    health: {
      maximum: 100
    },
    rounds: {
      roundsToWin: 3,
      roundDurationMs: 90_000,
      warmupMs: 4_000,
      intermissionMs: 5_000,
      resultDurationMs: 10_000
    },
    bots: {
      attackRangeMeters: 11,
      accurateRangeMeters: 4,
      closeRangeAccuracy: 0.6,
      longRangeAccuracy: 0.15,
      movingTargetAccuracyPenalty: 0.2,
      reactionTimeMs: 500,
      attackIntervalMs: 950,
      burstRecoveryMs: 1_800,
      damage: 8,
      missSpreadDegrees: 10
    },
    pistol: {
      damage: 25,
      magazineSize: 8,
      fireIntervalMs: 350,
      reloadDurationMs: 1_500,
      rangeMeters: 35,
      autoFireThreshold: 0.35,
      lagCompensationMaximumMs: 200
    },
    network: {
      serverTickRateHz: 20,
      snapshotRateHz: 10,
      maximumInputBatchSize: 16,
      maximumMessageBytes: 16_384,
      reconnectGracePeriodMs: 15_000,
      reconnectAttemptWindowMs: 15_000
    }
  }
);

export function parseGameConfig(value: unknown): GameConfig {
  return gameConfigSchema.parse(value);
}
