import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { ServerMessage } from "@scooter-shooter/protocol";

import type { NetworkClient } from "../net/NetworkClient";
import { RemotePlayerRenderer } from "./RemotePlayerRenderer";
import type { ShotEffects } from "./ShotEffects";

export interface OnlineSessionElements {
  readonly blueScore: HTMLElement;
  readonly feedback: HTMLElement;
  readonly health: HTMLElement;
  readonly matchState: HTMLElement;
  readonly redScore: HTMLElement;
  readonly respawn: HTMLElement;
  readonly timer: HTMLTimeElement;
}

/** How often local input is sent upstream, matching the server tick. */
const INPUT_SEND_INTERVAL_MS = 50;

/**
 * Drives an online match: publishes local input, applies authoritative
 * snapshots, and mirrors the server's match state into the HUD.
 *
 * The local avatar stays client-predicted for responsiveness, but the server
 * is the authority. When the two disagree by more than a small tolerance the
 * local position is snapped back.
 */
export class OnlineSessionController {
  readonly #network: NetworkClient;
  readonly #player: Mesh;
  readonly #elements: OnlineSessionElements;
  readonly #remotePlayers: RemotePlayerRenderer;
  readonly #shotEffects: ShotEffects;
  readonly #getMovement: () => { readonly x: number; readonly z: number };
  readonly #getAimYaw: () => number;

  #lastSendMs = 0;
  #health = 100;
  #isAlive = true;
  #remainingMs = 0;
  #phase = "waiting_for_players";
  #blueScore = 0;
  #redScore = 0;
  #snapshotsApplied = 0;
  #correctionCount = 0;

  constructor(
    scene: Scene,
    network: NetworkClient,
    player: Mesh,
    shotEffects: ShotEffects,
    elements: OnlineSessionElements,
    input: {
      readonly getMovement: () => { readonly x: number; readonly z: number };
      readonly getAimYaw: () => number;
    }
  ) {
    this.#network = network;
    this.#player = player;
    this.#elements = elements;
    this.#shotEffects = shotEffects;
    this.#remotePlayers = new RemotePlayerRenderer(scene);
    this.#getMovement = input.getMovement;
    this.#getAimYaw = input.getAimYaw;

    const match = network.match;
    if (match !== undefined) {
      this.#remotePlayers.setLocalPlayerId(match.playerId);
    }
  }

  get remotePlayerCount(): number {
    return this.#remotePlayers.count;
  }

  get snapshotsApplied(): number {
    return this.#snapshotsApplied;
  }

  get correctionCount(): number {
    return this.#correctionCount;
  }

  get isPlayerAlive(): boolean {
    return this.#isAlive;
  }

  get phase(): string {
    return this.#phase;
  }

  handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case "snapshot": {
        this.#applySnapshot(message);
        return;
      }
      case "matchState": {
        this.#phase = message.phase;
        this.#blueScore = message.blueScore;
        this.#redScore = message.redScore;
        this.#remainingMs = message.remainingMs;
        this.#renderMatchState();
        return;
      }
      case "damage": {
        const localId = this.#network.match?.playerId;
        if (message.targetId === localId) {
          this.#health = message.remainingHealth;
          this.#elements.health.textContent = String(this.#health);
          this.#elements.feedback.textContent = "Hit!";
        } else if (message.attackerId === localId) {
          this.#elements.feedback.textContent = `Hit for ${String(message.amount)}`;
        }
        return;
      }
      case "elimination": {
        const localId = this.#network.match?.playerId;
        this.#blueScore = message.blueScore;
        this.#redScore = message.redScore;
        if (message.targetId === localId) {
          this.#isAlive = false;
          this.#elements.respawn.textContent = "Eliminated. Respawning…";
        } else if (message.attackerId === localId) {
          this.#elements.feedback.textContent = "Elimination!";
        }
        this.#renderMatchState();
        return;
      }
      case "respawn": {
        if (message.playerId === this.#network.match?.playerId) {
          this.#isAlive = true;
          this.#health = 100;
          this.#elements.health.textContent = "100";
          this.#elements.respawn.textContent = "";
          this.#player.position.set(
            message.position.x,
            message.position.y + 1.2,
            message.position.z
          );
        }
        return;
      }
      case "shotResult": {
        if (!message.accepted || message.impactPoint === null) {
          return;
        }
        // Everyone sees every tracer, including their own.
        this.#renderTracer(message.shooterId, message.impactPoint);
        return;
      }
      case "playerLeft": {
        this.#remotePlayers.remove(message.playerId);
        return;
      }
      default:
        return;
    }
  }

  /** Publishes input and advances remote-player interpolation. */
  update(nowMs: number): void {
    this.#remotePlayers.update(nowMs);

    if (nowMs - this.#lastSendMs < INPUT_SEND_INTERVAL_MS) {
      return;
    }
    this.#lastSendMs = nowMs;

    const movement = this.#isAlive ? this.#getMovement() : { x: 0, z: 0 };

    this.#network.sendInput({
      sequence: this.#network.takeInputSequence(),
      clientTimeMs: Math.round(nowMs),
      movement: { x: movement.x, y: movement.z },
      aimYaw: this.#getAimYaw(),
      aimPitch: 0
    });

    if (this.#remainingMs > 0) {
      this.#remainingMs = Math.max(
        0,
        this.#remainingMs - INPUT_SEND_INTERVAL_MS
      );
      this.#renderTimer();
    }
  }

  dispose(): void {
    this.#remotePlayers.dispose();
  }

  #applySnapshot(message: Extract<ServerMessage, { type: "snapshot" }>): void {
    this.#snapshotsApplied += 1;
    this.#remotePlayers.applySnapshot(message.players, performance.now());

    const localId = this.#network.match?.playerId;
    if (localId === undefined) {
      return;
    }
    const local = message.players.find((player) => player.playerId === localId);
    if (local === undefined) {
      return;
    }

    this.#isAlive = local.isAlive;
    if (local.health !== this.#health) {
      this.#health = local.health;
      this.#elements.health.textContent = String(this.#health);
    }

    // Snap back only on a meaningful disagreement, so ordinary prediction
    // jitter does not fight the player's own movement.
    const dx = local.position.x - this.#player.position.x;
    const dz = local.position.z - this.#player.position.z;
    if (Math.hypot(dx, dz) > 1.5) {
      this.#correctionCount += 1;
      this.#player.position.set(
        local.position.x,
        local.position.y + 1.2,
        local.position.z
      );
    }
  }

  #renderTracer(
    shooterId: string,
    impact: { readonly x: number; readonly y: number; readonly z: number }
  ): void {
    const origin =
      shooterId === this.#network.match?.playerId
        ? this.#player.position
        : this.#remotePlayers.getPosition(shooterId);
    if (origin === undefined) {
      return;
    }
    this.#shotEffects.spawn(
      new Vector3(origin.x, 1.35, origin.z),
      new Vector3(impact.x, impact.y, impact.z)
    );
  }

  #renderMatchState(): void {
    this.#elements.blueScore.textContent = String(this.#blueScore);
    this.#elements.redScore.textContent = String(this.#redScore);
    this.#elements.matchState.dataset.phase = this.#phase;
    this.#elements.matchState.textContent =
      this.#phase === "waiting_for_players"
        ? "WAITING FOR PLAYERS"
        : this.#phase === "ended"
          ? "MATCH OVER"
          : "ONLINE MATCH";
    this.#renderTimer();
  }

  #renderTimer(): void {
    const totalSeconds = Math.max(0, Math.round(this.#remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const text = `${String(minutes)}:${seconds.toString().padStart(2, "0")}`;
    this.#elements.timer.textContent = text;
    this.#elements.timer.dateTime = `PT${String(totalSeconds)}S`;
  }
}
