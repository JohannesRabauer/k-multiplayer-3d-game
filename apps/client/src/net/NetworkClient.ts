import {
  PROTOCOL_VERSION,
  normalizeRoomCode,
  parseServerMessage,
  type ClientMessage,
  type RoomMember,
  type ServerMessage,
  type Team
} from "@scooter-shooter/protocol";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "authenticating"
  | "joining"
  | "connected"
  | "reconnecting"
  | "failed";

export interface NetworkClientOptions {
  /** Base https URL of the game service; converted to ws/wss internally. */
  readonly serverUrl: string;
  /** Supplies a fresh Firebase ID token for every connection attempt. */
  readonly getAuthToken: () => Promise<string>;
  readonly clientBuild: string;
  readonly onStatusChange?: (status: ConnectionStatus, detail?: string) => void;
  readonly onMessage?: (message: ServerMessage) => void;
}

export interface JoinedMatch {
  readonly playerId: string;
  readonly roomCode: string;
  readonly team: Team;
  readonly members: readonly RoomMember[];
}

interface MessageWaiter {
  readonly predicate: (message: ServerMessage) => boolean;
  readonly resolve: (message: ServerMessage) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const HEARTBEAT_INTERVAL_MS = 4_000;
const RESPONSE_TIMEOUT_MS = 12_000;
const MAX_RECONNECT_ATTEMPTS = 4;

export class NetworkError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "NetworkError";
    this.reason = reason;
  }
}

/**
 * Owns the single WebSocket connection to the game service.
 *
 * Everything the game needs to know arrives through `onMessage`; this class is
 * only responsible for the connection lifecycle, the handshake, and keeping the
 * socket alive.
 */
export class NetworkClient {
  readonly #options: NetworkClientOptions;
  readonly #waiters = new Set<MessageWaiter>();
  #socket: WebSocket | undefined;
  #status: ConnectionStatus = "idle";
  #heartbeat: ReturnType<typeof setInterval> | undefined;
  #inputSequence = 0;
  #match: JoinedMatch | undefined;
  #intentionalClose = false;
  #reconnectAttempts = 0;

