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
  }

  dispose(): void {
    this.#canvas.removeEventListener("pointermove", this.#onPointerMove);
    this.#canvas.removeEventListener("pointerdown", this.#onPointerDown);
    window.removeEventListener("pointerup", this.#onPointerUp);
    this.#canvas.removeEventListener("contextmenu", this.#preventContextMenu);
  }

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      return;
    }
    const bounds = this.#canvas.getBoundingClientRect();
    const engine = this.#scene.getEngine();
    const x =
      ((event.clientX - bounds.left) / bounds.width) * engine.getRenderWidth();
    const y =
      ((event.clientY - bounds.top) / bounds.height) * engine.getRenderHeight();
    const ray = this.#scene.createPickingRay(
      x,
      y,
      Matrix.Identity(),
      this.#camera
    );
    const distance = ray.intersectsPlane(
      Plane.FromPositionAndNormal(this.#player.position, Vector3.Up())
    );
    if (distance === null) {
      return;
    }
    this.#aimController.setAimDirection(
      ray.origin
        .add(ray.direction.scale(distance))
        .subtract(this.#player.position)
    );
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
