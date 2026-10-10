import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Skin } from "@scooter-shooter/protocol";

/**
 * The capsule that carries a player is centred 1.2 m above the floor, so the
 * character is built on the floor and the whole rig is lowered by this much.
 */
const FEET_OFFSET = -1.2;
const DARK = "#1b1b24";

/**
 * Builds a blocky, fully skin-driven character out of primitives. Everything a
 * player can customise (colours, eyes, glasses, headwear, top, pants, shoes)
 * is derived from the {@link Skin} alone, so any device given the same skin
 * draws the same figure.
 */
export function buildCharacter(
  scene: Scene,
  parent: AbstractMesh | TransformNode,
  skin: Skin,
  name: string
): TransformNode {
  const root = new TransformNode(name, scene);
  root.parent = parent;
  root.position.y = FEET_OFFSET;

  const materials = new Map<string, StandardMaterial>();
  const material = (hex: string, alpha = 1): StandardMaterial => {
    const key = `${hex}|${String(alpha)}`;
    let existing = materials.get(key);
    if (existing === undefined) {
      existing = new StandardMaterial(`${name}-${key}`, scene);
      existing.diffuseColor = Color3.FromHexString(hex);
      existing.emissiveColor = Color3.FromHexString(hex).scale(0.35);
      existing.specularColor = Color3.Black();
      existing.alpha = alpha;
      materials.set(key, existing);
    }
    return existing;
  };

  const place = (
    mesh: Mesh,
    x: number,
    y: number,
    z: number,
    hex: string,
    alpha = 1
  ): Mesh => {
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.material = material(hex, alpha);
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    return mesh;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    hex: string,
    alpha = 1
  ): Mesh =>
    place(
      MeshBuilder.CreateBox(
        `${name}-box`,
        { width: w, height: h, depth: d },
        scene
      ),
      x,
      y,
      z,
      hex,
      alpha
    );
  const cylinder = (
    diameter: number,
    height: number,
    x: number,
    y: number,
    z: number,
    hex: string,
    alpha = 1
  ): Mesh =>
    place(
      MeshBuilder.CreateCylinder(
        `${name}-cylinder`,
        { diameter, height, tessellation: 16 },
        scene
      ),
      x,
      y,
      z,
      hex,
      alpha
    );
  const sphere = (
    diameter: number,
    x: number,
    y: number,
    z: number,
    hex: string
  ): Mesh =>
    place(
      MeshBuilder.CreateSphere(
        `${name}-sphere`,
        { diameter, segments: 10 },
        scene
      ),
      x,
      y,
      z,
      hex
    );

  const skinTone = skin.skinColor;
  buildLegsAndShoes(skin, box, skinTone);
  buildTorsoAndArms(skin, box, skinTone);
  buildHead(skin, box, skinTone);
  buildGlasses(skin, box, cylinder);
  buildHeadwear(skin, box, cylinder, sphere);

  return root;
}

type BoxFactory = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  hex: string,
  alpha?: number
) => Mesh;
type CylinderFactory = (
  diameter: number,
  height: number,
  x: number,
  y: number,
  z: number,
  hex: string,
  alpha?: number
) => Mesh;
type SphereFactory = (
  diameter: number,
  x: number,
  y: number,
  z: number,
  hex: string
) => Mesh;

const SIDES = [-1, 1] as const;

function buildLegsAndShoes(
  skin: Skin,
  box: BoxFactory,
  skinTone: string
): void {
  const pants = skin.pantsColor;
  for (const side of SIDES) {
    const x = side * 0.17;
    switch (skin.pants) {
      case "jeans":
        box(0.27, 0.7, 0.27, x, 0.53, 0, pants);
        break;
      case "cargo":
        box(0.27, 0.7, 0.27, x, 0.53, 0, pants);
        box(0.06, 0.2, 0.18, side * 0.32, 0.62, 0, shade(pants, 0.75));
        break;
      case "shorts":
        box(0.28, 0.36, 0.28, x, 0.7, 0, pants);
        box(0.25, 0.34, 0.25, x, 0.35, 0, skinTone);
        break;
      case "skirt":
        box(0.25, 0.7, 0.25, x, 0.53, 0, skinTone);
        break;
    }
  }
  if (skin.pants === "skirt") {
    box(0.82, 0.32, 0.5, 0, 0.77, 0, skin.pantsColor);
  }

  const shoes = skin.shoesColor;
  for (const side of SIDES) {
    const x = side * 0.17;
    switch (skin.shoes) {
      case "none":
        box(0.25, 0.1, 0.38, x, 0.05, 0.06, skinTone);
        break;
      case "sneakers":
        box(0.3, 0.16, 0.46, x, 0.1, 0.07, shoes);
        box(0.32, 0.04, 0.48, x, 0.02, 0.07, "#f2f2f2");
        break;
      case "boots":
        box(0.31, 0.34, 0.34, x, 0.17, -0.01, shoes);
        box(0.3, 0.14, 0.2, x, 0.07, 0.2, shoes);
        box(0.33, 0.05, 0.5, x, 0.025, 0.06, DARK);
        break;
      case "hightops":
        box(0.3, 0.28, 0.4, x, 0.14, 0.03, shoes);
        box(0.3, 0.12, 0.18, x, 0.06, 0.21, shoes);
        box(0.32, 0.04, 0.5, x, 0.02, 0.07, "#f2f2f2");
        box(0.31, 0.04, 0.2, x, 0.26, 0.03, shade(shoes, 0.6));
        break;
    }
  }
}

