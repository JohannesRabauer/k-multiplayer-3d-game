import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import {
  CAR_OPTIONS,
  DEFAULT_CAR,
  NPC_CARS,
  normalizeCar,
  type CarDesign
} from "@scooter-shooter/protocol";

import { buildCar } from "../game/CarBuilder";
import { loadCar, saveCar } from "../game/carStorage";

type OptionKey = keyof typeof CAR_OPTIONS;
type ColorKey = "paintColor" | "rimColor" | "spoilerColor" | "stripeColor";

const OPTION_GROUPS: readonly { key: OptionKey; label: string }[] = [
  { key: "bodyStyle", label: "Body" },
  { key: "rims", label: "Rims" },
  { key: "spoiler", label: "Spoiler" },
  { key: "roof", label: "Roof" },
  { key: "stripes", label: "Stripes" },
  { key: "lights", label: "Lights" }
];

const COLOR_FIELDS: readonly { key: ColorKey; label: string }[] = [
  { key: "paintColor", label: "Paint" },
  { key: "rimColor", label: "Rims" },
  { key: "spoilerColor", label: "Spoiler" },
  { key: "stripeColor", label: "Stripes" }
];

const PAINT_SWATCHES = [
  "#e63946",
  "#ff7b00",
  "#ffbe0b",
  "#06d6a0",
  "#3a86ff",
  "#9b5de5",
  "#f8f9fa",
  "#22252b"
] as const;

export interface CarEditorElements {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly options: HTMLElement;
  readonly presets: HTMLElement;
  readonly message: HTMLElement;
  readonly saveButton: HTMLButtonElement;
  readonly resetButton: HTMLButtonElement;
  readonly closeButton: HTMLButtonElement;
  readonly turnLeftButton: HTMLButtonElement;
  readonly turnRightButton: HTMLButtonElement;
  readonly randomButton: HTMLButtonElement;
}

/**
 * The vehicle workshop. It edits a draft design with a live 3D preview and
 * stores the finished car on the device; that saved design is the one every
 * game session drives and shows to the other players.
 */
export class CarEditor {
  readonly #elements: CarEditorElements;
  #draft: CarDesign = { ...DEFAULT_CAR };
  #engine: Engine | undefined;
  #scene: Scene | undefined;
  #pivot: TransformNode | undefined;
  #car: TransformNode | undefined;
  #targetYaw = 0;
  readonly #chips = new Map<string, HTMLButtonElement>();
  readonly #colorInputs = new Map<ColorKey, HTMLInputElement>();
  #isOpen = false;

  constructor(elements: CarEditorElements) {
    this.#elements = elements;
    this.#buildControls();

    elements.closeButton.addEventListener("click", () => {
      this.close();
    });
    elements.saveButton.addEventListener("click", () => {
      this.#draft = normalizeCar(this.#draft);
      this.#elements.message.textContent = saveCar(this.#draft)
        ? "Car saved. You will drive it in your next game."
        : "This browser blocked saving, so the car lasts only until you close the page.";
    });
    elements.resetButton.addEventListener("click", () => {
      this.#draft = { ...DEFAULT_CAR };
      this.#refresh();
    });
    elements.turnLeftButton.addEventListener("click", () => {
      this.#targetYaw -= Math.PI / 4;
    });
    elements.turnRightButton.addEventListener("click", () => {
      this.#targetYaw += Math.PI / 4;
    });
    elements.randomButton.addEventListener("click", () => {
      this.#draft = randomCar();
      this.#refresh();
    });
  }

  get isOpen(): boolean {
    return this.#isOpen;
  }

  open(): void {
    this.#draft = loadCar();
    this.#elements.root.hidden = false;
    this.#isOpen = true;
    this.#startPreview();
    this.#refresh();
    this.#elements.message.textContent = "";
  }

  close(): void {
    this.#isOpen = false;
    this.#elements.root.hidden = true;
    this.#stopPreview();
  }

  #buildControls(): void {
    const container = this.#elements.options;
    container.replaceChildren();

