import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";

export interface AimControllerOptions {
  readonly onFireIntentChanged: (isFiring: boolean) => void;
}

export class AimController {
  readonly #aimInput = Vector2.Zero();
  readonly #camera: ArcRotateCamera;
  readonly #options: AimControllerOptions;
  readonly #player: AbstractMesh;
  readonly #worldDirection = Vector3.Forward();
  #isFiring = false;

  constructor(
    camera: ArcRotateCamera,
    player: AbstractMesh,
    options: AimControllerOptions
  ) {
    this.#camera = camera;
    this.#player = player;
    this.#options = options;
    this.#worldDirection.copyFrom(this.#getCameraForward());
    this.#faceAimDirection();
  }

  setAimInput(x: number, y: number): void {
    this.#aimInput.set(x, y);
    const magnitude = this.#aimInput.length();
    const isFiring = magnitude >= DEFAULT_GAME_CONFIG.pistol.autoFireThreshold;

    if (magnitude > DEFAULT_GAME_CONFIG.movement.inputDeadZone) {
      const forward = this.#getCameraForward();
      const right = Vector3.Cross(Vector3.Up(), forward).normalize();
      this.#worldDirection
        .copyFrom(forward.scale(y).addInPlace(right.scale(x)))
        .normalize();
      this.#faceAimDirection();
    }

    if (isFiring !== this.#isFiring) {
      this.#isFiring = isFiring;
      this.#options.onFireIntentChanged(isFiring);
    }
  }

  setAimDirection(direction: Vector3): void {
    const horizontal = direction.multiplyByFloats(1, 0, 1);
    if (horizontal.lengthSquared() === 0) {
      return;
    }
    this.#worldDirection.copyFrom(horizontal.normalize());
    this.#faceAimDirection();
  }

  setFireIntent(isFiring: boolean): void {
    if (isFiring === this.#isFiring) {
      return;
    }
    this.#isFiring = isFiring;
    this.#options.onFireIntentChanged(isFiring);
  }

  getAimDirection(): Vector3 {
    return this.#worldDirection.clone();
  }

  dispose(): void {
    this.setFireIntent(false);
  }

  #faceAimDirection(): void {
    this.#player.rotation.y = Math.atan2(
      this.#worldDirection.x,
      this.#worldDirection.z
    );
  }

  #getCameraForward(): Vector3 {
    const forward = this.#camera
      .getForwardRay()
      .direction.multiplyByFloats(1, 0, 1);
    return forward.lengthSquared() === 0
      ? Vector3.Forward()
      : forward.normalize();
  }
}
