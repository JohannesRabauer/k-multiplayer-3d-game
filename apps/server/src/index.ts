import { PROTOCOL_VERSION } from "@scooter-shooter/protocol";

import { closeServer, createGameServer } from "./server.js";

const DEFAULT_PORT = 8080;
const SHUTDOWN_TIMEOUT_MS = 10_000;

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `PORT must be an integer from 1 through 65535, got: ${value}`
    );
  }
  return port;
}

const port = readPort(process.env.PORT);
const gameServer = createGameServer({
  buildSha: process.env.BUILD_SHA ?? "development",
  protocolVersion: PROTOCOL_VERSION
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  gameServer.setReady(false);
  console.info(JSON.stringify({ event: "server_shutdown_started", signal }));

  const forceExitTimer = setTimeout(() => {
    console.error(JSON.stringify({ event: "server_shutdown_timed_out" }));
    process.exitCode = 1;
    gameServer.httpServer.closeAllConnections();
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    await closeServer(gameServer.httpServer);
    clearTimeout(forceExitTimer);
    console.info(JSON.stringify({ event: "server_shutdown_completed" }));
  } catch (error: unknown) {
    clearTimeout(forceExitTimer);
    console.error(
      JSON.stringify({
        event: "server_shutdown_failed",
        message: error instanceof Error ? error.message : "unknown error"
      })
    );
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

gameServer.httpServer.listen(port, "0.0.0.0", () => {
  console.info(
    JSON.stringify({
      buildSha: process.env.BUILD_SHA ?? "development",
      event: "server_started",
      port,
      protocolVersion: PROTOCOL_VERSION
    })
  );
});
