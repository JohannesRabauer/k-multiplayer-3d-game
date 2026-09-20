import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";

export class LocalPlayerController {
  readonly #camera: ArcRotateCamera;
  readonly #keys = new Set<string>();
  readonly #maximum: Vector3;
  readonly #mesh: AbstractMesh;
  readonly #minimum: Vector3;
  readonly #movementInput = Vector2.Zero();
  readonly #observer: Observer<Scene>;
  #vehicle: AbstractMesh | undefined;

  constructor(
    scene: Scene,
    mesh: AbstractMesh,
    camera: ArcRotateCamera,
    minimum: Vector3,
    maximum: Vector3
  ) {
    this.#camera = camera;
    this.#maximum = maximum;
    this.#mesh = mesh;
    this.#minimum = minimum;

    this.#mesh.checkCollisions = true;
    this.#mesh.ellipsoid = new Vector3(0.5, 1.1, 0.5);
    this.#mesh.ellipsoidOffset = Vector3.Zero();

    window.addEventListener("keydown", this.#onKeyDown);
    window.addEventListener("keyup", this.#onKeyUp);
    window.addEventListener("blur", this.#onBlur);

    this.#observer = scene.onBeforeRenderObservable.add(() => {
      this.#update(scene.getEngine().getDeltaTime() / 1_000);
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

  enterVehicle(vehicle: AbstractMesh): void {
    this.#vehicle = vehicle;
  }

  exitVehicle(): void {
    if (this.#vehicle === undefined) {
      return;
    }
    const right = new Vector3(
      Math.cos(this.#vehicle.rotation.y),
      0,
      -Math.sin(this.#vehicle.rotation.y)
    );
    this.#mesh.position.copyFrom(this.#vehicle.position.add(right.scale(2.2)));
    this.#mesh.position.y = 1.2;
    this.#vehicle = undefined;
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

    const controlledMesh = this.#vehicle ?? this.#mesh;
    if (movement.lengthSquared() > 0) {
      movement.normalize();
      if (this.#vehicle !== undefined) {
        controlledMesh.rotation.y = Math.atan2(movement.x, movement.z);
      }
    }

    const distance =
      DEFAULT_GAME_CONFIG.movement.speedMetersPerSecond *
      (this.#vehicle === undefined ? 1 : 1.75) *
      deltaSeconds;
    movement.scaleInPlace(distance);
    movement.y = -9.81 * deltaSeconds;
    controlledMesh.moveWithCollisions(movement);

    controlledMesh.position.x = Scalar.Clamp(
      controlledMesh.position.x,
      this.#minimum.x,
      this.#maximum.x
    );
    controlledMesh.position.z = Scalar.Clamp(
      controlledMesh.position.z,
      this.#minimum.z,
      this.#maximum.z
    );
    if (this.#vehicle !== undefined) {
      this.#mesh.position.x = controlledMesh.position.x;
      this.#mesh.position.z = controlledMesh.position.z;
    }
  }
}
