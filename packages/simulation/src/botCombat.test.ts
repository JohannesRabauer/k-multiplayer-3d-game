import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";

import { computeBotHitChance, getBotShotDamage } from "./botCombat.js";

const config = DEFAULT_GAME_CONFIG.bots;

void describe("Bot combat", () => {
  void it("never guarantees a hit, even at point blank range", () => {
    const chance = computeBotHitChance({
      distanceMeters: 0,
      isTargetMoving: false
    });

    assert.equal(chance, config.closeRangeAccuracy);
    assert.ok(chance < 1);
  });

  void it("degrades accuracy as the target gets further away", () => {
    const near = computeBotHitChance({
      distanceMeters: config.accurateRangeMeters,
      isTargetMoving: false
    });
    const mid = computeBotHitChance({
      distanceMeters:
        (config.accurateRangeMeters + config.attackRangeMeters) / 2,
      isTargetMoving: false
    });
    const far = computeBotHitChance({
      distanceMeters: config.attackRangeMeters,
      isTargetMoving: false
    });

    assert.ok(near > mid);
    assert.ok(mid > far);
    assert.ok(Math.abs(far - config.longRangeAccuracy) < 1e-9);
  });

  void it("cannot reach targets beyond the engagement range", () => {
    assert.equal(
      computeBotHitChance({
        distanceMeters: config.attackRangeMeters + 0.1,
        isTargetMoving: false
      }),
      0
    );
    assert.equal(
      computeBotHitChance({
        distanceMeters: Number.POSITIVE_INFINITY,
        isTargetMoving: false
      }),
      0
    );
  });

  void it("penalises moving targets without going negative", () => {
    const still = computeBotHitChance({
      distanceMeters: 1,
      isTargetMoving: false
    });
    const moving = computeBotHitChance({
      distanceMeters: 1,
      isTargetMoving: true
    });

    assert.ok(moving < still);
    assert.ok(moving >= 0);
    assert.ok(
      computeBotHitChance({
        distanceMeters: config.attackRangeMeters,
        isTargetMoving: true
      }) >= 0
    );
  });

  void it("deals far less damage than the player pistol", () => {
    assert.equal(getBotShotDamage(), config.damage);
    assert.ok(getBotShotDamage() < DEFAULT_GAME_CONFIG.pistol.damage);
  });
});
