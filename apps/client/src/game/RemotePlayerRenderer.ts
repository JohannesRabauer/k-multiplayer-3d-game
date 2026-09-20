import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { PlayerSnapshot, Team } from "@scooter-shooter/protocol";

import { addCharacterModel } from "./GameAssets";

interface SnapshotSample {
  readonly receivedAtMs: number;
  readonly position: Vector3;
  readonly yaw: number;
}

interface RemotePlayer {
  readonly playerId: string;
  readonly mesh: Mesh;
  readonly team: Team;
  samples: SnapshotSample[];
  isAlive: boolean;
}

/**
 * Snapshots arrive at the server tick rate, which is far below the render
 * rate. Remote avatars are therefore drawn slightly in the past and
 * interpolated between the two samples that straddle that render time, which
 * trades a little latency for motion that does not stutter.
 */
const INTERPOLATION_DELAY_MS = 120;
const MAX_SAMPLES = 24;

export class RemotePlayerRenderer {
  readonly #scene: Scene;
  readonly #players = new Map<string, RemotePlayer>();
  readonly #blueMaterial: StandardMaterial;
  readonly #redMaterial: StandardMaterial;
  #localPlayerId: string | undefined;

  constructor(scene: Scene) {
    this.#scene = scene;

    this.#blueMaterial = new StandardMaterial("remote-blue", scene);
    this.#blueMaterial.diffuseColor = Color3.FromHexString("#57c7ff");
    this.#blueMaterial.alpha = 0;

    this.#redMaterial = new StandardMaterial("remote-red", scene);
    this.#redMaterial.diffuseColor = Color3.FromHexString("#ff557c");
    this.#redMaterial.alpha = 0;
  }

  setLocalPlayerId(playerId: string): void {
    this.#localPlayerId = playerId;
  }

  get count(): number {
    return this.#players.size;
  }

  /** Feeds one authoritative snapshot in, spawning avatars as players appear. */
  applySnapshot(players: readonly PlayerSnapshot[], nowMs: number): void {
    const seen = new Set<string>();

    for (const snapshot of players) {
      if (snapshot.playerId === this.#localPlayerId) {
        continue;
      }
      seen.add(snapshot.playerId);

      let remote = this.#players.get(snapshot.playerId);
      if (remote === undefined) {
        remote = this.#spawn(snapshot);
        this.#players.set(snapshot.playerId, remote);
      }

      remote.isAlive = snapshot.isAlive;
      remote.mesh.setEnabled(snapshot.isAlive);
      remote.samples.push({
        receivedAtMs: nowMs,
        position: new Vector3(
          snapshot.position.x,
          snapshot.position.y + 1.2,
          snapshot.position.z
        ),
        yaw: snapshot.yaw
      });
      if (remote.samples.length > MAX_SAMPLES) {
        remote.samples.shift();
      }
    }

    for (const [playerId, remote] of this.#players) {
      if (!seen.has(playerId)) {
        remote.mesh.dispose(false, true);
        this.#players.delete(playerId);
      }
    }
  }

  remove(playerId: string): void {
    const remote = this.#players.get(playerId);
    if (remote === undefined) {
      return;
    }
    remote.mesh.dispose(false, true);
    this.#players.delete(playerId);
  }

  /** Advances every avatar to its interpolated pose for this frame. */
  update(nowMs: number): void {
    const renderTimeMs = nowMs - INTERPOLATION_DELAY_MS;

    for (const remote of this.#players.values()) {
      const samples = remote.samples;
      if (samples.length === 0) {
        continue;
      }

      const newest = samples[samples.length - 1];
      if (newest === undefined) {
        continue;
      }

      if (samples.length === 1 || renderTimeMs >= newest.receivedAtMs) {
        remote.mesh.position.copyFrom(newest.position);
        remote.mesh.rotation.y = newest.yaw;
        continue;
      }

      const oldest = samples[0];
      if (oldest === undefined) {
        continue;
      }

      let older = oldest;
      let newer = newest;
      for (let index = 1; index < samples.length; index += 1) {
        const candidate = samples[index];
        const previous = samples[index - 1];
        if (candidate === undefined || previous === undefined) {
          continue;
        }
        if (candidate.receivedAtMs >= renderTimeMs) {
          newer = candidate;
          older = previous;
          break;
        }
      }

      const span = newer.receivedAtMs - older.receivedAtMs;
      const ratio =
        span <= 0 ? 1 : clamp((renderTimeMs - older.receivedAtMs) / span, 0, 1);

      Vector3.LerpToRef(
        older.position,
        newer.position,
        ratio,
        remote.mesh.position
      );
      remote.mesh.rotation.y = lerpAngle(older.yaw, newer.yaw, ratio);

      // Drop samples that are now fully in the past.
      while (samples.length > 2 && samples[1] !== undefined) {
        const second = samples[1];
        if (second.receivedAtMs >= renderTimeMs) {
          break;
        }
        samples.shift();
      }
    }
  }

  /** Returns an avatar's current rendered position, if it is on screen. */
  getPosition(playerId: string): Vector3 | undefined {
    return this.#players.get(playerId)?.mesh.position;
  }

  dispose(): void {
    for (const remote of this.#players.values()) {
      remote.mesh.dispose(false, true);
    }
    this.#players.clear();
  }

  #spawn(snapshot: PlayerSnapshot): RemotePlayer {
    const mesh = MeshBuilder.CreateCapsule(
      `remote-${snapshot.playerId}`,
      { height: 2.4, radius: 0.55 },
      this.#scene
    );
    mesh.position.set(
      snapshot.position.x,
      snapshot.position.y + 1.2,
      snapshot.position.z
    );
    mesh.material =
      snapshot.team === "blue" ? this.#blueMaterial : this.#redMaterial;
    mesh.checkCollisions = false;

    void addCharacterModel(
      this.#scene,
      mesh,
      snapshot.team === "blue" ? "player" : "bot",
      `remote-${snapshot.playerId}-model`
    );

    return {
      playerId: snapshot.playerId,
      mesh,
      team: snapshot.team,
      samples: [],
      isAlive: snapshot.isAlive
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Interpolates yaw the short way around the circle. */
function lerpAngle(from: number, to: number, ratio: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) {
    delta -= Math.PI * 2;
  } else if (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return from + delta * ratio;
}