function buildTorsoAndArms(
  skin: Skin,
  box: BoxFactory,
  skinTone: string
): void {
  const top = skin.topColor;
  const dark = shade(top, 0.7);

  // Neck, hidden by most tops but visible with a tank top.
  box(0.24, 0.12, 0.24, 0, 1.72, 0, skinTone);
  box(0.74, 0.8, 0.42, 0, 1.28, 0, top);

  for (const side of SIDES) {
    const x = side * 0.47;
    switch (skin.top) {
      case "tshirt":
        box(0.25, 0.3, 0.25, x, 1.48, 0, top);
        box(0.2, 0.4, 0.2, x, 1.13, 0, skinTone);
        break;
      case "tank":
        box(0.2, 0.7, 0.2, x, 1.28, 0, skinTone);
        break;
      case "longsleeve":
      case "hoodie":
      case "jacket":
        box(0.24, 0.6, 0.24, x, 1.33, 0, top);
        box(0.2, 0.1, 0.2, x, 0.98, 0, skinTone);
        break;
    }
  }

  if (skin.top === "tank") {
    box(0.3, 0.14, 0.02, 0, 1.6, 0.215, skinTone);
  }
  if (skin.top === "hoodie") {
    box(0.5, 0.22, 0.22, 0, 1.62, -0.26, dark);
    box(0.42, 0.16, 0.03, 0, 1.0, 0.22, dark);
  }
  if (skin.top === "jacket") {
    box(0.06, 0.8, 0.02, 0, 1.28, 0.215, dark);
    box(0.62, 0.1, 0.46, 0, 1.68, 0, dark);
    box(0.74, 0.06, 0.44, 0, 0.9, 0, dark);
  }
}

function buildHead(skin: Skin, box: BoxFactory, skinTone: string): void {
  box(0.62, 0.6, 0.6, 0, 2.0, 0, skinTone);
  box(0.07, 0.14, 0.1, -0.345, 2.0, 0, skinTone);
  box(0.07, 0.14, 0.1, 0.345, 2.0, 0, skinTone);
  box(0.09, 0.11, 0.09, 0, 1.96, 0.33, shade(skinTone, 0.92));
  box(0.2, 0.03, 0.02, 0, 1.82, 0.302, "#7a3b3b");

  const eye = EYE_SHAPES[skin.eyeShape];
  for (const side of SIDES) {
    const x = side * 0.15;
    const sclera = box(eye.width, eye.height, 0.01, x, 2.05, 0.305, "#ffffff");
    const iris = box(
      eye.iris,
      eye.irisHeight,
      0.01,
      x,
      2.05,
      0.312,
      skin.eyeColor
    );
    const pupil = box(
      eye.iris * 0.5,
      eye.irisHeight * 0.5,
      0.01,
      x,
      2.05,
      0.319,
      DARK
    );
    for (const mesh of [sclera, iris, pupil]) {
      mesh.rotation.z = side * eye.tilt;
    }
  }
}

interface EyeShape {
  readonly width: number;
  readonly height: number;
  readonly iris: number;
  readonly irisHeight: number;
  readonly tilt: number;
}

const EYE_SHAPES: Record<Skin["eyeShape"], EyeShape> = {
  round: { width: 0.17, height: 0.17, iris: 0.1, irisHeight: 0.1, tilt: 0 },
  oval: { width: 0.12, height: 0.2, iris: 0.09, irisHeight: 0.13, tilt: 0 },
  narrow: { width: 0.22, height: 0.09, iris: 0.08, irisHeight: 0.08, tilt: 0 },
  angry: { width: 0.2, height: 0.11, iris: 0.08, irisHeight: 0.09, tilt: 0.38 },
  big: { width: 0.23, height: 0.23, iris: 0.16, irisHeight: 0.16, tilt: 0 }
};

