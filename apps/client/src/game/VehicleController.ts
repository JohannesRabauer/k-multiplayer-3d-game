import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VEHICLE_ENTER_DISTANCE } from "@scooter-shooter/simulation";

import type { OwnCar } from "./CarLot";
import type { LocalPlayerController } from "./LocalPlayerController";

/**
 * Lets the player get into and out of their own car. While driving, the car
 * follows the player controller, which moves it with the shared collision
 * code; the walking avatar is hidden inside it.
 */
export class VehicleController {
  readonly #actionButton: HTMLButtonElement;
  readonly #car: OwnCar;
  readonly #playerController: LocalPlayerController;
  readonly #playerVisual: TransformNode;
  readonly #observer: Observer<Scene>;
  #isNearby = false;

  constructor(
    scene: Scene,
    car: OwnCar,
    playerController: LocalPlayerController,
    playerVisual: TransformNode,
    actionButton: HTMLButtonElement
  ) {
    this.#car = car;
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
    return this.#car.driving;
  }

  /** The heading to publish online while driving. */
  getYaw(): number {
    return this.#car.pose.yaw;
  }

  exitVehicle(): void {
    if (!this.#car.driving) {
      return;
    }
    const parked = this.#playerController.exitVehicle();
    if (parked !== undefined) {
      this.#car.set(parked);
    }
    this.#car.driving = false;
    this.#playerVisual.setEnabled(true);
  }

  /** The server refused or reset the drive, so the car is back in its bay. */
  resetToBay(): void {
    if (this.#car.driving) {
      this.#playerController.exitVehicle();
      this.#playerVisual.setEnabled(true);
    }
    this.#car.returnToBay();
  }

  readonly #update = (): void => {
    if (this.#car.driving) {
      const pose = this.#playerController.getVehiclePose();
      if (pose !== undefined) {
        this.#car.set(pose);
      }
      this.#actionButton.hidden = false;
      this.#actionButton.textContent = "Exit vehicle";
      return;
    }

    const player = this.#playerController.getPosition();
    this.#isNearby =
      Math.hypot(player.x - this.#car.pose.x, player.z - this.#car.pose.z) <=
      VEHICLE_ENTER_DISTANCE;
    this.#actionButton.hidden = !this.#isNearby;
    this.#actionButton.textContent = "Drive your car";
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "KeyE" && !event.repeat) {
      this.#toggleVehicle();
    }
  };

  readonly #toggleVehicle = (): void => {
    if (this.#car.driving) {
      this.exitVehicle();
      return;
    }
    if (!this.#isNearby) {
      return;
    }
    this.#playerController.enterVehicle(this.#car.pose);
    this.#car.driving = true;
    this.#playerVisual.setEnabled(false);
  };
}
