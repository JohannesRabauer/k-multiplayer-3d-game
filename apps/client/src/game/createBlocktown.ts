import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

export interface BlocktownMap {
  readonly blueSpawnPositions: readonly [Vector3, Vector3];
  readonly collisionMeshes: readonly AbstractMesh[];
  readonly playAreaMaximum: Vector3;
  readonly playAreaMinimum: Vector3;
  readonly redSpawnPositions: readonly [Vector3, Vector3];
  readonly root: TransformNode;
}

interface BoxDefinition {
  readonly color: keyof ReturnType<typeof createMaterials>;
  readonly height: number;
  readonly name: string;
  readonly position: Vector3;
  readonly width: number;
  readonly depth: number;
}

function createMaterials(scene: Scene) {
  const createMaterial = (name: string, color: string): StandardMaterial => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor = Color3.Black();
    material.freeze();
    return material;
  };

  return {
    asphalt: createMaterial("blocktown-asphalt", "#394867"),
    blue: createMaterial("blocktown-blue", "#57c7ff"),
    brick: createMaterial("blocktown-brick", "#d97757"),
    concrete: createMaterial("blocktown-concrete", "#d9d7cc"),
    grass: createMaterial("blocktown-grass", "#52b788"),
    red: createMaterial("blocktown-red", "#ff557c"),
    roof: createMaterial("blocktown-roof", "#754668"),
    sidewalk: createMaterial("blocktown-sidewalk", "#9aa5b1")
  };
}

export function createBlocktown(scene: Scene): BlocktownMap {
  const root = new TransformNode("blocktown", scene);
  const materials = createMaterials(scene);
  const collisionMeshes: AbstractMesh[] = [];

  const createBox = (definition: BoxDefinition): AbstractMesh => {
    const mesh = MeshBuilder.CreateBox(
      definition.name,
      {
        depth: definition.depth,
        height: definition.height,
        width: definition.width
      },
      scene
    );
    mesh.position.copyFrom(definition.position);
    mesh.material = materials[definition.color];
    mesh.parent = root;
    mesh.checkCollisions = true;
    mesh.freezeWorldMatrix();
    collisionMeshes.push(mesh);
    return mesh;
  };

  createBox({
    color: "grass",
    depth: 36,
    height: 0.4,
    name: "ground",
    position: new Vector3(0, -0.2, 0),
    width: 48
  });

  createBox({
    color: "asphalt",
    depth: 10,
    height: 0.06,
    name: "main-road",
    position: new Vector3(0, 0.03, 0),
    width: 48
  });
  createBox({
    color: "asphalt",
    depth: 36,
    height: 0.06,
    name: "cross-road",
    position: new Vector3(0, 0.04, 0),
    width: 10
  });
  createBox({
    color: "sidewalk",
    depth: 14,
    height: 0.12,
    name: "central-plaza",
    position: new Vector3(0, 0.08, 0),
    width: 14
  });

  const buildings: readonly BoxDefinition[] = [
    {
      color: "brick",
      depth: 8,
      height: 6,
      name: "building-north-west",
      position: new Vector3(-14, 3, 11),
      width: 10
    },
    {
      color: "concrete",
      depth: 8,
      height: 8,
      name: "building-north-east",
      position: new Vector3(14, 4, 11),
      width: 10
    },
    {
      color: "concrete",
      depth: 8,
      height: 7,
      name: "building-south-west",
      position: new Vector3(-14, 3.5, -11),
      width: 10
    },
    {
      color: "brick",
      depth: 8,
      height: 5,
      name: "building-south-east",
      position: new Vector3(14, 2.5, -11),
      width: 10
    }
  ];
  buildings.forEach(createBox);

  const cover: readonly BoxDefinition[] = [
    {
      color: "concrete",
      depth: 1,
      height: 1.25,
      name: "cover-west-north",
      position: new Vector3(-8, 0.625, 3),
      width: 4
    },
    {
      color: "concrete",
      depth: 1,
      height: 1.25,
      name: "cover-west-south",
      position: new Vector3(-8, 0.625, -3),
      width: 4
    },
    {
      color: "concrete",
      depth: 1,
      height: 1.25,
      name: "cover-east-north",
      position: new Vector3(8, 0.625, 3),
      width: 4
    },
    {
      color: "concrete",
      depth: 1,
      height: 1.25,
      name: "cover-east-south",
      position: new Vector3(8, 0.625, -3),
      width: 4
    },
    {
      color: "sidewalk",
      depth: 3,
      height: 1,
      name: "plaza-cover-north",
      position: new Vector3(0, 0.5, 4.5),
      width: 1.2
    },
    {
      color: "sidewalk",
      depth: 3,
      height: 1,
      name: "plaza-cover-south",
      position: new Vector3(0, 0.5, -4.5),
      width: 1.2
    }
  ];
  cover.forEach(createBox);

  const boundaryDefinitions: readonly BoxDefinition[] = [
    {
      color: "roof",
      depth: 0.5,
      height: 2,
      name: "boundary-north",
      position: new Vector3(0, 1, 17.75),
      width: 48
    },
    {
      color: "roof",
      depth: 0.5,
      height: 2,
      name: "boundary-south",
      position: new Vector3(0, 1, -17.75),
      width: 48
    },
    {
      color: "roof",
      depth: 36,
      height: 2,
      name: "boundary-east",
      position: new Vector3(23.75, 1, 0),
      width: 0.5
    },
    {
      color: "roof",
      depth: 36,
      height: 2,
      name: "boundary-west",
      position: new Vector3(-23.75, 1, 0),
      width: 0.5
    }
  ];
  boundaryDefinitions.forEach(createBox);

  const blueSpawnPositions = [
    new Vector3(-19, 0.1, -3),
    new Vector3(-19, 0.1, 3)
  ] as const;
  const redSpawnPositions = [
    new Vector3(19, 0.1, -3),
    new Vector3(19, 0.1, 3)
  ] as const;

  for (const [team, positions] of [
    ["blue", blueSpawnPositions],
    ["red", redSpawnPositions]
  ] as const) {
    positions.forEach((position, index) => {
      const marker = MeshBuilder.CreateCylinder(
        `${team}-spawn-${String(index + 1)}`,
        { diameter: 2.25, height: 0.08, tessellation: 24 },
        scene
      );
      marker.position.copyFrom(position);
      marker.material = materials[team];
      marker.parent = root;
      marker.freezeWorldMatrix();
    });
  }

  return {
    blueSpawnPositions,
    collisionMeshes,
    playAreaMaximum: new Vector3(23.5, 10, 17.5),
    playAreaMinimum: new Vector3(-23.5, 0, -17.5),
    redSpawnPositions,
    root
  };
}
