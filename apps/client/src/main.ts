import "@babylonjs/core/Engines/engine";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "./styles.css";

import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";
import { DEFAULT_GAME_CONFIG } from "@scooter-shooter/game-config";
import { registerSW } from "virtual:pwa-register";

import { AimController } from "./game/AimController";
import { createBlocktown } from "./game/createBlocktown";
import { LocalPlayerController } from "./game/LocalPlayerController";
import { LocalHitscanResolver } from "./game/LocalHitscanResolver";
import { OfflineCombatController } from "./game/OfflineCombatController";
import { PerformanceMonitor } from "./game/PerformanceMonitor";
import { PistolController } from "./game/PistolController";
import { createThirdPersonCamera } from "./game/ThirdPersonCamera";
import { VirtualJoystick } from "./input/VirtualJoystick";

function requireHtmlElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Required application element is missing: #${id}`);
  }
  return element;
}

function requireOutputElement(id: string): HTMLOutputElement {
  const element = requireHtmlElement(id);
  if (!(element instanceof HTMLOutputElement)) {
    throw new TypeError(`#${id} must be an output element.`);
  }
  return element;
}

function requireTimeElement(id: string): HTMLTimeElement {
  const element = requireHtmlElement(id);
  if (!(element instanceof HTMLTimeElement)) {
    throw new TypeError(`#${id} must be a time element.`);
  }
  return element;
}

const canvasElement = requireHtmlElement("game-canvas");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new TypeError("#game-canvas must be a canvas element.");
}

const canvas = canvasElement;
const statusPanel = requireHtmlElement("status-panel");
const statusMessage = requireHtmlElement("status-message");
const movementJoystickElement = requireHtmlElement("movement-joystick");
const aimJoystickElement = requireHtmlElement("aim-joystick");
const performanceStatsElement = requireOutputElement("performance-stats");
const ammoValueElement = requireHtmlElement("ammo-value");
const crosshairElement = requireHtmlElement("crosshair");
const blueScoreElement = requireHtmlElement("blue-score");
const redScoreElement = requireHtmlElement("red-score");
const combatFeedbackElement = requireHtmlElement("combat-feedback");
const matchStateElement = requireHtmlElement("match-state");
const respawnStatusElement = requireHtmlElement("respawn-status");
const matchTimerElement = requireTimeElement("match-timer");

function showCompatibilityFailure(message: string): void {
  canvas.hidden = true;
  statusPanel.classList.add("status-panel--error");
  statusMessage.textContent = message;
}

function createScene(engine: Engine): Scene {
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  scene.clearColor = new Color4(0.055, 0.1, 0.22, 1);

  const skyLight = new HemisphericLight(
    "sky-light",
    new Vector3(0, 1, 0),
    scene
  );
  skyLight.intensity = 0.85;

  const sun = new DirectionalLight("sun", new Vector3(-0.6, -1, 0.4), scene);
  sun.intensity = 1.2;

  const map = createBlocktown(scene);

  const player = MeshBuilder.CreateCapsule(
    "player-preview",
    { height: 2.4, radius: 0.55 },
    scene
  );
  player.position.copyFrom(map.blueSpawnPositions[0]);
  player.position.y = 1.2;
  const playerMaterial = new StandardMaterial("player-material", scene);
  playerMaterial.diffuseColor = Color3.FromHexString("#57c7ff");
  player.material = playerMaterial;

  const target = MeshBuilder.CreateCapsule(
    "target-dummy",
    { height: 2.4, radius: 0.55 },
    scene
  );
  target.position.copyFrom(map.redSpawnPositions[0]);
  target.position.y = 1.2;
  const targetMaterial = new StandardMaterial("target-material", scene);
  targetMaterial.diffuseColor = Color3.FromHexString("#ff557c");
  target.material = targetMaterial;
  const combatController = new OfflineCombatController(
    target,
    {
      blueScore: blueScoreElement,
      feedback: combatFeedbackElement,
      matchState: matchStateElement,
      redScore: redScoreElement,
      respawn: respawnStatusElement,
      timer: matchTimerElement
    },
    performance.now()
  );

  const camera = createThirdPersonCamera(scene, canvas, player);
  const hitscanResolver = new LocalHitscanResolver(
    scene,
    map.collisionMeshes,
    new Map([[target, "target-dummy"]])
  );
  const playerController = new LocalPlayerController(
    scene,
    player,
    camera,
    map.playAreaMinimum,
    map.playAreaMaximum
  );
  const movementJoystick = new VirtualJoystick(movementJoystickElement, {
    deadZone: DEFAULT_GAME_CONFIG.movement.inputDeadZone,
    onInput: (x, y) => {
      playerController.setMoveInput(x, y);
    }
  });
  const pistolController = new PistolController(scene, player, camera, {
    onAmmoChanged: (ammo, magazineSize) => {
      ammoValueElement.textContent = String(ammo);
      ammoValueElement.parentElement?.setAttribute(
        "aria-label",
        `Ammunition ${String(ammo)} of ${String(magazineSize)}`
      );
    },
    onShot: (origin, direction) => {
      const result = hitscanResolver.resolve(origin, direction);
      crosshairElement.dataset.lastShotResult = result.kind;
      if (result.kind === "target") {
        combatController.registerTargetHit(performance.now());
      }
    }
  });
  const aimController = new AimController(scene, camera, {
    onFireIntentChanged: (isFiring) => {
      aimJoystickElement.dataset.firing = String(isFiring);
      pistolController.setTriggerHeld(isFiring);
    }
  });
  const aimJoystick = new VirtualJoystick(aimJoystickElement, {
    deadZone: DEFAULT_GAME_CONFIG.movement.inputDeadZone,
    onInput: (x, y) => {
      aimController.setAimInput(x, y);
    }
  });
  const performanceMonitor = new PerformanceMonitor(
    engine,
    scene,
    performanceStatsElement,
    new URLSearchParams(window.location.search)
  );
  scene.onBeforeRenderObservable.add(() => {
    combatController.update(performance.now());
  });
  scene.onDisposeObservable.addOnce(() => {
    performanceMonitor.dispose();
    pistolController.dispose();
    aimJoystick.dispose();
    aimController.dispose(scene);
    movementJoystick.dispose();
    playerController.dispose(scene);
  });

  return scene;
}

function start(): void {
  if (!Engine.isSupported()) {
    showCompatibilityFailure(
      "This device does not provide the WebGL support required to play."
    );
    return;
  }

  const engine = new Engine(canvas, true, {
    adaptToDeviceRatio: true,
    antialias: true,
    audioEngine: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
    stencil: false
  });
  const scene = createScene(engine);

  statusMessage.textContent = "Foundation build ready";
  statusPanel.classList.add("status-panel--ready");

  engine.runRenderLoop(() => {
    scene.render();
  });

  window.addEventListener("resize", () => {
    engine.resize();
  });
}

registerSW({
  onNeedRefresh() {
    statusMessage.textContent =
      "A new version is ready. Reload outside an active match.";
    statusPanel.classList.remove("status-panel--ready");
  },
  onOfflineReady() {
    statusPanel.dataset.offlineReady = "true";
  }
});

start();
