import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

const BEAM_DURATION_MS = 130;
const FLASH_DURATION_MS = 90;
const IMPACT_DURATION_MS = 160;
const POOL_SIZE = 10;

interface PooledEffect {
  readonly beam: Mesh;
  readonly flash: Mesh;
  readonly impact: Mesh;
  expiresAtMs: number;
}

/**
 * Renders short-lived tracer beams, muzzle flashes, and impact sparks so every
 * shot is readable from the fixed top-down camera.
 */
export class ShotEffects {
  readonly #observer: Observer<Scene>;
  readonly #pool: PooledEffect[] = [];
  readonly #scene: Scene;
  #nextIndex = 0;
  #spawnedCount = 0;

  constructor(scene: Scene, colorHex: string, name: string) {
    this.#scene = scene;

    const material = new StandardMaterial(`${name}-shot-material`, scene);
    const color = Color3.FromHexString(colorHex);
    material.emissiveColor = color;
    material.diffuseColor = color;
    material.disableLighting = true;
    material.alpha = 0.9;

    for (let index = 0; index < POOL_SIZE; index += 1) {
      const beam = MeshBuilder.CreateCylinder(
        `${name}-shot-beam-${String(index)}`,
        { diameter: 0.07, height: 1, tessellation: 6 },
        scene
      );
      const flash = MeshBuilder.CreateSphere(
        `${name}-shot-flash-${String(index)}`,
        { diameter: 0.3, segments: 6 },
        scene
      );
      const impact = MeshBuilder.CreateSphere(
        `${name}-shot-impact-${String(index)}`,
        { diameter: 0.38, segments: 6 },
        scene
      );

      for (const mesh of [beam, flash, impact]) {
        mesh.material = material;
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.doNotSyncBoundingInfo = true;
        mesh.setEnabled(false);
      }
      beam.rotationQuaternion = Quaternion.Identity();
      this.#pool.push({ beam, expiresAtMs: 0, flash, impact });
    }

    this.#observer = scene.onBeforeRenderObservable.add(() => {
      this.#update(performance.now());
    });
  }

  /** Draws a tracer from `origin` to `target` plus muzzle and impact markers. */
  spawn(origin: Vector3, target: Vector3): void {
    const effect = this.#pool[this.#nextIndex];
    if (effect === undefined) {
      return;
    }
    this.#nextIndex = (this.#nextIndex + 1) % this.#pool.length;

    const delta = target.subtract(origin);
    const distance = delta.length();
    if (distance < 0.05) {
      return;
    }
    const direction = delta.scale(1 / distance);

    effect.beam.position.copyFrom(origin.add(delta.scale(0.5)));
    effect.beam.scaling.set(1, distance, 1);
    alignToDirection(effect.beam, direction);
    effect.flash.position.copyFrom(origin);
    effect.impact.position.copyFrom(target);

    effect.expiresAtMs = performance.now() + IMPACT_DURATION_MS;
    effect.beam.setEnabled(true);
    effect.flash.setEnabled(true);
    effect.impact.setEnabled(true);
    this.#spawnedCount += 1;
  }

  /** Number of effects currently rendered; used by smoke telemetry. */
  getActiveCount(): number {
    return this.#pool.filter((effect) => effect.expiresAtMs !== 0).length;
  }

  /**
   * Total effects spawned since creation. Smoke tests poll this instead of the
   * active count, which is only non-zero for a few frames per shot.
   */
  getSpawnedCount(): number {
    return this.#spawnedCount;
  }

  dispose(): void {
    this.#scene.onBeforeRenderObservable.remove(this.#observer);
    for (const effect of this.#pool) {
      effect.beam.dispose();
      effect.flash.dispose();
      effect.impact.dispose();
    }
  }

  #update(nowMs: number): void {
    for (const effect of this.#pool) {
      if (effect.expiresAtMs === 0) {
        continue;
      }
      const elapsedMs = nowMs - (effect.expiresAtMs - IMPACT_DURATION_MS);
      if (elapsedMs >= BEAM_DURATION_MS) {
        effect.beam.setEnabled(false);
      }
      if (elapsedMs >= FLASH_DURATION_MS) {
        effect.flash.setEnabled(false);
      }
      if (nowMs >= effect.expiresAtMs) {
        effect.impact.setEnabled(false);
        effect.expiresAtMs = 0;
      }
    }
  }
}

function alignToDirection(mesh: Mesh, direction: Vector3): void {
  const axis = Vector3.Cross(Vector3.UpReadOnly, direction);
  const dot = Math.min(
    1,
    Math.max(-1, Vector3.Dot(Vector3.UpReadOnly, direction))
  );
  const quaternion = mesh.rotationQuaternion ?? Quaternion.Identity();
  if (axis.lengthSquared() < 1e-6) {
    Quaternion.RotationAxisToRef(
      Vector3.Right(),
      dot >= 0 ? 0 : Math.PI,
      quaternion
    );
  } else {
    Quaternion.RotationAxisToRef(axis.normalize(), Math.acos(dot), quaternion);
  }
  mesh.rotationQuaternion = quaternion;
}
