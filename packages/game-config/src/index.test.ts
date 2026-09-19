import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  DEFAULT_GAME_CONFIG,
  GAME_CONFIG_VERSION,
  parseGameConfig
} from "./index.js";

void describe("game configuration", () => {
  void it("accepts the versioned default configuration", () => {
    const config = parseGameConfig(DEFAULT_GAME_CONFIG);

    assert.equal(config.version, GAME_CONFIG_VERSION);
    assert.equal(config.match.initialMaxPlayers, 4);
    assert.equal(config.match.supportedMaxPlayers, 20);
    assert.equal(config.health.maximum, 100);
    assert.equal(config.pistol.magazineSize, 8);
    assert.equal(config.network.serverTickRateHz, 20);
  });

  void it("rejects a player target above the supported maximum", () => {
    assert.throws(() => {
      parseGameConfig({
        ...DEFAULT_GAME_CONFIG,
        match: {
          ...DEFAULT_GAME_CONFIG.match,
          initialMaxPlayers: 21
        }
      });
    });
  });

  void it("rejects a snapshot rate above the simulation rate", () => {
    assert.throws(() => {
      parseGameConfig({
        ...DEFAULT_GAME_CONFIG,
        network: {
          ...DEFAULT_GAME_CONFIG.network,
          serverTickRateHz: 20,
          snapshotRateHz: 30
        }
      });
    });
  });

  void it("rejects unknown tuning fields", () => {
    assert.throws(() => {
      parseGameConfig({
        ...DEFAULT_GAME_CONFIG,
        clientOwnsDamage: true
      });
    });
  });
});
