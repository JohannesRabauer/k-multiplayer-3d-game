import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";

export interface AimControllerOptions {
  readonly onFireIntentChanged: (isFiring: boolean) => void;
}

export class AimController {
  readonly #aimInput = Vector2.Zero();
  readonly #camera: ArcRotateCamera;
  readonly #observer: Observer<Scene>;
  readonly #options: AimControllerOptions;
  #isFiring = false;

  constructor(
    scene: Scene,
    camera: ArcRotateCamera,
    options: AimControllerOptions
  ) {
    this.#camera = camera;
    this.#options = options;
    this.#observer = scene.onBeforeRenderObservable.add(() => {
      this.#update(scene.getEngine().getDeltaTime() / 1_000);
    });
  }

  setAimInput(x: number, y: number): void {
    this.#aimInput.set(x, y);
    const isFiring =
      this.#aimInput.length() >= DEFAULT_GAME_CONFIG.pistol.autoFireThreshold;

    if (isFiring !== this.#isFiring) {
      this.#isFiring = isFiring;
      this.#options.onFireIntentChanged(isFiring);
    }
  }

  dispose(scene: Scene): void {
    this.setAimInput(0, 0);
    scene.onBeforeRenderObservable.remove(this.#observer);
  }

  #update(deltaSeconds: number): void {
    const cameraConfig = DEFAULT_GAME_CONFIG.camera;
    this.#camera.alpha -=
      this.#aimInput.x * cameraConfig.aimYawRadiansPerSecond * deltaSeconds;
    this.#camera.beta = Scalar.Clamp(
      this.#camera.beta -
        this.#aimInput.y * cameraConfig.aimPitchRadiansPerSecond * deltaSeconds,
      cameraConfig.minimumPitchRadians,
      cameraConfig.maximumPitchRadians
    );
  }
}
