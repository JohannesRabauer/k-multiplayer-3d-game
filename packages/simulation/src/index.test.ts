import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { applyDamage, createPlayerCombatState, tryRespawn } from "./index.js";

void describe("health and respawn simulation", () => {
  void it("applies bounded damage and schedules an elimination", () => {
    const attacker = createPlayerCombatState("attacker", "blue", 0);
    const target = createPlayerCombatState("target", "red", 0);

    const result = applyDamage(attacker, target, 150, 2_000);

    assert.deepEqual(result, {
      applied: true,
      eliminated: true,
      remainingHealth: 0
    });
    assert.equal(target.isAlive, false);
    assert.equal(target.respawnAtMs, 5_000);
  });

  void it("rejects friendly fire and damage during spawn protection", () => {
    const attacker = createPlayerCombatState("attacker", "blue", 0);
    const teammate = createPlayerCombatState("teammate", "blue", 0);
    const opponent = createPlayerCombatState("opponent", "red", 0);

    assert.deepEqual(applyDamage(attacker, teammate, 25, 2_000), {
      applied: false,
      reason: "friendly_fire"
    });
    assert.deepEqual(applyDamage(attacker, opponent, 25, 1_000), {
      applied: false,
      reason: "spawn_protected"
    });
  });

  void it("cannot damage an eliminated target twice", () => {
    const attacker = createPlayerCombatState("attacker", "blue", 0);
    const target = createPlayerCombatState("target", "red", 0);
    applyDamage(attacker, target, 100, 2_000);

    assert.deepEqual(applyDamage(attacker, target, 25, 2_001), {
      applied: false,
      reason: "target_eliminated"
    });
  });

  void it("respawns only after the configured delay", () => {
    const attacker = createPlayerCombatState("attacker", "blue", 0);
    const target = createPlayerCombatState("target", "red", 0);
    applyDamage(attacker, target, 100, 2_000);

    assert.equal(tryRespawn(target, 4_999), false);
    assert.equal(tryRespawn(target, 5_000), true);
    assert.equal(target.health, 100);
    assert.equal(target.isAlive, true);
    assert.equal(target.spawnProtectionEndsAtMs, 6_500);
  });

  void it("rejects non-positive and non-finite damage", () => {
    const attacker = createPlayerCombatState("attacker", "blue", 0);
    const target = createPlayerCombatState("target", "red", 0);

    assert.deepEqual(applyDamage(attacker, target, 0, 2_000), {
      applied: false,
      reason: "invalid_damage"
    });
    assert.deepEqual(applyDamage(attacker, target, Number.NaN, 2_000), {
      applied: false,
      reason: "invalid_damage"
    });
  });
});
