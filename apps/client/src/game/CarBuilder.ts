import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { CarDesign } from "@scooter-shooter/protocol";

/**
 * Turns a {@link CarDesign} into meshes. Every client runs this same function
 * on the same data, which is what makes a car look identical in the garage,
 * on the road and on every other player's screen.
 *
 * The car faces +Z with its wheels on y = 0. Parts are merged per material so
 * a car costs a handful of draw calls however many options it uses.
 */

interface BodyShape {
  readonly length: number;
  readonly width: number;
  readonly bodyHeight: number;
  readonly bodyY: number;
  readonly cabinWidth: number;
  readonly cabinHeight: number;
  readonly cabinLength: number;
  readonly cabinZ: number;
}

const SHAPES: Readonly<Record<CarDesign["bodyStyle"], BodyShape>> = {
  sedan: {
    length: 3.4,
    width: 1.8,
    bodyHeight: 0.5,
    bodyY: 0.55,
    cabinWidth: 1.6,
    cabinHeight: 0.5,
    cabinLength: 1.7,
    cabinZ: -0.15
  },
  hatchback: {
    length: 3.1,
    width: 1.8,
    bodyHeight: 0.5,
    bodyY: 0.55,
    cabinWidth: 1.6,
    cabinHeight: 0.55,
    cabinLength: 2,
    cabinZ: -0.3
  },
  sports: {
    length: 3.5,
    width: 1.9,
    bodyHeight: 0.4,
    bodyY: 0.5,
    cabinWidth: 1.5,
    cabinHeight: 0.38,
    cabinLength: 1.3,
    cabinZ: -0.2
  },
  pickup: {
    length: 3.6,
    width: 1.9,
    bodyHeight: 0.55,
    bodyY: 0.62,
    cabinWidth: 1.7,
    cabinHeight: 0.55,
    cabinLength: 1.2,
    cabinZ: 0.55
  }
};

const WHEEL_RADIUS = 0.35;
const WHEEL_WIDTH = 0.26;

const LIGHT_COLORS: Readonly<Record<CarDesign["lights"], string>> = {
  classic: "#fff1b3",
  xenon: "#d4ebff",
  neon: "#00f5ff"
};

const materialCache = new WeakMap<Scene, Map<string, StandardMaterial>>();

