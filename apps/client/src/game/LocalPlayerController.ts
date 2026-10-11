import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";
import {
  VEHICLE_SPEED_MULTIPLIER,
  getVehicleExit,
  resolveMovement,
  resolveVehicleMovement,
  type CircleObstacle
} from "@scooter-shooter/simulation";

const VEHICLE_TURN_RATE_RADIANS_PER_SECOND = 3.4;
/** Height of the capsule centre above the floor. */
const CAPSULE_CENTER_HEIGHT = 1.2;

export interface VehiclePose {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/**
 * Moves the local player (on foot or in their car) with the same collision
 * code the server runs. The walls, buildings and parked cars the player sees
 * are therefore exactly the ones that stop them: there is no second, slightly
 * different physics world to snag on, and online prediction agrees with the
 * authoritative simulation.
 */
export class LocalPlayerController {
  readonly #camera: ArcRotateCamera;
  readonly #getCircles: () => readonly CircleObstacle[];
  readonly #keys = new Set<string>();
  readonly #mesh: AbstractMesh;
  readonly #movementInput = Vector2.Zero();
  readonly #observer: Observer<Scene>;
  readonly #worldMoveDirection = Vector2.Zero();
  #vehicleYaw: number | undefined;

  constructor(
    scene: Scene,
    mesh: AbstractMesh,
    camera: ArcRotateCamera,
    getCircles: () => readonly CircleObstacle[] = () => []
  ) {
    this.#camera = camera;
    this.#mesh = mesh;
    this.#getCircles = getCircles;

    // Collisions are resolved by the shared simulation, not by Babylon.
    this.#mesh.checkCollisions = false;

    window.addEventListener("keydown", this.#onKeyDown);
    window.addEventListener("keyup", this.#onKeyUp);
    window.addEventListener("blur", this.#onBlur);

    this.#observer = scene.onBeforeRenderObservable.add(() => {
      this.#update(Math.min(scene.getEngine().getDeltaTime() / 1_000, 0.25));
    });
  }

  setMoveInput(x: number, y: number): void {
    const input = new Vector2(x, y);
    const magnitude = input.length();
    if (magnitude <= DEFAULT_GAME_CONFIG.movement.inputDeadZone) {
      this.#movementInput.setAll(0);
      return;
    }

    if (magnitude > DEFAULT_GAME_CONFIG.movement.maximumInputMagnitude) {
      input.normalize();
    }
    this.#movementInput.copyFrom(input);
  }

  /**
   * The world-space direction the player is currently moving, which is what an
   * online match sends upstream. The server has no camera, so camera-relative
   * input has to be resolved here first.
   */
  getWorldMoveDirection(): { readonly x: number; readonly z: number } {
    return { x: this.#worldMoveDirection.x, z: this.#worldMoveDirection.y };
  }

  isDriving(): boolean {
    return this.#vehicleYaw !== undefined;
  }

  /** Where the car being driven is, or undefined on foot. */
  getVehiclePose(): VehiclePose | undefined {
    return this.#vehicleYaw === undefined
      ? undefined
      : {
          x: this.#mesh.position.x,
          z: this.#mesh.position.z,
          yaw: this.#vehicleYaw
        };
  }

  /** Gets in: the player is carried at the car's position from now on. */
  enterVehicle(car: VehiclePose): void {
    this.#vehicleYaw = car.yaw;
    this.#mesh.position.set(car.x, CAPSULE_CENTER_HEIGHT, car.z);
  }

  /** Gets out beside the car and returns where the car is left standing. */
  exitVehicle(): VehiclePose | undefined {
    if (this.#vehicleYaw === undefined) {
      return undefined;
    }
    const car: VehiclePose = {
      x: this.#mesh.position.x,
      z: this.#mesh.position.z,
      yaw: this.#vehicleYaw
    };
    this.#vehicleYaw = undefined;
    const exit = getVehicleExit(car.x, car.z, car.yaw, this.#getCircles());
    this.#mesh.position.set(exit.x, CAPSULE_CENTER_HEIGHT, exit.z);
    return car;
  }

  getPosition(): Vector3 {
    return this.#mesh.position;
  }

  dispose(scene: Scene): void {
    window.removeEventListener("keydown", this.#onKeyDown);
    window.removeEventListener("keyup", this.#onKeyUp);
    window.removeEventListener("blur", this.#onBlur);
    scene.onBeforeRenderObservable.remove(this.#observer);
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    this.#keys.add(event.code);
  };

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    this.#keys.delete(event.code);
  };

  readonly #onBlur = (): void => {
    this.#keys.clear();
    this.#movementInput.setAll(0);
  };

  #update(deltaSeconds: number): void {
    const keyboardX =
      Number(this.#keys.has("KeyD") || this.#keys.has("ArrowRight")) -
      Number(this.#keys.has("KeyA") || this.#keys.has("ArrowLeft"));
    const keyboardY =
      Number(this.#keys.has("KeyW") || this.#keys.has("ArrowUp")) -
      Number(this.#keys.has("KeyS") || this.#keys.has("ArrowDown"));

    const input =
      keyboardX === 0 && keyboardY === 0
        ? this.#movementInput.clone()
        : new Vector2(keyboardX, keyboardY).normalize();

    const cameraForward = this.#camera
      .getForwardRay()
      .direction.multiplyByFloats(1, 0, 1);
    if (cameraForward.lengthSquared() === 0) {
      return;
    }
    cameraForward.normalize();

    const cameraRight = Vector3.Cross(Vector3.Up(), cameraForward).normalize();
    const movement = cameraForward
      .scale(input.y)
      .addInPlace(cameraRight.scale(input.x));

    const hasMovement = movement.lengthSquared() > 0;
    if (hasMovement) {
      movement.normalize();
      this.#worldMoveDirection.set(movement.x, movement.z);
      if (this.#vehicleYaw !== undefined) {
        const targetAngle = Math.atan2(movement.x, movement.z);
        const delta = Math.atan2(
          Math.sin(targetAngle - this.#vehicleYaw),
          Math.cos(targetAngle - this.#vehicleYaw)
        );
        const maximumTurn = VEHICLE_TURN_RATE_RADIANS_PER_SECOND * deltaSeconds;
        this.#vehicleYaw += Scalar.Clamp(delta, -maximumTurn, maximumTurn);
      }
    } else {
      this.#worldMoveDirection.setAll(0);
    }

    // The mesh position is the source of truth, so a respawn or a server
    // correction applied from outside is picked up here.
    const fromX = this.#mesh.position.x;
    const fromZ = this.#mesh.position.z;
    const distance =
      DEFAULT_GAME_CONFIG.movement.speedMetersPerSecond *
      (this.#vehicleYaw === undefined ? 1 : VEHICLE_SPEED_MULTIPLIER) *
      deltaSeconds;
    const toX = fromX + (hasMovement ? movement.x * distance : 0);
    const toZ = fromZ + (hasMovement ? movement.z * distance : 0);

    const resolved =
      this.#vehicleYaw === undefined
        ? resolveMovement(fromX, fromZ, toX, toZ, this.#getCircles())
        : resolveVehicleMovement(
            fromX,
            fromZ,
            toX,
            toZ,
            this.#vehicleYaw,
            this.#getCircles()
          );
    this.#mesh.position.set(resolved.x, CAPSULE_CENTER_HEIGHT, resolved.z);
  }
}
