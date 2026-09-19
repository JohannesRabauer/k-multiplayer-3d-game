import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";

export interface PistolControllerOptions {
  readonly onAmmoChanged: (ammo: number, magazineSize: number) => void;
  readonly onShot: (origin: Vector3, direction: Vector3) => void;
}

export class PistolController {
  readonly #camera: ArcRotateCamera;
  readonly #muzzleFlash: AbstractMesh;
  readonly #observer: Observer<Scene>;
  readonly #options: PistolControllerOptions;
  readonly #root: TransformNode;
  readonly #scene: Scene;
  readonly #tracer: AbstractMesh;
  #ammo = DEFAULT_GAME_CONFIG.pistol.magazineSize;
  #audioContext: AudioContext | undefined;
  #isTriggerHeld = false;
  #lastShotAtMs = Number.NEGATIVE_INFINITY;
  #reloadingUntilMs = 0;
  #visualEffectEndsAtMs = 0;

  constructor(
    scene: Scene,
    player: AbstractMesh,
    camera: ArcRotateCamera,
    options: PistolControllerOptions
  ) {
    this.#camera = camera;
    this.#options = options;
    this.#scene = scene;
    this.#root = new TransformNode("pistol-root", scene);
    this.#root.parent = player;
    this.#root.position = new Vector3(0.48, 0.45, 0.45);

    const bodyMaterial = new StandardMaterial("pistol-body-material", scene);
    bodyMaterial.diffuseColor = Color3.FromHexString("#343a4a");
    bodyMaterial.specularColor = Color3.FromHexString("#8fa3bf");

    const accentMaterial = new StandardMaterial(
      "pistol-accent-material",
      scene
    );
    accentMaterial.diffuseColor = Color3.FromHexString("#ffd657");

    const body = MeshBuilder.CreateBox(
      "pistol-body",
      { width: 0.22, height: 0.24, depth: 0.75 },
      scene
    );
    body.material = bodyMaterial;
    body.parent = this.#root;

    const grip = MeshBuilder.CreateBox(
      "pistol-grip",
      { width: 0.18, height: 0.45, depth: 0.2 },
      scene
    );
    grip.position = new Vector3(0, -0.28, -0.18);
    grip.rotation.x = -0.25;
    grip.material = bodyMaterial;
    grip.parent = this.#root;

    this.#muzzleFlash = MeshBuilder.CreateSphere(
      "pistol-muzzle-flash",
      { diameter: 0.22, segments: 6 },
      scene
    );
    this.#muzzleFlash.position = new Vector3(0, 0, 0.48);
    this.#muzzleFlash.material = accentMaterial;
    this.#muzzleFlash.parent = this.#root;
    this.#muzzleFlash.setEnabled(false);

    this.#tracer = MeshBuilder.CreateCylinder(
      "pistol-tracer",
      { diameter: 0.025, height: 4, tessellation: 6 },
      scene
    );
    this.#tracer.position = new Vector3(0, 0, 2.45);
    this.#tracer.rotation.x = Math.PI / 2;
    this.#tracer.material = accentMaterial;
    this.#tracer.parent = this.#root;
    this.#tracer.setEnabled(false);

    this.#options.onAmmoChanged(
      this.#ammo,
      DEFAULT_GAME_CONFIG.pistol.magazineSize
    );
    this.#observer = scene.onBeforeRenderObservable.add(() => {
      this.#update(performance.now());
    });
  }

  setTriggerHeld(isHeld: boolean): void {
    this.#isTriggerHeld = isHeld;
    if (isHeld) {
      this.#tryFire(performance.now());
    }
  }

  dispose(): void {
    this.#scene.onBeforeRenderObservable.remove(this.#observer);
    void this.#audioContext?.close();
    this.#root.dispose();
  }

  #update(nowMs: number): void {
    this.#root.rotation.y = -this.#camera.alpha - Math.PI / 2;
    this.#root.rotation.x = this.#camera.beta - Math.PI / 2;

    if (nowMs >= this.#visualEffectEndsAtMs) {
      this.#muzzleFlash.setEnabled(false);
      this.#tracer.setEnabled(false);
      this.#root.position.z = 0.45;
    }

    if (this.#reloadingUntilMs > 0 && nowMs >= this.#reloadingUntilMs) {
      this.#ammo = DEFAULT_GAME_CONFIG.pistol.magazineSize;
      this.#reloadingUntilMs = 0;
      this.#options.onAmmoChanged(
        this.#ammo,
        DEFAULT_GAME_CONFIG.pistol.magazineSize
      );
    }

    if (this.#isTriggerHeld) {
      this.#tryFire(nowMs);
    }
  }

  #tryFire(nowMs: number): void {
    const config = DEFAULT_GAME_CONFIG.pistol;
    if (this.#reloadingUntilMs > 0) {
      return;
    }
    if (nowMs - this.#lastShotAtMs < config.fireIntervalMs) {
      return;
    }
    if (this.#ammo === 0) {
      this.#reloadingUntilMs = nowMs + config.reloadDurationMs;
      return;
    }

    this.#lastShotAtMs = nowMs;
    this.#ammo -= 1;
    this.#visualEffectEndsAtMs = nowMs + 55;
    this.#muzzleFlash.setEnabled(true);
    this.#tracer.setEnabled(true);
    this.#root.position.z = 0.32;
    this.#options.onAmmoChanged(this.#ammo, config.magazineSize);
    this.#playShotSound();

    const origin = this.#muzzleFlash.getAbsolutePosition();
    const direction = this.#camera.getForwardRay().direction.normalize();
    this.#options.onShot(origin, direction);
  }

  #playShotSound(): void {
    const AudioContextConstructor = window.AudioContext;
    this.#audioContext ??= new AudioContextConstructor();
    if (this.#audioContext.state === "suspended") {
      void this.#audioContext.resume();
    }

    const oscillator = this.#audioContext.createOscillator();
    const gain = this.#audioContext.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(130, this.#audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      55,
      this.#audioContext.currentTime + 0.06
    );
    gain.gain.setValueAtTime(0.045, this.#audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      this.#audioContext.currentTime + 0.07
    );
    oscillator.connect(gain);
    gain.connect(this.#audioContext.destination);
    oscillator.start();
    oscillator.stop(this.#audioContext.currentTime + 0.07);
  }
}
