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

import {
  FirebaseAuthController,
  getAuthErrorMessage,
  isAccountConflict,
  readFirebaseOptions,
  type AuthSession
} from "./auth/FirebaseAuthController";
import { AimController } from "./game/AimController";
import { createBlocktown } from "./game/createBlocktown";
import { LocalPlayerController } from "./game/LocalPlayerController";
import { LocalHitscanResolver } from "./game/LocalHitscanResolver";
import { OfflineCombatController } from "./game/OfflineCombatController";
import { PerformanceMonitor } from "./game/PerformanceMonitor";
import { PistolController } from "./game/PistolController";
import { createThirdPersonCamera } from "./game/ThirdPersonCamera";
import { TrainingBotController } from "./game/TrainingBotController";
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

function requireButtonElement(id: string): HTMLButtonElement {
  const element = requireHtmlElement(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new TypeError(`#${id} must be a button element.`);
  }
  return element;
}

function requireSelectElement(id: string): HTMLSelectElement {
  const element = requireHtmlElement(id);
  if (!(element instanceof HTMLSelectElement)) {
    throw new TypeError(`#${id} must be a select element.`);
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
const healthValueElement = requireHtmlElement("health-value");
const crosshairElement = requireHtmlElement("crosshair");
const blueScoreElement = requireHtmlElement("blue-score");
const redScoreElement = requireHtmlElement("red-score");
const combatFeedbackElement = requireHtmlElement("combat-feedback");
const matchStateElement = requireHtmlElement("match-state");
const respawnStatusElement = requireHtmlElement("respawn-status");
const matchTimerElement = requireTimeElement("match-timer");
const entryScreen = requireHtmlElement("entry-screen");
const gameShell = requireHtmlElement("game-shell");
const signedOutActions = requireHtmlElement("signed-out-actions");
const signedInMenu = requireHtmlElement("signed-in-menu");
const playerIdentity = requireHtmlElement("player-identity");
const identityKind = requireHtmlElement("identity-kind");
const accountConflict = requireHtmlElement("account-conflict");
const authMessage = requireOutputElement("auth-message");
const guestSignInButton = requireButtonElement("guest-sign-in");
const googleSignInButton = requireButtonElement("google-sign-in");
const linkGoogleButton = requireButtonElement("link-google");
const confirmAccountSwitchButton = requireButtonElement(
  "confirm-account-switch"
);
const signOutButton = requireButtonElement("sign-out");
const openTrainingButton = requireButtonElement("open-training");
const offlineTrainingButton = requireButtonElement("offline-training");
const leaveTrainingButton = requireButtonElement("leave-training");
const botCountSelect = requireSelectElement("bot-count");

let stopGame: (() => void) | undefined;

function showCompatibilityFailure(message: string): void {
  canvas.hidden = true;
  statusPanel.classList.add("status-panel--error");
  statusMessage.textContent = message;
}

function createScene(engine: Engine, botCount: number): Scene {
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

  const targetMaterial = new StandardMaterial("target-material", scene);
  targetMaterial.diffuseColor = Color3.FromHexString("#ff557c");
  const botSpawnPositions = [
    new Vector3(11, 0.1, 0),
    map.redSpawnPositions[0],
    map.redSpawnPositions[1],
    new Vector3(15, 0.1, 0),
    new Vector3(4, 0.1, -7),
    new Vector3(4, 0.1, 7),
    new Vector3(-4, 0.1, -7),
    new Vector3(-4, 0.1, 7)
  ];
  const bots = botSpawnPositions
    .slice(0, botCount)
    .map((spawnPosition, index) => {
      const id = `training-bot-${String(index + 1)}`;
      const mesh = MeshBuilder.CreateCapsule(
        id,
        { height: 2.4, radius: 0.55 },
        scene
      );
      mesh.position.copyFrom(spawnPosition);
      mesh.position.y = 1.2;
      mesh.material = targetMaterial;
      mesh.checkCollisions = true;
      mesh.ellipsoid = new Vector3(0.55, 1.2, 0.55);
      return { id, mesh, spawnPosition: mesh.position.clone() };
    });
  const combatController = new OfflineCombatController(
    player,
    player.position,
    bots.map((bot) => ({
      ...bot,
      spawnPosition: bot.spawnPosition
    })),
    {
      blueScore: blueScoreElement,
      feedback: combatFeedbackElement,
      health: healthValueElement,
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
    new Map(bots.map((bot) => [bot.mesh, bot.id] as const))
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
      playerController.setMoveInput(
        combatController.isPlayerAlive() ? x : 0,
        combatController.isPlayerAlive() ? y : 0
      );
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
        combatController.registerTargetHit(result.targetId, performance.now());
      }
    }
  });
  const aimController = new AimController(scene, camera, {
    onFireIntentChanged: (isFiring) => {
      const canFire = isFiring && combatController.isPlayerAlive();
      aimJoystickElement.dataset.firing = String(canFire);
      pistolController.setTriggerHeld(canFire);
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
  const botController = new TrainingBotController(
    scene,
    bots,
    player,
    map.playAreaMinimum,
    map.playAreaMaximum,
    map.collisionMeshes,
    (botId, nowMs) => {
      combatController.registerBotHit(botId, nowMs);
    }
  );
  scene.onBeforeRenderObservable.add(() => {
    combatController.update(performance.now());
    if (!combatController.isPlayerAlive()) {
      playerController.setMoveInput(0, 0);
      pistolController.setTriggerHeld(false);
    }
  });
  scene.onDisposeObservable.addOnce(() => {
    performanceMonitor.dispose();
    botController.dispose();
    pistolController.dispose();
    aimJoystick.dispose();
    aimController.dispose(scene);
    movementJoystick.dispose();
    playerController.dispose(scene);
  });

  return scene;
}

function startGame(): void {
  if (stopGame !== undefined) {
    return;
  }
  if (!Engine.isSupported()) {
    entryScreen.hidden = true;
    gameShell.hidden = false;
    showCompatibilityFailure(
      "This device does not provide the WebGL support required to play."
    );
    return;
  }

  entryScreen.hidden = true;
  gameShell.hidden = false;
  const selectedBotCount = Number.parseInt(botCountSelect.value, 10);
  const botCount =
    Number.isInteger(selectedBotCount) &&
    selectedBotCount >= 1 &&
    selectedBotCount <= 8
      ? selectedBotCount
      : 3;
  gameShell.dataset.botCount = String(botCount);
  const engine = new Engine(canvas, true, {
    adaptToDeviceRatio: true,
    antialias: true,
    audioEngine: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
    stencil: false
  });
  const scene = createScene(engine, botCount);

  statusMessage.textContent = `${String(botCount)} training ${botCount === 1 ? "bot" : "bots"} ready`;
  statusPanel.classList.add("status-panel--ready");

  engine.runRenderLoop(() => {
    scene.render();
  });

  const resizeEngine = (): void => {
    engine.resize();
  };
  window.addEventListener("resize", resizeEngine);
  stopGame = () => {
    window.removeEventListener("resize", resizeEngine);
    engine.stopRenderLoop();
    engine.dispose();
    gameShell.hidden = true;
    entryScreen.hidden = false;
    stopGame = undefined;
  };
}

function renderSession(session: AuthSession | null): void {
  accountConflict.hidden = true;
  signedOutActions.hidden = session !== null;
  signedInMenu.hidden = session === null;
  if (session === null) {
    authMessage.textContent = "Choose how to continue.";
    return;
  }

  playerIdentity.textContent = session.displayName;
  identityKind.textContent = session.isAnonymous
    ? "Guest profile"
    : "Google account";
  linkGoogleButton.hidden = !session.isAnonymous;
  authMessage.textContent = session.isAnonymous
    ? "Guest progress stays on this device until you link Google."
    : "Your player identity is ready.";
}

function setAuthBusy(busy: boolean): void {
  for (const button of [
    guestSignInButton,
    googleSignInButton,
    linkGoogleButton,
    confirmAccountSwitchButton,
    signOutButton
  ]) {
    button.disabled = busy;
  }
}

async function initializeEntryFlow(): Promise<void> {
  openTrainingButton.addEventListener("click", startGame);
  offlineTrainingButton.addEventListener("click", startGame);
  leaveTrainingButton.addEventListener("click", () => {
    stopGame?.();
  });

  const firebaseOptions = readFirebaseOptions(import.meta.env);
  if (firebaseOptions === null) {
    signedOutActions.hidden = true;
    authMessage.textContent =
      "Firebase sign-in is unavailable in this local build. Offline training is still available.";
    return;
  }

  const authController = new FirebaseAuthController(firebaseOptions);
  try {
    await authController.initialize(renderSession);
  } catch (error: unknown) {
    signedOutActions.hidden = true;
    authMessage.textContent = getAuthErrorMessage(error);
    return;
  }

  const runAuthAction = async (
    action: () => Promise<void>,
    pendingMessage: string
  ): Promise<void> => {
    setAuthBusy(true);
    accountConflict.hidden = true;
    authMessage.textContent = pendingMessage;
    try {
      await action();
    } catch (error: unknown) {
      accountConflict.hidden = !isAccountConflict(error);
      authMessage.textContent = getAuthErrorMessage(error);
    } finally {
      setAuthBusy(false);
    }
  };

  guestSignInButton.addEventListener("click", () => {
    void runAuthAction(
      () => authController.continueAsGuest(),
      "Creating guest profile…"
    );
  });
  googleSignInButton.addEventListener("click", () => {
    void runAuthAction(
      () => authController.continueWithGoogle(),
      "Opening Google sign-in…"
    );
  });
  linkGoogleButton.addEventListener("click", () => {
    void runAuthAction(
      () => authController.continueWithGoogle(),
      "Linking Google without replacing guest progress…"
    );
  });
  confirmAccountSwitchButton.addEventListener("click", () => {
    void runAuthAction(
      () => authController.switchToExistingGoogleAccount(),
      "Switching to the existing Google profile…"
    );
  });
  signOutButton.addEventListener("click", () => {
    void runAuthAction(() => authController.signOut(), "Signing out…");
  });
}

registerSW({
  onNeedRefresh() {
    const message = "A new version is ready. Reload outside an active match.";
    if (stopGame === undefined) {
      authMessage.textContent = message;
    } else {
      statusMessage.textContent = message;
      statusPanel.classList.remove("status-panel--ready");
    }
  },
  onOfflineReady() {
    statusPanel.dataset.offlineReady = "true";
  }
});

void initializeEntryFlow();
