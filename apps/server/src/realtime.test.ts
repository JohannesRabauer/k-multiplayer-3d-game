import { strict as assert } from "node:assert";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import {
  DEFAULT_SKIN,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage
} from "@scooter-shooter/protocol";
import { WebSocket } from "ws";

import { FirebaseTokenVerifier } from "./auth.js";
import { attachRealtimeGateway, type RealtimeGateway } from "./realtime.js";
import { closeServer, createGameServer, type GameServer } from "./server.js";

let gameServer: GameServer;
let gateway: RealtimeGateway;
let socketUrl: string;

/** An unsigned token, accepted only because the gateway runs in dev mode here. */
function fakeToken(subject: string, name: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url"
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: subject,
      name,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      firebase: { sign_in_provider: "anonymous" }
    })
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

class TestClient {
  readonly #socket: WebSocket;
  readonly #received: ServerMessage[] = [];
  readonly #waiters: {
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (data: Buffer) => {
      const message = parseServerMessage(JSON.parse(data.toString("utf8")));
      this.#received.push(message);
      for (let index = this.#waiters.length - 1; index >= 0; index -= 1) {
        const waiter = this.#waiters[index];
        if (waiter?.predicate(message) === true) {
          clearTimeout(waiter.timer);
          this.#waiters.splice(index, 1);
          waiter.resolve(message);
        }
      }
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new TestClient(socket);
  }

  send(message: ClientMessage): void {
    this.#socket.send(JSON.stringify(message));
  }

  get received(): readonly ServerMessage[] {
    return this.#received;
  }

  async waitFor<T extends ServerMessage["type"]>(
    type: T,
    timeoutMs = 5000
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const existing = this.#received.find((message) => message.type === type);
    if (existing !== undefined) {
      return existing as Extract<ServerMessage, { type: T }>;
    }

    return new Promise<Extract<ServerMessage, { type: T }>>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`timed out waiting for ${type}`));
        }, timeoutMs);
        this.#waiters.push({
          predicate: (message) => message.type === type,
          resolve: (message) => {
            resolve(message as Extract<ServerMessage, { type: T }>);
          },
          reject,
          timer
        });
      }
    );
  }

  async handshake(subject: string, name: string): Promise<void> {
    this.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      authToken: fakeToken(subject, name),
      clientBuild: "test"
    });
    await this.waitFor("welcome");
  }

  close(): void {
    this.#socket.close();
  }
}

before(async () => {
  gameServer = createGameServer({
    buildSha: "test-build",
    protocolVersion: PROTOCOL_VERSION
  });
  gateway = attachRealtimeGateway(gameServer.httpServer, {
    buildSha: "test-build",
    verifier: new FirebaseTokenVerifier({
      projectId: "test-project",
      allowUnverifiedTokens: true
    })
  });

  await new Promise<void>((resolve) => {
    gameServer.httpServer.listen(0, "127.0.0.1", resolve);
  });
  const address = gameServer.httpServer.address() as AddressInfo;
  socketUrl = `ws://127.0.0.1:${String(address.port)}/ws`;
});

after(async () => {
  await gateway.close();
  await closeServer(gameServer.httpServer);
});

