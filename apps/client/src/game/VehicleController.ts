import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

import type { LocalPlayerController } from "./LocalPlayerController";

export interface DrivableVehicle {
  readonly id: string;
  readonly mesh: AbstractMesh;
}

export class VehicleController {
  readonly #actionButton: HTMLButtonElement;
  readonly #playerController: LocalPlayerController;
  readonly #playerVisual: TransformNode;
  readonly #observer: Observer<Scene>;
  readonly #vehicles: readonly DrivableVehicle[];
  #activeVehicle: DrivableVehicle | undefined;
  #nearbyVehicle: DrivableVehicle | undefined;

  constructor(
    scene: Scene,
    vehicles: readonly DrivableVehicle[],
    playerController: LocalPlayerController,
    playerVisual: TransformNode,
    actionButton: HTMLButtonElement
  ) {
    this.#vehicles = vehicles;
    this.#playerController = playerController;
    this.#playerVisual = playerVisual;
    this.#actionButton = actionButton;
    this.#actionButton.addEventListener("click", this.#toggleVehicle);
    window.addEventListener("keydown", this.#onKeyDown);
    this.#observer = scene.onBeforeRenderObservable.add(this.#update);
  }

  dispose(scene: Scene): void {
    this.#actionButton.removeEventListener("click", this.#toggleVehicle);
    window.removeEventListener("keydown", this.#onKeyDown);
    scene.onBeforeRenderObservable.remove(this.#observer);
  }

  isDriving(): boolean {
    return this.#activeVehicle !== undefined;
  }

  exitVehicle(): void {
    if (this.#activeVehicle === undefined) {
      return;
    }
    this.#playerController.exitVehicle();
    this.#playerVisual.setEnabled(true);
    this.#activeVehicle = undefined;
  }

  readonly #update = (): void => {
    if (this.#activeVehicle !== undefined) {
      this.#actionButton.hidden = false;
      this.#actionButton.textContent = "Exit vehicle";
      return;
    }

    const playerPosition = this.#playerController.getPosition();
    this.#nearbyVehicle = this.#vehicles.find(
      (vehicle) =>
        Vector3.DistanceSquared(vehicle.mesh.position, playerPosition) <= 16
    );
    this.#actionButton.hidden = this.#nearbyVehicle === undefined;
    this.#actionButton.textContent = "Drive vehicle";
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "KeyE" && !event.repeat) {
      this.#toggleVehicle();
    }
  };

  readonly #toggleVehicle = (): void => {
    if (this.#activeVehicle !== undefined) {
      this.exitVehicle();
      return;
    }
    if (this.#nearbyVehicle === undefined) {
      return;
    }
    this.#activeVehicle = this.#nearbyVehicle;
    this.#playerVisual.setEnabled(false);
    this.#playerController.enterVehicle(this.#activeVehicle.mesh);
  };
}
