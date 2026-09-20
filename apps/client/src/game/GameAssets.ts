import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Node } from "@babylonjs/core/node";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

const ASSET_ROOT = `${import.meta.env.BASE_URL}assets/kenney/`;

export async function addCharacterModel(
  scene: Scene,
  parent: AbstractMesh,
  model: "bot" | "player",
  instanceName: string
): Promise<TransformNode> {
  const root = await importModel(
    scene,
    `${ASSET_ROOT}characters/`,
    `${model}.glb`,
    instanceName
  );
  root.parent = parent;
  root.position.y = -0.95;
  root.scaling.setAll(0.25);
  return root;
}

export async function addVehicleModel(
  scene: Scene,
  parent: AbstractMesh,
  model: "hatchback-sports" | "sedan",
  instanceName: string
): Promise<TransformNode> {
  const root = await importModel(
    scene,
    `${ASSET_ROOT}vehicles/`,
    `${model}.glb`,
    instanceName
  );
  root.parent = parent;
  root.position.y = 0.35;
  root.scaling.setAll(1.15);
  return root;
}

export async function addVehiclePropModel(
  scene: Scene,
  model: "box" | "cone",
  position: Vector3,
  scaling: Vector3,
  instanceName: string
): Promise<TransformNode> {
  const root = await importModel(
    scene,
    `${ASSET_ROOT}vehicles/`,
    `${model}.glb`,
    instanceName
  );
  root.position.copyFrom(position);
  root.scaling.copyFrom(scaling);
  return root;
}

export async function addCityModel(
  scene: Scene,
  model: "building-a" | "building-d" | "building-f" | "parasol",
  position: Vector3,
  scaling: Vector3,
  instanceName: string
): Promise<TransformNode> {
  const root = await importModel(
    scene,
    `${ASSET_ROOT}city/`,
    `${model}.glb`,
    instanceName
  );
  root.position.copyFrom(position);
  root.scaling.copyFrom(scaling);
  return root;
}

async function importModel(
  scene: Scene,
  rootUrl: string,
  fileName: string,
  instanceName: string
): Promise<TransformNode> {
  await import("@babylonjs/loaders/glTF/2.0/glTFLoader");
  await import("@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit");
  const result = await ImportMeshAsync(`${rootUrl}${fileName}`, scene);
  const root = new TransformNode(instanceName, scene);
  const importedNodes: Node[] = [...result.meshes, ...result.transformNodes];
  const importedNodeSet = new Set(importedNodes);
  for (const node of importedNodes) {
    if (node.parent === null || !importedNodeSet.has(node.parent)) {
      node.parent = root;
    }
  }
  for (const mesh of result.meshes) {
    mesh.isPickable = false;
  }
  result.animationGroups
    .find((animation) => animation.name.toLowerCase() === "idle")
    ?.start(true);
  return root;
}
