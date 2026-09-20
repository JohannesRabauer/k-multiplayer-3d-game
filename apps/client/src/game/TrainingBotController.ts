import { Ray } from "@babylonjs/core/Culling/ray";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

import { ShotEffects } from "./ShotEffects";

export interface TrainingBot {
  readonly id: string;
  readonly mesh: AbstractMesh;
}

const ATTACK_RANGE_METERS = 13;
const ATTACK_INTERVAL_MS = 850;
const BOT_SPEED_METERS_PER_SECOND = 3.2;
const CHEST_HEIGHT_OFFSET = 0.3;
const PREFERRED_DISTANCE_METERS = 6;

export class TrainingBotController {
  readonly #bots: readonly TrainingBot[];
  readonly #guns = new Map<string, Mesh>();
  readonly #maximum: Vector3;
  readonly #minimum: Vector3;
  readonly #onAttack: (botId: string, nowMs: number) => void;
  readonly #player: AbstractMesh;
  readonly #scene: Scene;
  readonly #nextAttackAtMs = new Map<string, number>();
  readonly #shotEffects: ShotEffects;
  readonly #worldMeshes: ReadonlySet<AbstractMesh>;

  constructor(
    scene: Scene,
    bots: readonly TrainingBot[],
    player: AbstractMesh,
    minimum: Vector3,
    maximum: Vector3,
    worldMeshes: readonly AbstractMesh[],
    onAttack: (botId: string, nowMs: number) => void
  ) {
    this.#scene = scene;
    this.#bots = bots;
    this.#player = player;
    this.#minimum = minimum;
    this.#maximum = maximum;
    this.#worldMeshes = new Set(worldMeshes);
    this.#onAttack = onAttack;
    this.#shotEffects = new ShotEffects(scene, "#ff6a5a", "bot");

    const gunMaterial = new StandardMaterial("bot-gun-material", scene);
    gunMaterial.diffuseColor = Color3.FromHexString("#2b2f3d");
    gunMaterial.emissiveColor = Color3.FromHexString("#54121a");
    for (const bot of bots) {
      const gun = MeshBuilder.CreateBox(
        `${bot.id}-gun`,
        { width: 0.09, height: 0.1, depth: 0.34 },
        scene
      );
      gun.material = gunMaterial;
      gun.isPickable = false;
      gun.checkCollisions = false;
      gun.parent = bot.mesh;
      gun.position = new Vector3(0.3, CHEST_HEIGHT_OFFSET, 0.42);
      this.#guns.set(bot.id, gun);
    }

    scene.onBeforeRenderObservable.add(this.#update);
  }

  dispose(): void {
    this.#scene.onBeforeRenderObservable.removeCallback(this.#update);
    this.#shotEffects.dispose();
    for (const gun of this.#guns.values()) {
      gun.dispose();
    }
    this.#guns.clear();
  }

  /** Number of bot shot visuals currently on screen. */
  getActiveShotEffectCount(): number {
    return this.#shotEffects.getActiveCount();
  }

  readonly #update = (): void => {
    if (!this.#player.isEnabled()) {
      return;
    }

    const deltaSeconds = Math.min(
      this.#scene.getEngine().getDeltaTime() / 1_000,
      0.05
    );
    const nowMs = performance.now();

    this.#bots.forEach((bot, index) => {
      if (!bot.mesh.isEnabled()) {
        return;
      }

      const toPlayer = this.#player.position.subtract(bot.mesh.position);
      toPlayer.y = 0;
      const distance = toPlayer.length();
      if (distance > 0.01) {
        const forward = toPlayer.scale(1 / distance);
        const strafe = new Vector3(-forward.z, 0, forward.x).scale(
          index % 2 === 0 ? 1 : -1
        );
        const direction =
          distance > PREFERRED_DISTANCE_METERS
            ? forward.add(strafe.scale(0.28)).normalize()
            : strafe;
        bot.mesh.rotation.y = Math.atan2(direction.x, direction.z);
        const movement = direction.scale(
          BOT_SPEED_METERS_PER_SECOND * deltaSeconds
        );
        movement.y = -9.81 * deltaSeconds;
        bot.mesh.moveWithCollisions(movement);
        bot.mesh.position.x = Math.min(
          this.#maximum.x - 0.75,
          Math.max(this.#minimum.x + 0.75, bot.mesh.position.x)
        );
        bot.mesh.position.z = Math.min(
          this.#maximum.z - 0.75,
          Math.max(this.#minimum.z + 0.75, bot.mesh.position.z)
        );
      }

      const nextAttackAtMs = this.#nextAttackAtMs.get(bot.id) ?? 0;
      if (
        distance <= ATTACK_RANGE_METERS &&
        nowMs >= nextAttackAtMs &&
        this.#hasLineOfSight(bot.mesh.position, toPlayer, distance)
      ) {
        this.#nextAttackAtMs.set(
          bot.id,
          nowMs + ATTACK_INTERVAL_MS + index * 45
        );
        this.#shotEffects.spawn(
          this.#muzzlePosition(bot),
          this.#player.position.add(new Vector3(0, CHEST_HEIGHT_OFFSET, 0))
        );
        this.#onAttack(bot.id, nowMs);
      }
    });
  };

  #muzzlePosition(bot: TrainingBot): Vector3 {
    const gun = this.#guns.get(bot.id);
    if (gun === undefined) {
      return bot.mesh.position.add(new Vector3(0, CHEST_HEIGHT_OFFSET, 0));
    }
    gun.computeWorldMatrix(true);
    return gun.getAbsolutePosition().clone();
  }

  #hasLineOfSight(
    origin: Vector3,
    direction: Vector3,
    distance: number
  ): boolean {
    const obstruction = this.#scene.pickWithRay(
      new Ray(origin, direction.normalizeToNew(), distance),
      (mesh) => this.#worldMeshes.has(mesh)
    );
    return obstruction?.hit !== true;
  }
}