    for (const group of OPTION_GROUPS) {
      const wrapper = document.createElement("div");
      wrapper.className = "skin-group";
      const label = document.createElement("span");
      label.className = "skin-group__label";
      label.textContent = group.label;
      const row = document.createElement("div");
      row.className = "skin-group__row";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", group.label);

      for (const value of CAR_OPTIONS[group.key]) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "skin-chip";
        chip.textContent = humanize(value);
        chip.dataset.carOption = `${group.key}:${value}`;
        chip.addEventListener("click", () => {
          this.#draft = { ...this.#draft, [group.key]: value };
          this.#refresh();
        });
        this.#chips.set(`${group.key}:${value}`, chip);
        row.append(chip);
      }
      wrapper.append(label, row);
      container.append(wrapper);
    }

    const colors = document.createElement("div");
    colors.className = "skin-group";
    const colorLabel = document.createElement("span");
    colorLabel.className = "skin-group__label";
    colorLabel.textContent = "Colors";
    colors.append(colorLabel);

    for (const field of COLOR_FIELDS) {
      const row = document.createElement("div");
      row.className = "skin-group__row";
      const name = document.createElement("label");
      name.textContent = field.label;
      name.style.minWidth = "6.5rem";
      const input = document.createElement("input");
      input.type = "color";
      input.className = "skin-color";
      input.id = `car-color-${field.key}`;
      input.dataset.carColor = field.key;
      name.htmlFor = input.id;
      input.addEventListener("input", () => {
        this.#draft = { ...this.#draft, [field.key]: input.value };
        this.#refresh();
      });
      this.#colorInputs.set(field.key, input);
      row.append(name, input);

      if (field.key === "paintColor") {
        for (const swatchColor of PAINT_SWATCHES) {
          const swatch = document.createElement("button");
          swatch.type = "button";
          swatch.className = "skin-swatch";
          swatch.style.background = swatchColor;
          swatch.setAttribute("aria-label", `Paint ${swatchColor}`);
          swatch.addEventListener("click", () => {
            this.#draft = { ...this.#draft, paintColor: swatchColor };
            this.#refresh();
          });
          row.append(swatch);
        }
      }
      colors.append(row);
    }
    container.append(colors);

    const presets = this.#elements.presets;
    presets.replaceChildren();
    NPC_CARS.forEach((preset, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "skin-chip";
      button.textContent = `${humanize(preset.bodyStyle)} ${String(index + 1)}`;
      button.style.borderLeft = `0.6rem solid ${preset.paintColor}`;
      button.addEventListener("click", () => {
        this.#draft = { ...preset };
        this.#refresh();
      });
      presets.append(button);
    });
  }

  #refresh(): void {
    for (const [key, chip] of this.#chips) {
      const [group, value] = key.split(":") as [OptionKey, string];
      chip.setAttribute(
        "aria-pressed",
        String((this.#draft as Record<string, string>)[group] === value)
      );
    }
    for (const [key, input] of this.#colorInputs) {
      input.value = this.#draft[key];
    }
    this.#rebuildCar();
  }

  #startPreview(): void {
    if (this.#engine !== undefined) {
      return;
    }
    const engine = new Engine(this.#elements.canvas, true, {
      preserveDrawingBuffer: false,
      stencil: false
    });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    new HemisphericLight(
      "car-preview-light",
      new Vector3(0.3, 1, -0.6),
      scene
    ).intensity = 0.85;
    new DirectionalLight(
      "car-preview-sun",
      new Vector3(-0.5, -1, 0.6),
      scene
    ).intensity = 0.9;
    const camera = new ArcRotateCamera(
      "car-preview-camera",
      Math.PI / 2,
      Math.PI / 2.6,
      7.4,
      new Vector3(0, 0.7, 0),
      scene
    );
    camera.inputs.clear();
    camera.minZ = 0.1;

    const floor = MeshBuilder.CreateDisc(
      "car-preview-floor",
      { radius: 3.2, tessellation: 48 },
      scene
    );
    floor.rotation.x = Math.PI / 2;
    const floorMaterial = new StandardMaterial("car-preview-floor-mat", scene);
    floorMaterial.diffuseColor = Color3.FromHexString("#2b3a63");
    floorMaterial.specularColor = Color3.Black();
    floor.material = floorMaterial;

    const pivot = new TransformNode("car-preview-pivot", scene);
    this.#pivot = pivot;
    this.#targetYaw = -Math.PI * 0.2;
    pivot.rotation.y = this.#targetYaw;
    scene.onBeforeRenderObservable.add(() => {
      pivot.rotation.y += (this.#targetYaw - pivot.rotation.y) * 0.15;
    });

    this.#engine = engine;
    this.#scene = scene;
    engine.runRenderLoop(() => {
      scene.render();
    });
    window.addEventListener("resize", this.#onResize);
  }

  #stopPreview(): void {
    window.removeEventListener("resize", this.#onResize);
    this.#engine?.stopRenderLoop();
    this.#scene?.dispose();
    this.#engine?.dispose();
    this.#engine = undefined;
    this.#scene = undefined;
    this.#pivot = undefined;
    this.#car = undefined;
  }

  readonly #onResize = (): void => {
    this.#engine?.resize();
  };

  #rebuildCar(): void {
    if (this.#scene === undefined || this.#pivot === undefined) {
      return;
    }
    this.#car?.dispose(false, false);
    this.#car = buildCar(this.#scene, this.#draft, "preview-car");
    this.#car.parent = this.#pivot;
  }
}

function humanize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)] ?? (values[0] as T);
}

function randomColor(): string {
  const channel = (): string =>
    Math.floor(40 + Math.random() * 180)
      .toString(16)
      .padStart(2, "0");
  return `#${channel()}${channel()}${channel()}`;
}

function randomCar(): CarDesign {
  return {
    bodyStyle: pick(CAR_OPTIONS.bodyStyle),
    paintColor: pick(PAINT_SWATCHES),
    rims: pick(CAR_OPTIONS.rims),
    rimColor: randomColor(),
    spoiler: pick(CAR_OPTIONS.spoiler),
    spoilerColor: randomColor(),
    roof: pick(CAR_OPTIONS.roof),
    stripes: pick(CAR_OPTIONS.stripes),
    stripeColor: randomColor(),
    lights: pick(CAR_OPTIONS.lights)
  };
}
