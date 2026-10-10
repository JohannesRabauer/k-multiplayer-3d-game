import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import {
  DEFAULT_SKIN,
  MAX_SAVED_SKINS,
  SKIN_OPTIONS,
  getActiveSkin,
  removeSkin,
  selectSkin,
  upsertSkin,
  type Skin,
  type SkinLibrary
} from "@scooter-shooter/protocol";

import { buildCharacter } from "../game/CharacterBuilder";
import { loadSkinLibrary, saveSkinLibrary } from "../game/skinStorage";

type OptionKey = keyof typeof SKIN_OPTIONS;
type ColorKey =
  | "skinColor"
  | "eyeColor"
  | "headwearColor"
  | "topColor"
  | "pantsColor"
  | "shoesColor";

const OPTION_GROUPS: readonly { key: OptionKey; label: string }[] = [
  { key: "headwear", label: "Hats & helmets" },
  { key: "glasses", label: "Glasses" },
  { key: "eyeShape", label: "Eye shape" },
  { key: "top", label: "Top" },
  { key: "pants", label: "Pants" },
  { key: "shoes", label: "Shoes" }
];

const COLOR_FIELDS: readonly { key: ColorKey; label: string }[] = [
  { key: "skinColor", label: "Skin" },
  { key: "eyeColor", label: "Eyes" },
  { key: "headwearColor", label: "Hat / helmet" },
  { key: "topColor", label: "Top" },
  { key: "pantsColor", label: "Pants" },
  { key: "shoesColor", label: "Shoes" }
];

const SKIN_TONES = [
  "#ffdbac",
  "#f1c27d",
  "#e0ac69",
  "#c68642",
  "#8d5524",
  "#5c3a1e"
] as const;

export interface SkinEditorElements {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly options: HTMLElement;
  readonly library: HTMLElement;
  readonly nameInput: HTMLInputElement;
  readonly message: HTMLElement;
  readonly saveButton: HTMLButtonElement;
  readonly saveNewButton: HTMLButtonElement;
  readonly deleteButton: HTMLButtonElement;
  readonly closeButton: HTMLButtonElement;
  readonly turnLeftButton: HTMLButtonElement;
  readonly turnRightButton: HTMLButtonElement;
  readonly randomButton: HTMLButtonElement;
}

/**
 * The character customisation screen. It edits a draft skin with a live 3D
 * preview and saves finished combinations to the on-device skin library; the
 * active skin is the one every game session wears.
 */
export class SkinEditor {
  readonly #elements: SkinEditorElements;
  #library: SkinLibrary = loadSkinLibrary();
  #draft: Skin = { ...DEFAULT_SKIN };
  #editingId = "";
  #engine: Engine | undefined;
  #scene: Scene | undefined;
  #pivot: TransformNode | undefined;
  #targetYaw = 0;
  #character: TransformNode | undefined;
  readonly #chips = new Map<string, HTMLButtonElement>();
  readonly #colorInputs = new Map<ColorKey, HTMLInputElement>();
  #isOpen = false;

  constructor(elements: SkinEditorElements) {
    this.#elements = elements;
    this.#buildControls();

    elements.closeButton.addEventListener("click", () => {
      this.close();
    });
    elements.saveButton.addEventListener("click", () => {
      this.#save(this.#editingId);
    });
    elements.saveNewButton.addEventListener("click", () => {
      this.#save(`skin-${Date.now().toString(36)}`);
    });
    elements.deleteButton.addEventListener("click", () => {
      this.#library = removeSkin(this.#library, this.#editingId);
      this.#persist("Skin deleted.");
      this.#loadActive();
    });
    elements.turnLeftButton.addEventListener("click", () => {
      this.#targetYaw -= Math.PI / 4;
    });
    elements.turnRightButton.addEventListener("click", () => {
      this.#targetYaw += Math.PI / 4;
    });
    elements.randomButton.addEventListener("click", () => {
      this.#draft = randomSkin();
      this.#refresh();
    });
  }

  get isOpen(): boolean {
    return this.#isOpen;
  }

  open(): void {
    this.#library = loadSkinLibrary();
    this.#elements.root.hidden = false;
    this.#isOpen = true;
    this.#startPreview();
    this.#loadActive();
    this.#elements.message.textContent = "";
  }

  close(): void {
    this.#isOpen = false;
    this.#elements.root.hidden = true;
    this.#stopPreview();
  }

  /** The skin the next game will wear. */
  getActiveSkin(): Skin {
    return getActiveSkin(loadSkinLibrary());
  }

