import { strict as assert } from "node:assert";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { closeServer, createGameServer, type GameServer } from "./server.js";

let gameServer: GameServer;
let baseUrl: string;

before(async () => {
  gameServer = createGameServer({
    buildSha: "test-build",
    protocolVersion: 1
  });

  await new Promise<void>((resolve) => {
    gameServer.httpServer.listen(0, "127.0.0.1", resolve);
  });

  const address = gameServer.httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

after(async () => {
  await closeServer(gameServer.httpServer);
});

void describe("game server health endpoints", () => {
  void it("reports liveness", async () => {
    const response = await fetch(`${baseUrl}/livez`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  void it("reports readiness changes", async () => {
    gameServer.setReady(false);
    const unavailableResponse = await fetch(`${baseUrl}/readyz`);
    assert.equal(unavailableResponse.status, 503);

    gameServer.setReady(true);
    const readyResponse = await fetch(`${baseUrl}/readyz`);
    assert.equal(readyResponse.status, 200);
  });

  void it("reports a safe build and protocol version", async () => {
    const response = await fetch(`${baseUrl}/version`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      buildSha: "test-build",
      protocolVersion: 1
    });
  });

  void it("rejects unsupported methods and routes", async () => {
    const methodResponse = await fetch(`${baseUrl}/livez`, {
      method: "POST"
    });
    const routeResponse = await fetch(`${baseUrl}/missing`);

    assert.equal(methodResponse.status, 405);
    assert.equal(routeResponse.status, 404);
  });
});