function getMaterial(
  scene: Scene,
  key: string,
  diffuse: string,
  options: { emissive?: boolean; specular?: number; alpha?: number } = {}
): StandardMaterial {
  let cache = materialCache.get(scene);
  if (cache === undefined) {
    cache = new Map();
    materialCache.set(scene, cache);
  }
  const cacheKey = `${key}:${diffuse}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const material = new StandardMaterial(`car-${cacheKey}`, scene);
  const color = Color3.FromHexString(diffuse);
  if (options.emissive === true) {
    material.diffuseColor = Color3.Black();
    material.emissiveColor = color;
    material.disableLighting = true;
  } else {
    material.diffuseColor = color;
    // A little self-light keeps the painted colour true in shade.
    material.emissiveColor = color.scale(0.3);
  }
  const specular = options.specular ?? 0.08;
  material.specularColor = new Color3(specular, specular, specular);
  if (options.alpha !== undefined) {
    material.alpha = options.alpha;
  }
  cache.set(cacheKey, material);
  return material;
}

/** Builds the car under a fresh, unparented node and returns it. */
export function buildCar(
  scene: Scene,
  design: CarDesign,
  name: string
): TransformNode {
  const root = new TransformNode(name, scene);
  const shape = SHAPES[design.bodyStyle];
  const parts: { mesh: Mesh; material: Material }[] = [];

  const paint = getMaterial(scene, "paint", design.paintColor, {
    specular: 0.35
  });
  const dark = getMaterial(scene, "dark", "#1b1d22");
  const glass = getMaterial(scene, "glass", "#1d2b3a", { specular: 0.5 });
  const rim = getMaterial(scene, "rim", design.rimColor, { specular: 0.6 });
  const spoilerPaint = getMaterial(scene, "spoiler", design.spoilerColor);
  const stripePaint = getMaterial(scene, "stripe", design.stripeColor);

  const box = (
    material: Material,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    rotationX = 0
  ): Mesh => {
    const mesh = MeshBuilder.CreateBox(
      `${name}-part`,
      { width, height, depth },
      scene
    );
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotationX;
    parts.push({ mesh, material });
    return mesh;
  };

  const disc = (
    material: Material,
    diameter: number,
    thickness: number,
    x: number,
    y: number,
    z: number
  ): Mesh => {
    const mesh = MeshBuilder.CreateCylinder(
      `${name}-part`,
      { diameter, height: thickness, tessellation: 16 },
      scene
    );
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(x, y, z);
    parts.push({ mesh, material });
    return mesh;
  };

  const halfWidth = shape.width / 2;
  const halfLength = shape.length / 2;
  const bodyTop = shape.bodyY + shape.bodyHeight / 2;
  const cabinCenterY = bodyTop + shape.cabinHeight / 2;
  const cabinTop = bodyTop + shape.cabinHeight;
  const cabinFront = shape.cabinZ + shape.cabinLength / 2;
  const cabinRear = shape.cabinZ - shape.cabinLength / 2;

  // Body shell and glass.
  box(paint, shape.width, shape.bodyHeight, shape.length, 0, shape.bodyY, 0);
  box(
    paint,
    shape.cabinWidth,
    shape.cabinHeight,
    shape.cabinLength,
    0,
    cabinCenterY,
    shape.cabinZ
  );
  box(
    glass,
    shape.cabinWidth + 0.02,
    shape.cabinHeight * 0.55,
    shape.cabinLength - 0.5,
    0,
    cabinCenterY + 0.03,
    shape.cabinZ
  );
  box(
    glass,
    shape.cabinWidth - 0.15,
    shape.cabinHeight * 0.6,
    0.04,
    0,
    cabinCenterY + 0.02,
    cabinFront + 0.01
  );
  box(
    glass,
    shape.cabinWidth - 0.15,
    shape.cabinHeight * 0.6,
    0.04,
    0,
    cabinCenterY + 0.02,
    cabinRear - 0.01
  );
  if (design.bodyStyle === "pickup") {
    // Open load bed behind the cab.
    const bedLength = halfLength - 0.1 - cabinRear;
    const bedCenter = (-halfLength + 0.1 + cabinRear) / 2;
    box(
      paint,
      0.08,
      0.28,
      bedLength,
      -halfWidth + 0.06,
      bodyTop + 0.14,
      bedCenter
    );
    box(
      paint,
      0.08,
      0.28,
      bedLength,
      halfWidth - 0.06,
      bodyTop + 0.14,
      bedCenter
    );
    box(
      paint,
      shape.width - 0.1,
      0.28,
      0.08,
      0,
      bodyTop + 0.14,
      -halfLength + 0.1
    );
    box(
      dark,
      shape.width - 0.25,
      0.04,
      bedLength,
      0,
      bodyTop + 0.02,
      bedCenter
    );
  }

  // Bumpers, lights.
  box(dark, shape.width + 0.04, 0.18, 0.12, 0, 0.4, halfLength);
  box(dark, shape.width + 0.04, 0.18, 0.12, 0, 0.4, -halfLength);
  const headlight = getMaterial(
    scene,
    "headlight",
    LIGHT_COLORS[design.lights],
    {
      emissive: true
    }
  );
  const taillight = getMaterial(scene, "taillight", "#ff2a2a", {
    emissive: true
  });
  for (const side of [-1, 1]) {
    box(
      headlight,
      0.34,
      0.14,
      0.06,
      side * (halfWidth - 0.3),
      shape.bodyY + 0.08,
      halfLength + 0.02
    );
    box(
      taillight,
      0.34,
      0.12,
      0.06,
      side * (halfWidth - 0.3),
      shape.bodyY + 0.1,
      -halfLength - 0.02
    );
  }
  if (design.lights === "neon") {
    box(
      getMaterial(scene, "underglow", "#00f5ff", { emissive: true }),
      shape.width + 0.1,
      0.02,
      shape.length - 0.3,
      0,
      0.16,
      0
    );
  }

  // Wheels, with the rims the player picked.
  const wheelZ = halfLength - 0.75;
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const centerX = side * (halfWidth - 0.04);
      const centerZ = end * wheelZ;
      disc(dark, WHEEL_RADIUS * 2, WHEEL_WIDTH, centerX, WHEEL_RADIUS, centerZ);
      const faceX = centerX + side * (WHEEL_WIDTH / 2 + 0.005);
      addRims(design.rims, side, faceX, centerZ);
    }
  }

  function addRims(
    style: CarDesign["rims"],
    side: number,
    faceX: number,
    centerZ: number
  ): void {
    const y = WHEEL_RADIUS;
    switch (style) {
      case "standard":
        disc(rim, 0.42, 0.03, faceX, y, centerZ);
        break;
      case "sport":
        disc(dark, 0.5, 0.025, faceX, y, centerZ);
        for (let spoke = 0; spoke < 3; spoke += 1) {
          box(
            rim,
            0.04,
            0.5,
            0.07,
            faceX + side * 0.02,
            y,
            centerZ,
            (spoke * Math.PI) / 3
          );
        }
        break;
      case "turbo":
        disc(rim, 0.52, 0.03, faceX, y, centerZ);
        disc(dark, 0.34, 0.04, faceX + side * 0.01, y, centerZ);
        disc(rim, 0.14, 0.07, faceX + side * 0.03, y, centerZ);
        break;
      case "retro":
        disc(
          getMaterial(scene, "whitewall", "#f2f2f2"),
          0.6,
          0.02,
          faceX,
          y,
          centerZ
        );
        disc(rim, 0.3, 0.05, faceX + side * 0.02, y, centerZ);
        break;
    }
  }

  // Spoiler on the tail.
  const tailZ = -halfLength + 0.22;
  switch (design.spoiler) {
    case "none":
      break;
    case "lip":
      box(
        spoilerPaint,
        shape.width * 0.85,
        0.07,
        0.26,
        0,
        bodyTop + 0.04,
        tailZ
      );
      break;
    case "wing":
    case "tall": {
      const postHeight = design.spoiler === "wing" ? 0.3 : 0.55;
      const plateWidth = design.spoiler === "wing" ? 0.92 : 1;
      for (const side of [-1, 1]) {
        box(
          spoilerPaint,
          0.07,
          postHeight,
          0.12,
          side * (halfWidth - 0.35),
          bodyTop + postHeight / 2,
          tailZ
        );
      }
      box(
        spoilerPaint,
        shape.width * plateWidth,
        0.07,
        design.spoiler === "wing" ? 0.42 : 0.5,
        0,
        bodyTop + postHeight + 0.03,
        tailZ
      );
      break;
    }
  }

  // Roof extras.
  const roofLength = shape.cabinLength * 0.8;
  switch (design.roof) {
    case "none":
      break;
    case "rack":
      for (const side of [-1, 1]) {
        box(
          dark,
          0.05,
          0.05,
          roofLength,
          side * (shape.cabinWidth / 2 - 0.12),
          cabinTop + 0.08,
          shape.cabinZ
        );
      }
      for (const offset of [-0.35, 0.35]) {
        box(
          dark,
          shape.cabinWidth - 0.1,
          0.05,
          0.06,
          0,
          cabinTop + 0.1,
          shape.cabinZ + offset * (roofLength / 0.8 / 1.4)
        );
      }
      break;
    case "lightbar":
      box(
        dark,
        shape.cabinWidth * 0.85,
        0.1,
        0.2,
        0,
        cabinTop + 0.07,
        shape.cabinZ
      );
      box(
        getMaterial(scene, "siren-red", "#ff2d2d", { emissive: true }),
        shape.cabinWidth * 0.38,
        0.08,
        0.16,
        -shape.cabinWidth * 0.2,
        cabinTop + 0.14,
        shape.cabinZ
      );
      box(
        getMaterial(scene, "siren-blue", "#2d6bff", { emissive: true }),
        shape.cabinWidth * 0.38,
        0.08,
        0.16,
        shape.cabinWidth * 0.2,
        cabinTop + 0.14,
        shape.cabinZ
      );
      break;
    case "skibox":
      box(
        getMaterial(scene, "skibox", "#2b2f36"),
        shape.cabinWidth * 0.8,
        0.22,
        roofLength,
        0,
        cabinTop + 0.12,
        shape.cabinZ
      );
      break;
  }

  // Racing stripes follow the hood, roof and boot.
  const stripe = (centerX: number, width: number): void => {
    const hoodLength = halfLength - cabinFront;
    const bootLength = cabinRear + halfLength;
    if (hoodLength > 0.05) {
      box(
        stripePaint,
        width,
        0.012,
        hoodLength,
        centerX,
        bodyTop + 0.007,
        cabinFront + hoodLength / 2
      );
    }
    box(
      stripePaint,
      width,
      0.012,
      shape.cabinLength,
      centerX,
      cabinTop + 0.007,
      shape.cabinZ
    );
    if (bootLength > 0.05) {
      box(
        stripePaint,
        width,
        0.012,
        bootLength,
        centerX,
        bodyTop + 0.007,
        -halfLength + bootLength / 2
      );
    }
  };
  switch (design.stripes) {
    case "none":
      break;
    case "single":
      stripe(0, 0.34);
      break;
    case "double":
      stripe(-0.22, 0.14);
      stripe(0.22, 0.14);
      break;
    case "side":
      for (const side of [-1, 1]) {
        box(
          stripePaint,
          0.012,
          0.1,
          shape.length * 0.92,
          side * (halfWidth + 0.007),
          shape.bodyY + 0.02,
          0
        );
      }
      break;
  }

  // Merge everything that shares a material into one mesh.
  const groups = new Map<Material, Mesh[]>();
  for (const part of parts) {
    const group = groups.get(part.material) ?? [];
    group.push(part.mesh);
    groups.set(part.material, group);
  }
  for (const [material, meshes] of groups) {
    const merged = Mesh.MergeMeshes(
      meshes,
      true,
      true,
      undefined,
      false,
      false
    );
    if (merged === null) {
      continue;
    }
    merged.name = `${name}-${material.name}`;
    merged.material = material;
    merged.parent = root;
    merged.isPickable = false;
    merged.checkCollisions = false;
  }

  return root;
}