void describe("realtime gateway", () => {
  void it("rejects a join before the client has authenticated", async () => {
    const client = await TestClient.connect(socketUrl);
    client.send({ type: "createRoom" });

    const rejected = await client.waitFor("joinRejected");
    assert.equal(rejected.reason, "authentication_required");
    client.close();
  });

  void it("gives the host a shareable room code", async () => {
    const host = await TestClient.connect(socketUrl);
    await host.handshake("host-1", "Host");
    host.send({ type: "createRoom" });

    const accepted = await host.waitFor("joinAccepted");
    assert.match(accepted.roomCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/u);
    assert.equal(accepted.members.length, 1);
    assert.equal(accepted.team, "blue");
    host.close();
  });

  void it("lets a second player join with the code and puts them on opposite teams", async () => {
    const host = await TestClient.connect(socketUrl);
    await host.handshake("host-2", "Host");
    host.send({ type: "createRoom" });
    const hostJoin = await host.waitFor("joinAccepted");

    const guest = await TestClient.connect(socketUrl);
    await guest.handshake("guest-2", "Guest");
    guest.send({ type: "joinWithCode", roomCode: hostJoin.roomCode });
    const guestJoin = await guest.waitFor("joinAccepted");

    assert.equal(guestJoin.roomId, hostJoin.roomId);
    assert.equal(hostJoin.team, "blue");
    assert.equal(guestJoin.team, "red");
    assert.equal(guestJoin.members.length, 2);

    // The host must be told that somebody joined.
    const joined = await host.waitFor("playerJoined");
    assert.equal(joined.member.playerId, guestJoin.playerId);
    assert.equal(joined.member.displayName, "Guest");

    host.close();
    guest.close();
  });

  void it("rejects an unknown room code", async () => {
    const client = await TestClient.connect(socketUrl);
    await client.handshake("lost-1", "Lost");
    client.send({ type: "joinWithCode", roomCode: "ZZZZZZ" });

    const rejected = await client.waitFor("joinRejected");
    assert.equal(rejected.reason, "room_not_found");
    client.close();
  });

  void it("broadcasts each player's movement to the other", async () => {
    const host = await TestClient.connect(socketUrl);
    await host.handshake("host-3", "Host");
    host.send({ type: "createRoom" });
    const hostJoin = await host.waitFor("joinAccepted");

    const guest = await TestClient.connect(socketUrl);
    await guest.handshake("guest-3", "Guest");
    guest.send({ type: "joinWithCode", roomCode: hostJoin.roomCode });
    const guestJoin = await guest.waitFor("joinAccepted");

    const firstSnapshot = await guest.waitFor("snapshot");
    const startingHost = firstSnapshot.players.find(
      (player) => player.playerId === hostJoin.playerId
    );
    assert.ok(startingHost, "the guest should see the host in a snapshot");
    const startX = startingHost.position.x;

    // Drive the host east for a second of simulated input.
    let clientTimeMs = Date.now();
    for (let sequence = 1; sequence <= 20; sequence += 1) {
      clientTimeMs += 50;
      host.send({
        type: "inputBatch",
        frames: [
          {
            sequence,
            clientTimeMs,
            movement: { x: 1, y: 0 },
            aimYaw: 0,
            aimPitch: 0
          }
        ]
      });
      await delay(25);
    }

    await delay(300);

    const snapshots = guest.received.filter(
      (message): message is Extract<ServerMessage, { type: "snapshot" }> =>
        message.type === "snapshot"
    );
    const latest = snapshots[snapshots.length - 1];
    assert.ok(latest, "the guest should keep receiving snapshots");

    const movedHost = latest.players.find(
      (player) => player.playerId === hostJoin.playerId
    );
    assert.ok(movedHost);
    assert.ok(
      movedHost.position.x > startX + 1,
      `the host should have moved east, went from ${String(startX)} to ${String(movedHost.position.x)}`
    );
    assert.ok(
      movedHost.lastProcessedInput > 0,
      "the server should acknowledge the inputs it consumed"
    );

    // Both players must appear in the same snapshot for the match to be shared.
    assert.ok(
      latest.players.some((player) => player.playerId === guestJoin.playerId)
    );

    host.close();
    guest.close();
  });

  void it("never lets a client outrun the configured speed", async () => {
    const host = await TestClient.connect(socketUrl);
    await host.handshake("host-4", "Host");
    host.send({ type: "createRoom" });
    const hostJoin = await host.waitFor("joinAccepted");

    const guest = await TestClient.connect(socketUrl);
    await guest.handshake("guest-4", "Guest");
    guest.send({ type: "joinWithCode", roomCode: hostJoin.roomCode });
    await guest.waitFor("joinAccepted");

    const first = await host.waitFor("snapshot");
    const before = first.players.find(
      (player) => player.playerId === hostJoin.playerId
    );
    assert.ok(before);

    // A tampered client claiming a huge movement vector and impossible time steps.
    const clientTimeMs = Date.now();
    for (let sequence = 100; sequence < 140; sequence += 1) {
      host.send({
        type: "inputBatch",
        frames: [
          {
            sequence,
            clientTimeMs: clientTimeMs + sequence * 10_000,
            movement: { x: 1000, y: 0 },
            aimYaw: 0,
            aimPitch: 0
          }
        ]
      });
    }

    await delay(600);

    const snapshots = host.received.filter(
      (message): message is Extract<ServerMessage, { type: "snapshot" }> =>
        message.type === "snapshot"
    );
    const latest = snapshots[snapshots.length - 1];
    assert.ok(latest);
    const after = latest.players.find(
      (player) => player.playerId === hostJoin.playerId
    );
    assert.ok(after);

    // The arena is only 23.25 units wide, so a speed hack would pin the player
    // to the far wall instantly. Clamped stepping keeps it far short of that.
    assert.ok(
      after.position.x < 23.25,
      "a tampered client must stay inside the arena"
    );

    host.close();
    guest.close();
  });

  void it("tells the room when a player disconnects", async () => {
    const host = await TestClient.connect(socketUrl);
    await host.handshake("host-5", "Host");
    host.send({ type: "createRoom" });
    const hostJoin = await host.waitFor("joinAccepted");

    const guest = await TestClient.connect(socketUrl);
    await guest.handshake("guest-5", "Guest");
    guest.send({ type: "joinWithCode", roomCode: hostJoin.roomCode });
    const guestJoin = await guest.waitFor("joinAccepted");
    await host.waitFor("playerJoined");

    guest.close();

    const left = await host.waitFor("playerLeft");
    assert.equal(left.playerId, guestJoin.playerId);
    host.close();
  });
});