function buildGlasses(
  skin: Skin,
  box: BoxFactory,
  cylinder: CylinderFactory
): void {
  const frame = DARK;
  const temples = (): void => {
    for (const side of SIDES) {
      box(0.025, 0.03, 0.62, side * 0.325, 2.06, 0.02, frame);
    }
  };

  switch (skin.glasses) {
    case "none":
      return;
    case "round": {
      for (const side of SIDES) {
        const ring = cylinder(0.27, 0.03, side * 0.15, 2.05, 0.325, frame);
        ring.rotation.x = Math.PI / 2;
        const lens = cylinder(
          0.22,
          0.034,
          side * 0.15,
          2.05,
          0.326,
          "#bfe9ff",
          0.45
        );
        lens.rotation.x = Math.PI / 2;
      }
      box(0.08, 0.03, 0.03, 0, 2.08, 0.325, frame);
      temples();
      return;
    }
    case "square": {
      for (const side of SIDES) {
        const x = side * 0.15;
        box(0.27, 0.03, 0.03, x, 2.17, 0.325, frame);
        box(0.27, 0.03, 0.03, x, 1.93, 0.325, frame);
        box(0.03, 0.24, 0.03, x - 0.12, 2.05, 0.325, frame);
        box(0.03, 0.24, 0.03, x + 0.12, 2.05, 0.325, frame);
        box(0.22, 0.2, 0.02, x, 2.05, 0.325, "#bfe9ff", 0.4);
      }
      box(0.08, 0.03, 0.03, 0, 2.1, 0.325, frame);
      temples();
      return;
    }
    case "sunglasses": {
      for (const side of SIDES) {
        box(0.28, 0.18, 0.04, side * 0.15, 2.05, 0.325, "#0b0b10");
      }
      box(0.08, 0.04, 0.04, 0, 2.1, 0.325, frame);
      temples();
      return;
    }
    case "goggles": {
      box(0.68, 0.1, 0.66, 0, 2.06, 0, shade(skin.headwearColor, 0.55));
      for (const side of SIDES) {
        const rim = cylinder(0.3, 0.07, side * 0.15, 2.05, 0.33, frame);
        rim.rotation.x = Math.PI / 2;
        const lens = cylinder(
          0.24,
          0.08,
          side * 0.15,
          2.05,
          0.335,
          "#ffb35a",
          0.7
        );
        lens.rotation.x = Math.PI / 2;
      }
      return;
    }
  }
}

function buildHeadwear(
  skin: Skin,
  box: BoxFactory,
  cylinder: CylinderFactory,
  sphere: SphereFactory
): void {
  const hat = skin.headwearColor;
  const dark = shade(hat, 0.65);

  switch (skin.headwear) {
    case "none":
      return;
    case "cap": {
      box(0.66, 0.16, 0.66, 0, 2.36, 0, hat);
      box(0.58, 0.06, 0.58, 0, 2.47, 0, hat);
      box(0.5, 0.04, 0.3, 0, 2.31, 0.45, dark);
      return;
    }
    case "beanie": {
      box(0.66, 0.26, 0.66, 0, 2.41, 0, hat);
      box(0.7, 0.1, 0.7, 0, 2.31, 0, dark);
      sphere(0.17, 0, 2.62, 0, "#f4f4f4");
      return;
    }
    case "tophat": {
      box(0.94, 0.04, 0.94, 0, 2.32, 0, hat);
      box(0.56, 0.52, 0.56, 0, 2.58, 0, hat);
      box(0.58, 0.1, 0.58, 0, 2.4, 0, "#e8d8a0");
      return;
    }
    case "soldier": {
      const dome = sphere(0.92, 0, 2.28, 0, hat);
      dome.scaling.y = 0.62;
      box(0.94, 0.05, 0.94, 0, 2.29, 0, dark);
      for (const side of SIDES) {
        box(0.04, 0.26, 0.04, side * 0.33, 2.15, 0.2, dark);
      }
      return;
    }
    case "biker": {
      const dome = sphere(0.9, 0, 2.28, 0.02, hat);
      dome.scaling.set(1, 0.6, 1.08);
      box(0.12, 0.03, 0.7, 0, 2.55, 0, dark);
      box(0.56, 0.06, 0.2, 0, 2.3, 0.45, "#1b2a3a", 0.8);
      return;
    }
    case "knight": {
      const dome = sphere(0.94, 0, 2.28, 0, hat);
      dome.scaling.y = 0.66;
      box(0.06, 0.3, 0.05, 0, 2.12, 0.335, hat);
      for (const side of SIDES) {
        box(0.05, 0.4, 0.5, side * 0.335, 2.1, 0.0, hat);
      }
      box(0.08, 0.2, 0.74, 0, 2.62, -0.02, "#c0392b");
      cylinder(0.98, 0.04, 0, 2.3, 0, dark);
      return;
    }
  }
}

/** Multiplies each channel of a #rrggbb colour, clamping to the valid range. */
export function shade(hex: string, factor: number): string {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16);
    const scaled = Math.min(255, Math.max(0, Math.round(value * factor)));
    return scaled.toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}
