import { Ray } from "@babylonjs/core/Culling/ray";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";

export type HitscanResult =
  | {
      readonly kind: "miss";
    }
  | {
      readonly distance: number;
      readonly kind: "target";
      readonly point: Vector3;
      readonly targetId: string;
    }
  | {
      readonly distance: number;
      readonly kind: "world";
      readonly point: Vector3;
    };

export class LocalHitscanResolver {
  readonly #eligibleMeshes: ReadonlySet<AbstractMesh>;
  readonly #scene: Scene;
  readonly #targetsByMesh: ReadonlyMap<AbstractMesh, string>;

  constructor(
    scene: Scene,
    worldMeshes: readonly AbstractMesh[],
    targetsByMesh: ReadonlyMap<AbstractMesh, string>
  ) {
    this.#scene = scene;
    this.#targetsByMesh = targetsByMesh;
    this.#eligibleMeshes = new Set([...worldMeshes, ...targetsByMesh.keys()]);
  }

  resolve(origin: Vector3, direction: Vector3): HitscanResult {
    const ray = new Ray(
      origin,
      direction.normalizeToNew(),
      DEFAULT_GAME_CONFIG.pistol.rangeMeters
    );
    const hit = this.#scene.pickWithRay(ray, (mesh) =>
      this.#eligibleMeshes.has(mesh)
    );

    if (!hit?.hit || hit.pickedMesh === null || hit.pickedPoint === null) {
      return { kind: "miss" };
    }

    const targetId = this.#targetsByMesh.get(hit.pickedMesh);
    if (targetId !== undefined) {
      return {
        distance: hit.distance,
        kind: "target",
        point: hit.pickedPoint,
        targetId
      };
    }

    return {
      distance: hit.distance,
      kind: "world",
      point: hit.pickedPoint
    };
  }
}
