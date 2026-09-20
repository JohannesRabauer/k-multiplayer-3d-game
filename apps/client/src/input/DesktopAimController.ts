import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

import type { AimController } from "../game/AimController";

export class DesktopAimController {
  readonly #aimController: AimController;
  readonly #camera: ArcRotateCamera;
  readonly #canvas: HTMLCanvasElement;
  readonly #player: AbstractMesh;
  readonly #scene: Scene;
  #pointerX: number | null = null;
  #pointerY: number | null = null;

  constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    camera: ArcRotateCamera,
    player: AbstractMesh,
    aimController: AimController
  ) {
    this.#scene = scene;
    this.#canvas = canvas;
    this.#camera = camera;
    this.#player = player;
    this.#aimController = aimController;
    canvas.addEventListener("pointermove", this.#onPointerMove);
    canvas.addEventListener("pointerdown", this.#onPointerDown);
    window.addEventListener("pointerup", this.#onPointerUp);
    canvas.addEventListener("contextmenu", this.#preventContextMenu);
    scene.onBeforeRenderObservable.add(this.#refreshAim);
  }

  dispose(): void {
    this.#canvas.removeEventListener("pointermove", this.#onPointerMove);
    this.#canvas.removeEventListener("pointerdown", this.#onPointerDown);
    window.removeEventListener("pointerup", this.#onPointerUp);
    this.#canvas.removeEventListener("contextmenu", this.#preventContextMenu);
    this.#scene.onBeforeRenderObservable.removeCallback(this.#refreshAim);
  }

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      return;
    }
    const bounds = this.#canvas.getBoundingClientRect();
    this.#pointerX = event.clientX - bounds.left;
    this.#pointerY = event.clientY - bounds.top;
    this.#refreshAim();
  };

  /**
   * Recomputed every frame so the aim keeps revolving around the player even
   * while the player moves underneath a stationary cursor.
   */
  readonly #refreshAim = (): void => {
    const pointerX = this.#pointerX;
    const pointerY = this.#pointerY;
    if (pointerX === null || pointerY === null) {
      return;
    }
    // Babylon expects CSS pixels relative to the canvas; it applies the
    // hardware scaling level itself.
    const ray = this.#scene.createPickingRay(
      pointerX,
      pointerY,
      Matrix.Identity(),
      this.#camera
    );
    const distance = ray.intersectsPlane(
      Plane.FromPositionAndNormal(this.#player.position, Vector3.Up())
    );
    if (distance === null) {
      return;
    }
    const aim = ray.origin
      .add(ray.direction.scale(distance))
      .subtract(this.#player.position);
    aim.y = 0;
    if (aim.lengthSquared() < 1e-4) {
      return;
    }
    this.#aimController.setAimDirection(aim);
  };

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" && event.button === 0) {
      this.#aimController.setFireIntent(true);
      event.preventDefault();
    }
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" && event.button === 0) {
      this.#aimController.setFireIntent(false);
    }
  };

  readonly #preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
}