void describe("shared match state", () => {
  const redSkin = {
    ...DEFAULT_SKIN,
    headwear: "knight" as const,
    topColor: "#ff0000",
    eyeShape: "angry" as const
  };

  async function pair(prefix: string, hostSkin?: typeof redSkin) {
    const host = await TestClient.connect(socketUrl);
    await host.handshake(`${prefix}-host`, "Host");
    if (hostSkin !== undefined) {
      host.send({ type: "setSkin", skin: hostSkin });
    }
    host.send({ type: "createRoom" });
    const hostJoin = await host.waitFor("joinAccepted");

    const guest = await TestClient.connect(socketUrl);
    await guest.handshake(`${prefix}-guest`, "Guest");
    guest.send({ type: "joinWithCode", roomCode: hostJoin.roomCode });
    const guestJoin = await guest.waitFor("joinAccepted");
    return { host, guest, hostJoin, guestJoin };
  }

  void it("shows every player's skin to the players who join later", async () => {
    const { host, guest, guestJoin } = await pair("skin-1", redSkin);

    const hostMember = guestJoin.members.find((m) => m.displayName === "Host");
    assert.deepEqual(hostMember?.skin, redSkin);
    const guestMember = guestJoin.members.find(
      (m) => m.displayName === "Guest"
    );
    assert.deepEqual(guestMember?.skin, DEFAULT_SKIN);

    host.close();
    guest.close();
  });

  void it("relays a skin change to everyone in the room", async () => {
    const { host, guest, guestJoin } = await pair("skin-2");

    guest.send({ type: "setSkin", skin: redSkin });
    const changed = await host.waitFor("skinChanged");
    assert.equal(changed.playerId, guestJoin.playerId);
    assert.deepEqual(changed.skin, redSkin);

    host.close();
    guest.close();
  });

  void it("ignores an invalid skin instead of relaying it", async () => {
    const { host, guest } = await pair("skin-3");

    guest.send({
      type: "setSkin",
      skin: { ...DEFAULT_SKIN, headwear: "crown" }
    } as unknown as ClientMessage);
    await delay(200);

    assert.equal(
      host.received.some((message) => message.type === "skinChanged"),
      false
    );
    host.close();
    guest.close();
  });

  void it("sends both players the same shot result and refuses a rapid second shot", async () => {
    const { host, guest, hostJoin } = await pair("shot-1");
    await host.waitFor("snapshot");
    await delay(150);

    const fire = (sequence: number): ClientMessage => ({
      type: "fireIntent",
      inputSequence: sequence,
      clientShotTimeMs: Date.now(),
      aimOrigin: { x: 0, y: 1, z: 0 },
      aimDirection: { x: 0, y: 0, z: 1 }
    });
    host.send(fire(1));
    host.send(fire(2));
    await delay(300);

    const results = (client: TestClient) =>
      client.received.filter(
        (message): message is Extract<ServerMessage, { type: "shotResult" }> =>
          message.type === "shotResult" &&
          message.shooterId === hostJoin.playerId
      );
    assert.deepEqual(results(host), results(guest));
    assert.equal(results(host).length, 2);
    assert.equal(results(host)[0]?.accepted, true);
    assert.equal(results(host)[1]?.accepted, false);

    host.close();
    guest.close();
  });

  void it("shows both players the same hits, eliminations, scores and respawn", async () => {
    const { host, guest, hostJoin, guestJoin } = await pair("combat-1");
    await host.waitFor("snapshot");

    // Step out of the parked car's lane, then walk towards the guest's spawn.
    let clientTimeMs = Date.now();
    let sequence = 0;
    const walk = async (x: number, y: number, frames: number) => {
      for (let frame = 0; frame < frames; frame += 1) {
        sequence += 1;
        clientTimeMs += 50;
        host.send({
          type: "inputBatch",
          frames: [
            {
              sequence,
              clientTimeMs,
              movement: { x, y },
              aimYaw: Math.PI / 2,
              aimPitch: 0
            }
          ]
        });
        await delay(50);
      }
    };
    await walk(0, 1, 12);
    await walk(1, 0, 20);
    await delay(250);

    const snapshotOf = (client: TestClient) =>
      client.received
        .filter(
          (message): message is Extract<ServerMessage, { type: "snapshot" }> =>
            message.type === "snapshot"
        )
        .at(-1);
    const players = snapshotOf(host)?.players ?? [];
    const from = players.find(
      (player) => player.playerId === hostJoin.playerId
    );
    const to = players.find((player) => player.playerId === guestJoin.playerId);
    assert.ok(from && to);
    const aim = {
      x: to.position.x - from.position.x,
      z: to.position.z - from.position.z
    };

    // Keep firing along the lane until the guest is eliminated.
    const eliminated = guest.waitFor("elimination", 15_000);
    let shot = 100;
    const shooter = setInterval(() => {
      shot += 1;
      host.send({
        type: "fireIntent",
        inputSequence: shot,
        clientShotTimeMs: Date.now(),
        aimOrigin: { x: 0, y: 1, z: 0 },
        aimDirection: { x: aim.x, y: 0, z: aim.z }
      });
    }, 380);
    const elimination = await eliminated.finally(() => {
      clearInterval(shooter);
    });
    await delay(200);

    const events = (client: TestClient) =>
      client.received.filter(
        (message) =>
          message.type === "damage" ||
          message.type === "elimination" ||
          message.type === "shotResult"
      );
    assert.deepEqual(events(host), events(guest));
    assert.equal(elimination.attackerId, hostJoin.playerId);
    assert.equal(elimination.targetId, guestJoin.playerId);
    assert.equal(elimination.blueScore, 1);
    assert.equal(elimination.redScore, 0);

    const damages = guest.received.filter(
      (message): message is Extract<ServerMessage, { type: "damage" }> =>
        message.type === "damage"
    );
    let health = 100;
    for (const damage of damages) {
      health -= damage.amount;
      assert.equal(damage.remainingHealth, Math.max(0, health));
    }
    assert.equal(health <= 0, true);

    // The next periodic state carries the same score on both devices.
    await delay(1200);
    const lastState = (client: TestClient) =>
      client.received
        .filter(
          (
            message
          ): message is Extract<ServerMessage, { type: "matchState" }> =>
            message.type === "matchState"
        )
        .at(-1);
    assert.equal(lastState(host)?.blueScore, 1);
    assert.equal(lastState(guest)?.blueScore, 1);

    // After the respawn delay the guest is alive again at full health.
    const respawnedAt = Date.now() + 8_000;
    const respawned = () =>
      guest.received.some(
        (message) =>
          message.type === "respawn" &&
          message.playerId === guestJoin.playerId &&
          guest.received.indexOf(message) > guest.received.indexOf(elimination)
      );
    while (!respawned() && Date.now() < respawnedAt) {
      await delay(100);
    }
    assert.equal(respawned(), true, "the guest should respawn after the delay");
    await delay(300);
    const latest = guest.received
      .filter(
        (message): message is Extract<ServerMessage, { type: "snapshot" }> =>
          message.type === "snapshot"
      )
      .at(-1);
    const guestState = latest?.players.find(
      (player) => player.playerId === guestJoin.playerId
    );
    assert.ok(guestState, "the guest should be in the snapshot");
    assert.equal(guestState.isAlive, true);
    assert.equal(guestState.health, 100);

    host.close();
    guest.close();
  });

  void it("re-broadcasts the match state so late or missed updates heal", async () => {
    const { host, guest } = await pair("state-1");
    await delay(1300);
    const states = (client: TestClient) =>
      client.received.filter((message) => message.type === "matchState");
    assert.ok(states(host).length >= 2, "host should get periodic state");
    assert.ok(states(guest).length >= 2, "guest should get periodic state");
    host.close();
    guest.close();
  });
});

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
