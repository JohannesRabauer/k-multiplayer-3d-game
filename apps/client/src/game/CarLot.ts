import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { CarDesign } from "@scooter-shooter/protocol";
import {
  carCircles,
  getParkingSlot,
  type CircleObstacle
} from "@scooter-shooter/simulation";

import { buildCar } from "./CarBuilder";

/** Cars rest on the road surface, which sits a hair above the ground. */
export const CAR_GROUND_OFFSET = 0.06;

export interface CarPose {
  x: number;
  z: number;
  yaw: number;
}

/** The player's own car: parked in its bay, or being driven away from it. */
export class OwnCar {
  readonly pose: CarPose;
  readonly slot: number;
  node: TransformNode;
  design: CarDesign;
  driving = false;
  readonly #scene: Scene;

  constructor(scene: Scene, design: CarDesign, slot: number) {
    this.#scene = scene;
    this.design = design;
    this.slot = slot;
    const bay = getParkingSlot(slot);
    this.pose = { x: bay.x, z: bay.z, yaw: bay.yaw };
    this.node = buildCar(scene, design, "own-car");
    this.apply();
  }

  /** Puts the car on its pose; call after changing it. */
  apply(): void {
    this.node.position.set(this.pose.x, CAR_GROUND_OFFSET, this.pose.z);
    this.node.rotation.y = this.pose.yaw;
  }

  set(pose: CarPose): void {
    this.pose.x = pose.x;
    this.pose.z = pose.z;
    this.pose.yaw = pose.yaw;
    this.apply();
  }

  /** Sends the car back to its own bay, as the server does on a respawn. */
  returnToBay(): void {
    const bay = getParkingSlot(this.slot);
    this.driving = false;
    this.set({ x: bay.x, z: bay.z, yaw: bay.yaw });
  }

  setDesign(design: CarDesign): void {
    this.design = design;
    this.node.dispose(false, false);
    this.node = buildCar(this.#scene, design, "own-car");
    this.apply();
  }
}

/**
 * Everything parked on the road: the player's own car, filler cars that keep
 * the lot looking lived in, and (online) whatever other players left standing.
 * It is the single place that knows which circles currently block movement.
 */
export class CarLot {
  readonly #scene: Scene;
  readonly #decor: { node: TransformNode; circles: CircleObstacle[] }[] = [];
  #own: OwnCar | undefined;
  #getRemoteCircles: () => readonly CircleObstacle[] = () => [];

  constructor(scene: Scene) {
    this.#scene = scene;
  }

  get own(): OwnCar | undefined {
    return this.#own;
  }

  get decorCount(): number {
    return this.#decor.length;
  }

  placeOwn(design: CarDesign, slot: number): OwnCar {
    this.#own?.node.dispose(false, false);
    this.#own = new OwnCar(this.#scene, design, slot);
    return this.#own;
  }

  /** A scenery car in the given bay. Solid, but nobody drives it. */
  placeDecor(design: CarDesign, slot: number): void {
    const bay = getParkingSlot(slot);
    const node = buildCar(this.#scene, design, `parked-car-${String(slot)}`);
    node.position.set(bay.x, CAR_GROUND_OFFSET, bay.z);
    node.rotation.y = bay.yaw;
    node.freezeWorldMatrix();
    this.#decor.push({ node, circles: [...carCircles(bay.x, bay.z, bay.yaw)] });
  }

  /** Online, other players' standing cars come from the renderer. */
  setRemoteCircles(provider: () => readonly CircleObstacle[]): void {
    this.#getRemoteCircles = provider;
  }

  /** Circles that block a walker or a driver right now. */
  getCircles(): readonly CircleObstacle[] {
    const circles: CircleObstacle[] = [];
    for (const decor of this.#decor) {
      circles.push(...decor.circles);
    }
    circles.push(...this.#getRemoteCircles());
    const own = this.#own;
    if (own !== undefined && !own.driving) {
      circles.push(...carCircles(own.pose.x, own.pose.z, own.pose.yaw));
    }
    return circles;
  }
}
