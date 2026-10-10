import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { ServerMessage, Team } from "@scooter-shooter/protocol";

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
/** Prediction error below this is ordinary jitter and left alone. */
const CORRECTION_DEADZONE = 0.35;
/** Beyond this the player is simply put where the server says. */
const HARD_SNAP_DISTANCE = 3;
/** Share of a moderate error removed per snapshot, for a smooth pull-back. */
const CORRECTION_BLEND = 0.3;
const MAX_HISTORY = 120;

interface PredictedPosition {
  readonly sequence: number;
  x: number;
  z: number;
}

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
  readonly #setLocalVisible: (visible: boolean) => void;
  readonly #history: PredictedPosition[] = [];

  #phaseEndsAtMs = 0;
  #lastSendMs = 0;
  #health = 100;
  #isAlive = true;
  #shownSeconds = -1;
  #phase = "waiting_for_players";
  #winningTeam: Team | null = null;
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
      readonly setLocalVisible?: (visible: boolean) => void;
    }
  ) {
    this.#network = network;
    this.#player = player;
    this.#elements = elements;
    this.#shotEffects = shotEffects;
    this.#remotePlayers = new RemotePlayerRenderer(scene);
    this.#getMovement = input.getMovement;
    this.#getAimYaw = input.getAimYaw;
    this.#setLocalVisible = input.setLocalVisible ?? (() => undefined);

    const match = network.match;
    if (match !== undefined) {
      this.#createTeamRing(scene, match.team);
      this.#remotePlayers.setLocalPlayerId(match.playerId);
      for (const member of match.members) {
        this.#remotePlayers.registerMember(member);
      }
    }
  }

  get remotePlayerCount(): number {
    return this.#remotePlayers.count;
  }

  get remoteSummary(): ReturnType<RemotePlayerRenderer["describe"]> {
    return this.#remotePlayers.describe();
  }

  get scores(): { readonly blue: number; readonly red: number } {
    return { blue: this.#blueScore, red: this.#redScore };
  }

  get health(): number {
    return this.#health;
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
        this.#phaseEndsAtMs = performance.now() + message.remainingMs;
        this.#winningTeam = message.winningTeam;
        this.#renderMatchState();
        return;
      }
      case "joinAccepted": {
        // A reconnect lands in the same room under a new player id.
        this.#remotePlayers.setLocalPlayerId(message.playerId);
        for (const member of message.members) {
          this.#remotePlayers.registerMember(member);
        }
        this.#history.length = 0;
        this.#health = 100;
        this.#isAlive = true;
        this.#elements.health.textContent = "100";
        return;
      }
      case "playerJoined": {
        this.#remotePlayers.registerMember(message.member);
        return;
      }
      case "skinChanged": {
        this.#remotePlayers.setSkin(message.playerId, message.skin);
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
          this.#setAlive(false);
        } else if (message.attackerId === localId) {
          this.#elements.feedback.textContent = "Elimination!";
        }
        this.#renderMatchState();
        return;
      }
      case "respawn": {
        if (message.playerId === this.#network.match?.playerId) {
          this.#setAlive(true);
          this.#health = 100;
          this.#elements.health.textContent = "100";
          this.#history.length = 0;
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
    this.#renderTimer(nowMs);

    if (nowMs - this.#lastSendMs < INPUT_SEND_INTERVAL_MS) {
      return;
    }
    this.#lastSendMs = nowMs;

    const movement = this.#isAlive ? this.#getMovement() : { x: 0, z: 0 };

    const sequence = this.#network.takeInputSequence();
    this.#network.sendInput({
      sequence,
      clientTimeMs: Math.round(nowMs),
      movement: { x: movement.x, y: movement.z },
      aimYaw: this.#getAimYaw(),
      aimPitch: 0
    });

    // Remember where prediction put the player when this frame was sent, so a
    // later snapshot can be compared with the same moment in time.
    this.#history.push({
      sequence,
      x: this.#player.position.x,
      z: this.#player.position.z
    });
    if (this.#history.length > MAX_HISTORY) {
      this.#history.shift();
    }
  }

  dispose(): void {
    this.#remotePlayers.dispose();
  }

  /** The same team ring every other device draws under this player. */
  #createTeamRing(scene: Scene, team: Team): void {
    const ring = MeshBuilder.CreateTorus(
      "local-team-ring",
      { diameter: 1.5, thickness: 0.09, tessellation: 24 },
      scene
    );
    ring.parent = this.#player;
    ring.position.y = -1.17;
    ring.isPickable = false;
    const material = new StandardMaterial("local-team-ring-material", scene);
    material.diffuseColor = Color3.Black();
    material.emissiveColor = Color3.FromHexString(
      team === "blue" ? "#57c7ff" : "#ff557c"
    );
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    ring.material = material;
  }

  #applySnapshot(message: Extract<ServerMessage, { type: "snapshot" }>): void {
    this.#snapshotsApplied += 1;

    const localId = this.#network.match?.playerId;
    if (localId !== undefined) {
      this.#remotePlayers.setLocalPlayerId(localId);
    }
    this.#remotePlayers.applySnapshot(
      message.players,
      message.serverTimeMs,
      performance.now()
    );

    if (localId === undefined) {
      return;
    }
    const local = message.players.find((player) => player.playerId === localId);
    if (local === undefined) {
      return;
    }

    this.#setAlive(local.isAlive);
    if (local.health !== this.#health) {
      this.#health = local.health;
      this.#elements.health.textContent = String(this.#health);
    }
    if (local.isAlive) {
      this.#reconcile(local.position, local.lastProcessedInput);
    }
  }

  /**
   * Compares the server's position with where prediction had the player when
   * the same input was sent. Only genuine disagreement is corrected, and
   * gently, so latency alone never makes the avatar rubber-band.
   */
  #reconcile(
    server: { readonly x: number; readonly y: number; readonly z: number },
    lastProcessedInput: number
  ): void {
    const predicted =
      lastProcessedInput > 0
        ? this.#history.find((entry) => entry.sequence === lastProcessedInput)
        : undefined;

    const referenceX = predicted?.x ?? this.#player.position.x;
    const referenceZ = predicted?.z ?? this.#player.position.z;
    const errorX = server.x - referenceX;
    const errorZ = server.z - referenceZ;
    const error = Math.hypot(errorX, errorZ);

    // Without an acknowledged input there is no like-for-like sample; only a
    // large gap (the initial spawn, a round reset) is worth acting on.
    const hardLimit = predicted === undefined ? 1.5 : HARD_SNAP_DISTANCE;
    let shiftX = 0;
    let shiftZ = 0;
    if (error > hardLimit) {
      shiftX = errorX;
      shiftZ = errorZ;
      this.#correctionCount += 1;
    } else if (predicted !== undefined && error > CORRECTION_DEADZONE) {
      shiftX = errorX * CORRECTION_BLEND;
      shiftZ = errorZ * CORRECTION_BLEND;
      this.#correctionCount += 1;
    }
    if (shiftX === 0 && shiftZ === 0) {
      return;
    }

    this.#player.position.x += shiftX;
    this.#player.position.z += shiftZ;
    this.#player.position.y = Math.max(this.#player.position.y, server.y + 1.2);
    for (const entry of this.#history) {
      entry.x += shiftX;
      entry.z += shiftZ;
    }
  }

  #setAlive(alive: boolean): void {
    if (alive === this.#isAlive && this.#elements.respawn.hidden === alive) {
      return;
    }
    this.#isAlive = alive;
    this.#setLocalVisible(alive);
    this.#elements.respawn.hidden = alive;
    this.#elements.respawn.textContent = alive ? "" : "Eliminated. Respawning…";
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
          ? this.#winningTeam === null
            ? "MATCH OVER · DRAW"
            : `MATCH OVER · ${this.#winningTeam.toUpperCase()} WINS`
          : "ONLINE MATCH";
    this.#renderTimer(performance.now());
  }

  #renderTimer(nowMs: number): void {
    const remainingMs =
      this.#phase === "waiting_for_players"
        ? 0
        : Math.max(0, this.#phaseEndsAtMs - nowMs);
    const totalSeconds = Math.ceil(remainingMs / 1000);
    if (totalSeconds === this.#shownSeconds) {
      return;
    }
    this.#shownSeconds = totalSeconds;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const text = `${String(minutes)}:${seconds.toString().padStart(2, "0")}`;
    this.#elements.timer.textContent = text;
    this.#elements.timer.dateTime = `PT${String(totalSeconds)}S`;
  }
}
