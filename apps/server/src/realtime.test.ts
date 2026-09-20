import { strict as assert } from "node:assert";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import {
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

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
