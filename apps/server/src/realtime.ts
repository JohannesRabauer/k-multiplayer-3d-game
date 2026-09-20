import type { Server } from "node:http";

import {
  PROTOCOL_VERSION,
  normalizeRoomCode,
  parseClientMessage,
  type ClientMessage,
  type ServerMessage
} from "@scooter-shooter/protocol";
import { WebSocketServer, type WebSocket } from "ws";

import { type FirebaseTokenVerifier, type VerifiedIdentity } from "./auth.js";
import {
  buildMatchState,
  PLAYER_TIMEOUT_MS,
  resolveFire,
  respawnPlayer,
  stepRoom,
  TICK_INTERVAL_MS
} from "./matchLoop.js";
import {
  RoomRegistry,
  toRoomMember,
  type Room,
  type RoomPlayer
} from "./rooms.js";

export interface RealtimeOptions {
  readonly buildSha: string;
  readonly verifier: FirebaseTokenVerifier;
  readonly registry?: RoomRegistry;
  readonly now?: () => number;
}

export interface RealtimeGateway {
  readonly registry: RoomRegistry;
  close(): Promise<void>;
}

interface Connection {
  readonly socket: WebSocket;
  identity: VerifiedIdentity | undefined;
  room: Room | undefined;
  player: RoomPlayer | undefined;
  lastSeenMs: number;
}

/** Largest single frame accepted, as a cheap abuse guard. */
const MAX_MESSAGE_BYTES = 16_384;
/** Input frames buffered per player before the oldest are dropped. */
const MAX_PENDING_INPUTS = 32;

