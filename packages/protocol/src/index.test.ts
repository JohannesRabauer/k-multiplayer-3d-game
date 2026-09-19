import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage
} from "./index.js";

void describe("client protocol", () => {
  void it("accepts a versioned hello", () => {
    const message = parseClientMessage({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      authToken: "firebase-token",
      clientBuild: "abc123"
    });

    assert.equal(message.type, "hello");
  });

  void it("rejects an unsupported protocol version", () => {
    assert.throws(() => {
      parseClientMessage({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION + 1,
        authToken: "firebase-token",
        clientBuild: "abc123"
      });
    });
  });

  void it("rejects oversized input batches", () => {
    const frame = {
      sequence: 1,
      clientTimeMs: 1,
      movement: { x: 0, y: 1 },
      aimYaw: 0,
      aimPitch: 0
    };

    assert.throws(() => {
      parseClientMessage({
        type: "inputBatch",
        frames: Array.from({ length: 17 }, () => frame)
      });
    });
  });

  void it("rejects unknown message fields", () => {
    assert.throws(() => {
      parseClientMessage({
        type: "joinQuickPlay",
        trustedByClient: true
      });
    });
  });
});

void describe("server protocol", () => {
  void it("accepts a bounded player snapshot", () => {
    const message = parseServerMessage({
      type: "snapshot",
      serverTick: 10,
      serverTimeMs: 1_000,
      players: [
        {
          playerId: "player-1",
          team: "blue",
          position: { x: 0, y: 1, z: 2 },
          velocity: { x: 0, y: 0, z: 1 },
          yaw: 0,
          pitch: 0,
          health: 100,
          ammo: 8,
          isAlive: true,
          lastProcessedInput: 9
        }
      ]
    });

    assert.equal(message.type, "snapshot");
  });

  void it("rejects negative health", () => {
    assert.throws(() => {
      parseServerMessage({
        type: "damage",
        attackerId: "player-1",
        targetId: "player-2",
        amount: 25,
        remainingHealth: -1
      });
    });
  });
});