  constructor(options: NetworkClientOptions) {
    this.#options = options;
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  get match(): JoinedMatch | undefined {
    return this.#match;
  }

  takeInputSequence(): number {
    this.#inputSequence += 1;
    return this.#inputSequence;
  }

  /** Opens a room and returns the code to share with another player. */
  async createRoom(): Promise<JoinedMatch> {
    await this.#connect();
    return this.#requestJoin({ type: "createRoom" });
  }

  /** Joins a room that somebody else opened. */
  async joinRoom(roomCode: string): Promise<JoinedMatch> {
    const normalized = normalizeRoomCode(roomCode);
    if (normalized.length !== 6) {
      throw new NetworkError("Room codes are six characters.", "invalid_code");
    }
    await this.#connect();
    return this.#requestJoin({ type: "joinWithCode", roomCode: normalized });
  }

  sendInput(frame: {
    readonly sequence: number;
    readonly clientTimeMs: number;
    readonly movement: { readonly x: number; readonly y: number };
    readonly aimYaw: number;
    readonly aimPitch: number;
  }): void {
    this.#send({ type: "inputBatch", frames: [frame] });
  }

  sendFire(
    inputSequence: number,
    origin: { readonly x: number; readonly y: number; readonly z: number },
    direction: { readonly x: number; readonly y: number; readonly z: number }
  ): void {
    this.#send({
      type: "fireIntent",
      inputSequence,
      clientShotTimeMs: Date.now(),
      aimOrigin: origin,
      aimDirection: direction
    });
  }

  leave(): void {
    if (this.#match !== undefined) {
      this.#send({ type: "leaveMatch" });
    }
    this.#match = undefined;
  }

  disconnect(): void {
    this.#intentionalClose = true;
    this.leave();
    this.#stopHeartbeat();
    this.#socket?.close(1000, "client left");
    this.#socket = undefined;
    this.#setStatus("idle");
  }

  #setStatus(status: ConnectionStatus, detail?: string): void {
    this.#status = status;
    this.#options.onStatusChange?.(status, detail);
  }

  async #connect(): Promise<void> {
    const existing = this.#socket;
    if (existing?.readyState === WebSocket.OPEN) {
      return;
    }

    this.#intentionalClose = false;
    this.#setStatus("connecting");

    const token = await this.#options.getAuthToken();
    const socket = new WebSocket(toWebSocketUrl(this.#options.serverUrl));
    this.#socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new NetworkError("The game server did not respond.", "timeout"));
      }, RESPONSE_TIMEOUT_MS);

      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(
          new NetworkError("Could not reach the game server.", "unreachable")
        );
      });
    });

    socket.addEventListener("message", (event: MessageEvent<string>) => {
      let message: ServerMessage;
      try {
        message = parseServerMessage(JSON.parse(event.data));
      } catch {
        return;
      }
      this.#handleMessage(message);
    });

    socket.addEventListener("close", () => {
      this.#stopHeartbeat();
      if (this.#intentionalClose) {
        return;
      }
      void this.#tryReconnect();
    });

    this.#setStatus("authenticating");
    this.#send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      authToken: token,
      clientBuild: this.#options.clientBuild
    });

    await this.#waitFor(
      (message) => message.type === "welcome",
      "The server refused the connection."
    );
    this.#startHeartbeat();
    this.#reconnectAttempts = 0;
  }

  async #requestJoin(request: ClientMessage): Promise<JoinedMatch> {
    this.#setStatus("joining");
    this.#send(request);

    const response = await this.#waitFor(
      (message) =>
        message.type === "joinAccepted" || message.type === "joinRejected",
      "The server did not answer the join request."
    );

    if (response.type === "joinRejected") {
      this.#setStatus("failed", response.reason);
      throw new NetworkError(
        describeRejection(response.reason),
        response.reason
      );
    }
    if (response.type !== "joinAccepted") {
      throw new NetworkError("Unexpected join response.", "invalid_request");
    }

    const match: JoinedMatch = {
      playerId: response.playerId,
      roomCode: response.roomCode,
      team: response.team,
      members: response.members
    };
    this.#match = match;
    this.#setStatus("connected");
    return match;
  }

  #handleMessage(message: ServerMessage): void {
    for (const waiter of [...this.#waiters]) {
      if (waiter.predicate(message)) {
        this.#waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }

    if (message.type === "protocolError" && message.fatal) {
      this.#intentionalClose = true;
      this.#setStatus("failed", message.code);
    }

    this.#options.onMessage?.(message);
  }

  async #waitFor(
    predicate: (message: ServerMessage) => boolean,
    timeoutMessage: string
  ): Promise<ServerMessage> {
    return new Promise<ServerMessage>((resolve, reject) => {
      const waiter: MessageWaiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#waiters.delete(waiter);
          reject(new NetworkError(timeoutMessage, "timeout"));
        }, RESPONSE_TIMEOUT_MS)
      };
      this.#waiters.add(waiter);
    });
  }

  async #tryReconnect(): Promise<void> {
    if (this.#reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.#setStatus("failed", "connection_lost");
      return;
    }
    this.#reconnectAttempts += 1;
    this.#setStatus("reconnecting");

    const backoffMs = Math.min(8_000, 500 * 2 ** this.#reconnectAttempts);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, backoffMs);
    });

    const roomCode = this.#match?.roomCode;
    try {
      await this.#connect();
      if (roomCode !== undefined) {
        await this.#requestJoin({ type: "joinWithCode", roomCode });
      }
    } catch {
      void this.#tryReconnect();
    }
  }

  #startHeartbeat(): void {
    this.#stopHeartbeat();
    this.#heartbeat = setInterval(() => {
      this.#send({ type: "heartbeat", clientTimeMs: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat !== undefined) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = undefined;
    }
  }

  #send(message: ClientMessage): void {
    const socket = this.#socket;
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(message));
  }
}

export function toWebSocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  const isSecure = url.protocol === "https:" || url.protocol === "wss:";
  url.protocol = isSecure ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function describeRejection(reason: string): string {
  switch (reason) {
    case "authentication_required":
      return "Sign in before joining a match.";
    case "client_update_required":
      return "This build is out of date. Reload the page.";
    case "room_not_found":
      return "No game with that code. Check it and try again.";
    case "room_unavailable":
      return "That game is full.";
    case "server_full":
      return "The server is busy. Try again in a moment.";
    default:
      return "Could not join the match.";
  }
}