export function attachRealtimeGateway(
  httpServer: Server,
  options: RealtimeOptions
): RealtimeGateway {
  const registry = options.registry ?? new RoomRegistry();
  const now = options.now ?? (() => Date.now());
  const connections = new Set<Connection>();
  const socketServer = new WebSocketServer({ server: httpServer, path: "/ws" });

  function send(connection: Connection, message: ServerMessage): void {
    if (connection.socket.readyState !== connection.socket.OPEN) {
      return;
    }
    connection.socket.send(JSON.stringify(message));
  }

  function broadcast(
    room: Room,
    message: ServerMessage,
    options?: { readonly except?: Connection }
  ): void {
    for (const connection of connections) {
      if (connection.room !== room || connection === options?.except) {
        continue;
      }
      send(connection, message);
    }
  }

  function leaveRoom(connection: Connection, nowMs: number): void {
    const { room, player } = connection;
    if (room === undefined || player === undefined) {
      return;
    }

    registry.leave(room, player.playerId, nowMs);
    connection.room = undefined;
    connection.player = undefined;
    broadcast(room, { type: "playerLeft", playerId: player.playerId });

    console.info(
      JSON.stringify({
        event: "player_left",
        roomCode: room.roomCode,
        remaining: room.players.size
      })
    );
  }

  function handleJoin(
    connection: Connection,
    message: Extract<
      ClientMessage,
      { type: "createRoom" | "joinQuickPlay" | "joinWithCode" }
    >,
    nowMs: number
  ): void {
    const identity = connection.identity;
    if (identity === undefined) {
      send(connection, {
        type: "joinRejected",
        reason: "authentication_required"
      });
      return;
    }

    if (connection.room !== undefined) {
      leaveRoom(connection, nowMs);
    }

    let result;
    if (message.type === "joinWithCode") {
      result = registry.joinByCode(
        normalizeRoomCode(message.roomCode),
        identity,
        nowMs
      );
    } else if (message.type === "createRoom") {
      const room = registry.createRoom(nowMs);
      result =
        room === undefined
          ? ({ ok: false, reason: "server_full" } as const)
          : registry.join(room, identity, nowMs);
    } else {
      result = joinQuickPlay(registry, identity, nowMs);
    }

    if (!result.ok) {
      send(connection, { type: "joinRejected", reason: result.reason });
      return;
    }

    const { room, player } = result;
    connection.room = room;
    connection.player = player;
    respawnPlayer(room, player, nowMs);

    send(connection, {
      type: "joinAccepted",
      playerId: player.playerId,
      roomId: room.roomId,
      roomCode: room.roomCode,
      reconnectToken: player.reconnectToken,
      team: player.team,
      serverTick: room.tick,
      members: [...room.players.values()].map(toRoomMember)
    });
    send(connection, buildMatchState(room, nowMs));

    broadcast(
      room,
      { type: "playerJoined", member: toRoomMember(player) },
      { except: connection }
    );

    console.info(
      JSON.stringify({
        event: "player_joined",
        roomCode: room.roomCode,
        players: room.players.size
      })
    );
  }

  async function handleMessage(
    connection: Connection,
    raw: string
  ): Promise<void> {
    const nowMs = now();
    connection.lastSeenMs = nowMs;

    let message: ClientMessage;
    try {
      message = parseClientMessage(JSON.parse(raw));
    } catch {
      send(connection, {
        type: "protocolError",
        code: "invalid_message",
        fatal: false
      });
      return;
    }

    switch (message.type) {
      case "hello": {
        if (
          (message.protocolVersion as number) !== (PROTOCOL_VERSION as number)
        ) {
          send(connection, {
            type: "protocolError",
            code: "unsupported_protocol",
            fatal: true
          });
          connection.socket.close(1002, "unsupported protocol");
          return;
        }

        try {
          connection.identity = await options.verifier.verify(
            message.authToken,
            nowMs
          );
        } catch {
          send(connection, {
            type: "protocolError",
            code: "authentication_failed",
            fatal: true
          });
          connection.socket.close(1008, "authentication failed");
          return;
        }

        send(connection, {
          type: "welcome",
          protocolVersion: PROTOCOL_VERSION,
          serverBuild: options.buildSha,
          serverTimeMs: nowMs
        });
        return;
      }

      case "createRoom":
      case "joinQuickPlay":
      case "joinWithCode": {
        handleJoin(connection, message, nowMs);
        return;
      }

      case "inputBatch": {
        const player = connection.player;
        if (player === undefined) {
          return;
        }
        player.lastSeenMs = nowMs;
        for (const frame of message.frames) {
          if (frame.sequence > player.lastProcessedInput) {
            player.pendingInputs.push(frame);
          }
        }
        if (player.pendingInputs.length > MAX_PENDING_INPUTS) {
          player.pendingInputs.splice(
            0,
            player.pendingInputs.length - MAX_PENDING_INPUTS
          );
        }
        return;
      }

      case "fireIntent": {
        const room = connection.room;
        const player = connection.player;
        if (room === undefined || player === undefined) {
          return;
        }
        player.lastSeenMs = nowMs;
        const results = resolveFire(
          room,
          player,
          {
            inputSequence: message.inputSequence,
            aimDirection: {
              x: message.aimDirection.x,
              z: message.aimDirection.z
            }
          },
          nowMs
        );
        for (const result of results) {
          broadcast(room, result);
        }
        return;
      }

      case "heartbeat": {
        if (connection.player !== undefined) {
          connection.player.lastSeenMs = nowMs;
        }
        return;
      }

      case "leaveMatch": {
        leaveRoom(connection, nowMs);
        return;
      }
    }
  }

  socketServer.on("connection", (socket: WebSocket) => {
    const connection: Connection = {
      socket,
      identity: undefined,
      room: undefined,
      player: undefined,
      lastSeenMs: now()
    };
    connections.add(connection);

    socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      const text = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
          : Buffer.from(data).toString("utf8");

      if (text.length > MAX_MESSAGE_BYTES) {
        send(connection, {
          type: "protocolError",
          code: "rate_limited",
          fatal: true
        });
        socket.close(1009, "message too large");
        return;
      }

      void handleMessage(connection, text);
    });

    socket.on("close", () => {
      leaveRoom(connection, now());
      connections.delete(connection);
    });

    socket.on("error", () => {
      leaveRoom(connection, now());
      connections.delete(connection);
    });
  });

  const ticker = setInterval(() => {
    const nowMs = now();

    for (const connection of connections) {
      const player = connection.player;
      if (
        player !== undefined &&
        nowMs - player.lastSeenMs > PLAYER_TIMEOUT_MS
      ) {
        leaveRoom(connection, nowMs);
        connection.socket.close(1001, "timed out");
      }
    }

    for (const room of registry.listRooms()) {
      if (room.players.size === 0) {
        continue;
      }
      for (const message of stepRoom(room, nowMs)) {
        broadcast(room, message);
      }
    }

    registry.reapEmptyRooms(nowMs);
  }, TICK_INTERVAL_MS);
  ticker.unref();

  return {
    registry,
    async close(): Promise<void> {
      clearInterval(ticker);
      for (const connection of connections) {
        send(connection, { type: "serverShutdown", reconnectAfterMs: 5_000 });
        connection.socket.close(1001, "server shutting down");
      }
      connections.clear();
      await new Promise<void>((resolve) => {
        socketServer.close(() => {
          resolve();
        });
      });
    }
  };
}

/** Fills the emptiest room that still has space, otherwise opens a new one. */
function joinQuickPlay(
  registry: RoomRegistry,
  identity: VerifiedIdentity,
  nowMs: number
) {
  const candidates = registry
    .listRooms()
    .filter((room) => room.players.size > 0 && room.phase !== "ended")
    .sort((left, right) => right.players.size - left.players.size);

  for (const room of candidates) {
    const result = registry.join(room, identity, nowMs);
    if (result.ok) {
      return result;
    }
  }

  const room = registry.createRoom(nowMs);
  if (room === undefined) {
    return { ok: false, reason: "server_full" } as const;
  }
  return registry.join(room, identity, nowMs);
}
