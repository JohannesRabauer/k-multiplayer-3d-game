import { Ray } from "@babylonjs/core/Culling/ray";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";
import {
  computeBotHitChance,
  getBotShotDamage
} from "@scooter-shooter/simulation";

import { ShotEffects } from "./ShotEffects";

export interface TrainingBot {
  readonly id: string;
  readonly mesh: AbstractMesh;
}

export interface TrainingBotControllerOptions {
  readonly canEngage: (nowMs: number) => boolean;
  readonly onAttack: (botId: string, nowMs: number, damage: number) => void;
}

interface BotAim {
  acquiredAtMs: number | undefined;
  nextAttackAtMs: number;
  shotsInBurst: number;
}

const BOT_CONFIG = DEFAULT_GAME_CONFIG.bots;
const BOT_SPEED_METERS_PER_SECOND = 3.2;
const CHEST_HEIGHT_OFFSET = 0.3;
const MOVING_TARGET_THRESHOLD = 0.8;
const PREFERRED_DISTANCE_METERS = 6;
const SHOTS_PER_BURST = 3;

export class TrainingBotController {
  readonly #aim = new Map<string, BotAim>();
  readonly #bots: readonly TrainingBot[];
  readonly #canEngage: (nowMs: number) => boolean;
  readonly #guns = new Map<string, Mesh>();
  readonly #maximum: Vector3;
  readonly #minimum: Vector3;
  readonly #onAttack: (botId: string, nowMs: number, damage: number) => void;
  readonly #player: AbstractMesh;
  readonly #previousPlayerPosition: Vector3;
  readonly #scene: Scene;
  readonly #shotEffects: ShotEffects;
  readonly #worldMeshes: ReadonlySet<AbstractMesh>;
  #shotsFired = 0;
  #shotsHit = 0;

  constructor(
    scene: Scene,
    bots: readonly TrainingBot[],
    player: AbstractMesh,
    minimum: Vector3,
    maximum: Vector3,
    worldMeshes: readonly AbstractMesh[],
    options: TrainingBotControllerOptions
  ) {
    this.#scene = scene;
    this.#bots = bots;
    this.#player = player;
    this.#previousPlayerPosition = player.position.clone();
    this.#minimum = minimum;
    this.#maximum = maximum;
    this.#worldMeshes = new Set(worldMeshes);
    this.#canEngage = options.canEngage;
    this.#onAttack = options.onAttack;
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
      this.#aim.set(bot.id, {
        acquiredAtMs: undefined,
        nextAttackAtMs: 0,
        shotsInBurst: 0
      });
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

  /** Observed hit rate across the session, used by smoke telemetry. */
  getAccuracyTelemetry(): { fired: number; hit: number } {
    return { fired: this.#shotsFired, hit: this.#shotsHit };
  }

  readonly #update = (): void => {
    const nowMs = performance.now();
    const isEngagementAllowed = this.#canEngage(nowMs);
    if (!isEngagementAllowed || !this.#player.isEnabled()) {
      // Freeze the squad between rounds so nobody stakes out a spawn point.
      for (const state of this.#aim.values()) {
        state.acquiredAtMs = undefined;
      }
      this.#previousPlayerPosition.copyFrom(this.#player.position);
      return;
    }

    const deltaSeconds = Math.min(
      this.#scene.getEngine().getDeltaTime() / 1_000,
      0.05
    );
    const playerSpeed =
      deltaSeconds > 0
        ? Vector3.Distance(
            this.#player.position,
            this.#previousPlayerPosition
          ) / deltaSeconds
        : 0;
    this.#previousPlayerPosition.copyFrom(this.#player.position);

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

      this.#updateEngagement(
        bot,
        index,
        distance,
        toPlayer,
        playerSpeed,
        nowMs
      );
    });
  };

  #updateEngagement(
    bot: TrainingBot,
    index: number,
    distance: number,
    toPlayer: Vector3,
    playerSpeed: number,
    nowMs: number
  ): void {
    const state = this.#aim.get(bot.id);
    if (state === undefined) {
      return;
    }

    const hasTarget =
      distance <= BOT_CONFIG.attackRangeMeters &&
      this.#hasLineOfSight(bot.mesh.position, toPlayer, distance);
    if (!hasTarget) {
      // Losing sight resets the aim, so bots must re-acquire before firing.
      state.acquiredAtMs = undefined;
      return;
    }

    state.acquiredAtMs ??= nowMs;
    if (nowMs - state.acquiredAtMs < BOT_CONFIG.reactionTimeMs) {
      return;
    }
    if (nowMs < state.nextAttackAtMs) {
      return;
    }

    state.shotsInBurst += 1;
    const isBurstOver = state.shotsInBurst >= SHOTS_PER_BURST;
    state.nextAttackAtMs =
      nowMs +
      (isBurstOver ? BOT_CONFIG.burstRecoveryMs : BOT_CONFIG.attackIntervalMs) +
      index * 45;
    if (isBurstOver) {
      state.shotsInBurst = 0;
    }

    const playerChest = this.#player.position.add(
      new Vector3(0, CHEST_HEIGHT_OFFSET, 0)
    );
    const hitChance = computeBotHitChance({
      distanceMeters: distance,
      isTargetMoving: playerSpeed > MOVING_TARGET_THRESHOLD
    });
    const isHit = Math.random() < hitChance;
    this.#shotsFired += 1;

    this.#shotEffects.spawn(
      this.#muzzlePosition(bot),
      isHit ? playerChest : this.#missPoint(bot.mesh.position, playerChest)
    );

    if (isHit) {
      this.#shotsHit += 1;
      this.#onAttack(bot.id, nowMs, getBotShotDamage());
    }
  }

  /** Deflects a missed shot so the player can see the near miss fly past. */
  #missPoint(origin: Vector3, target: Vector3): Vector3 {
    const delta = target.subtract(origin);
    const distance = delta.length();
    if (distance < 0.05) {
      return target;
    }
    const angle =
      ((Math.random() < 0.5 ? -1 : 1) *
        (BOT_CONFIG.missSpreadDegrees * (0.4 + Math.random() * 0.6)) *
        Math.PI) /
      180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return origin.add(
      new Vector3(
        delta.x * cos - delta.z * sin,
        delta.y,
        delta.x * sin + delta.z * cos
      )
    );
  }

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
