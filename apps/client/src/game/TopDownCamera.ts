import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

export function createTopDownCamera(
  scene: Scene,
  target: AbstractMesh
): ArcRotateCamera {
  const camera = new ArcRotateCamera(
    "top-down-camera",
    -Math.PI / 2,
    Math.PI / 4,
    18,
    target.position,
    scene
  );

  camera.inputs.clear();
  camera.lockedTarget = target;
  camera.lowerAlphaLimit = camera.alpha;
  camera.upperAlphaLimit = camera.alpha;
  camera.lowerBetaLimit = camera.beta;
  camera.upperBetaLimit = camera.beta;
  camera.lowerRadiusLimit = camera.radius;
  camera.upperRadiusLimit = camera.radius;
  camera.checkCollisions = false;
  camera.upVector = Vector3.Up();
  return camera;
}
