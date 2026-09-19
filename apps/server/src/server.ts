import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";

export interface GameServerOptions {
  readonly buildSha: string;
  readonly protocolVersion: number;
}

export interface GameServer {
  readonly httpServer: Server;
  setReady(ready: boolean): void;
}

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff"
} as const;

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: Readonly<Record<string, boolean | number | string>>
): void {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(body));
}

export function createGameServer(options: GameServerOptions): GameServer {
  let ready = true;

  const httpServer = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "method_not_allowed" });
        return;
      }

      switch (request.url) {
        case "/healthz":
          sendJson(response, 200, { status: "ok" });
          return;
        case "/readyz":
          sendJson(response, ready ? 200 : 503, {
            status: ready ? "ready" : "shutting_down"
          });
          return;
        case "/version":
          sendJson(response, 200, {
            buildSha: options.buildSha,
            protocolVersion: options.protocolVersion
          });
          return;
        default:
          sendJson(response, 404, { error: "not_found" });
      }
    }
  );

  return {
    httpServer,
    setReady(nextReady: boolean): void {
      ready = nextReady;
    }
  };
}

export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}