  #loadActive(): void {
    const active =
      this.#library.skins.find((item) => item.id === this.#library.activeId) ??
      this.#library.skins[0];
    this.#editingId = active?.id ?? this.#library.activeId;
    this.#draft = { ...(active?.skin ?? DEFAULT_SKIN) };
    this.#elements.nameInput.value = active?.name ?? "My skin";
    this.#refresh();
  }

  #save(id: string): void {
    const isNew = !this.#library.skins.some((item) => item.id === id);
    if (isNew && this.#library.skins.length >= MAX_SAVED_SKINS) {
      this.#elements.message.textContent = `You can keep ${String(MAX_SAVED_SKINS)} skins. Delete one first.`;
      return;
    }
    this.#library = upsertSkin(this.#library, {
      id,
      name: this.#elements.nameInput.value,
      skin: this.#draft
    });
    this.#editingId = id;
    this.#persist("Skin saved. It will be worn in your next game.");
    this.#renderLibrary();
  }

  #persist(successMessage: string): void {
    this.#elements.message.textContent = saveSkinLibrary(this.#library)
      ? successMessage
      : "This browser blocked saving, so the skin lasts only until you close the page.";
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

      for (const value of SKIN_OPTIONS[group.key]) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "skin-chip";
        chip.textContent = humanize(value);
        chip.dataset.skinOption = `${group.key}:${value}`;
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
      input.id = `skin-color-${field.key}`;
      input.dataset.skinColor = field.key;
      name.htmlFor = input.id;
      input.addEventListener("input", () => {
        this.#draft = { ...this.#draft, [field.key]: input.value };
        this.#refresh();
      });
      this.#colorInputs.set(field.key, input);
      row.append(name, input);

      if (field.key === "skinColor") {
        for (const tone of SKIN_TONES) {
          const swatch = document.createElement("button");
          swatch.type = "button";
          swatch.className = "skin-swatch";
          swatch.style.background = tone;
          swatch.setAttribute("aria-label", `Skin tone ${tone}`);
          swatch.addEventListener("click", () => {
            this.#draft = { ...this.#draft, skinColor: tone };
            this.#refresh();
          });
          row.append(swatch);
        }
      }
      colors.append(row);
    }
    container.append(colors);
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
    this.#renderLibrary();
    this.#rebuildCharacter();
  }

  #renderLibrary(): void {
    const container = this.#elements.library;
    container.replaceChildren();
    for (const saved of this.#library.skins) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "skin-chip";
      button.textContent =
        saved.id === this.#library.activeId ? `★ ${saved.name}` : saved.name;
      button.setAttribute("aria-pressed", String(saved.id === this.#editingId));
      button.dataset.skinId = saved.id;
      button.addEventListener("click", () => {
        this.#library = selectSkin(this.#library, saved.id);
        this.#persist(`Now wearing “${saved.name}”.`);
        this.#loadActive();
      });
      container.append(button);
    }
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
      "preview-light",
      new Vector3(0.3, 1, -0.6),
      scene
    ).intensity = 1;
    const camera = new ArcRotateCamera(
      "preview-camera",
      Math.PI / 2,
      Math.PI / 2.15,
      4.6,
      new Vector3(0, 1.15, 0),
      scene
    );
    camera.inputs.clear();
    camera.minZ = 0.1;

    const pivot = new TransformNode("preview-pivot", scene);
    pivot.position.y = 1.2;
    this.#pivot = pivot;
    this.#targetYaw = -Math.PI * 0.12;
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
    this.#character = undefined;
  }

  readonly #onResize = (): void => {
    this.#engine?.resize();
  };

  #rebuildCharacter(): void {
    if (this.#scene === undefined || this.#pivot === undefined) {
      return;
    }
    this.#character?.dispose(false, true);
    this.#character = buildCharacter(
      this.#scene,
      this.#pivot,
      this.#draft,
      "preview-character"
    );
  }
}

function humanize(value: string): string {
  const spaced = value.replace(/([a-z])([A-Z])/gu, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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

function randomSkin(): Skin {
  return {
    skinColor: pick(SKIN_TONES),
    eyeColor: randomColor(),
    eyeShape: pick(SKIN_OPTIONS.eyeShape),
    glasses: pick(SKIN_OPTIONS.glasses),
    headwear: pick(SKIN_OPTIONS.headwear),
    headwearColor: randomColor(),
    top: pick(SKIN_OPTIONS.top),
    topColor: randomColor(),
    pants: pick(SKIN_OPTIONS.pants),
    pantsColor: randomColor(),
    shoes: pick(SKIN_OPTIONS.shoes),
    shoesColor: randomColor()
  };
}
