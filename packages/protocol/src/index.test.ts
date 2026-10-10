import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  MAX_SAVED_SKINS,
  createDefaultLibrary,
  getActiveSkin,
  parseSkinLibrary,
  removeSkin,
  selectSkin,
  serializeSkinLibrary,
  upsertSkin,
  DEFAULT_SKIN,
  PROTOCOL_VERSION,
  parseSkinOrDefault,
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

void describe("skins", () => {
  void it("accepts the default skin in a setSkin message", () => {
    const message = parseClientMessage({ type: "setSkin", skin: DEFAULT_SKIN });
    assert.equal(message.type, "setSkin");
  });

  void it("rejects unknown items and malformed colours", () => {
    assert.throws(() => {
      parseClientMessage({
        type: "setSkin",
        skin: { ...DEFAULT_SKIN, headwear: "crown" }
      });
    });
    assert.throws(() => {
      parseClientMessage({
        type: "setSkin",
        skin: { ...DEFAULT_SKIN, topColor: "red" }
      });
    });
  });

  void it("falls back to the default skin for invalid stored data", () => {
    assert.deepEqual(parseSkinOrDefault({ nonsense: true }), DEFAULT_SKIN);
    const custom = { ...DEFAULT_SKIN, topColor: "#AABBCC", glasses: "round" };
    assert.deepEqual(parseSkinOrDefault(custom), {
      ...custom,
      topColor: "#aabbcc"
    });
  });
});

void describe("skin library", () => {
  void it("round-trips a saved skin through serialisation (restart)", () => {
    const custom = {
      ...DEFAULT_SKIN,
      headwear: "tophat" as const,
      topColor: "#112233"
    };
    const library = upsertSkin(createDefaultLibrary(), {
      id: "mine",
      name: "Night out",
      skin: custom
    });
    const restored = parseSkinLibrary(serializeSkinLibrary(library));
    assert.equal(restored.activeId, "mine");
    assert.deepEqual(getActiveSkin(restored), custom);
    assert.equal(restored.skins.length, 2);
  });

  void it("recovers from corrupt storage", () => {
    assert.deepEqual(parseSkinLibrary("{not json"), createDefaultLibrary());
    assert.deepEqual(parseSkinLibrary(null), createDefaultLibrary());
    assert.deepEqual(
      parseSkinLibrary(
        JSON.stringify({ version: 1, activeId: "x", skins: [] })
      ),
      createDefaultLibrary()
    );
  });

  void it("keeps one skin when the last is removed and caps the library", () => {
    let library = createDefaultLibrary();
    library = removeSkin(library, "default");
    assert.equal(library.skins.length, 1);
    for (let index = 0; index < 20; index += 1) {
      library = upsertSkin(library, {
        id: `s${String(index)}`,
        name: "x",
        skin: DEFAULT_SKIN
      });
    }
    assert.equal(library.skins.length, MAX_SAVED_SKINS);
    assert.equal(selectSkin(library, "missing").activeId, library.activeId);
  });
});
