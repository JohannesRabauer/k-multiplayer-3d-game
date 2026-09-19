import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { ArcRotateCameraPointersInput } from "@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";

export function createThirdPersonCamera(
  scene: Scene,
  canvas: HTMLCanvasElement,
  target: AbstractMesh
): ArcRotateCamera {
  const config = DEFAULT_GAME_CONFIG.camera;
  const camera = new ArcRotateCamera(
    "third-person-camera",
    -Math.PI / 2,
    Math.PI / 3,
    config.initialRadiusMeters,
    target.position,
    scene
  );

  camera.checkCollisions = true;
  camera.collisionRadius = new Vector3(
    config.collisionRadiusMeters,
    config.collisionRadiusMeters,
    config.collisionRadiusMeters
  );
  camera.lowerBetaLimit = config.minimumPitchRadians;
  camera.upperBetaLimit = config.maximumPitchRadians;
  camera.lowerRadiusLimit = config.minimumRadiusMeters;
  camera.upperRadiusLimit = config.maximumRadiusMeters;
  camera.panningSensibility = 0;
  camera.lockedTarget = target;

  camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
  const pointerInput = camera.inputs.attached.pointers;
  if (pointerInput instanceof ArcRotateCameraPointersInput) {
    pointerInput.angularSensibilityX = config.angularSensibility;
    pointerInput.angularSensibilityY = config.angularSensibility;
  }

  camera.attachControl(canvas, true);
  return camera;
}
