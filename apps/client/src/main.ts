import "@babylonjs/core/Engines/engine";
import "@babylonjs/core/Collisions/collisionCoordinator";
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
import {
  addCharacterModel,
  addCityModel,
  addVehicleModel,
  addVehiclePropModel
} from "./game/GameAssets";
import { LocalPlayerController } from "./game/LocalPlayerController";
import { LocalHitscanResolver } from "./game/LocalHitscanResolver";
import { OfflineCombatController } from "./game/OfflineCombatController";
import { OnlineSessionController } from "./game/OnlineSessionController";
import { PerformanceMonitor } from "./game/PerformanceMonitor";
import { PistolController } from "./game/PistolController";
import { ShotEffects } from "./game/ShotEffects";
import { createTopDownCamera } from "./game/TopDownCamera";
import { TrainingBotController } from "./game/TrainingBotController";
import { VehicleController } from "./game/VehicleController";
import { DesktopAimController } from "./input/DesktopAimController";
import { VirtualJoystick } from "./input/VirtualJoystick";
import {
  NetworkClient,
  NetworkError,
  type ConnectionStatus
} from "./net/NetworkClient";
import { resolveServerUrl } from "./net/serverUrl";
import type { ServerMessage } from "@scooter-shooter/protocol";

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

function requireInputElement(id: string): HTMLInputElement {
  const element = requireHtmlElement(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new TypeError(`#${id} must be an input element.`);
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
const vehicleActionButton = requireButtonElement("vehicle-action");
const botCountSelect = requireSelectElement("bot-count");
const hostGameButton = requireButtonElement("host-game");
const joinGameButton = requireButtonElement("join-game");
const copyInviteButton = requireButtonElement("copy-invite");
const joinCodeInput = requireInputElement("join-code");
const onlineMessage = requireOutputElement("online-message");
const roomShare = requireHtmlElement("room-share");
const roomCodeElement = requireHtmlElement("room-code");
const roomRosterElement = requireHtmlElement("room-roster");

let stopGame: (() => void) | undefined;
let isGameStarting = false;
let networkMessageSink: ((message: ServerMessage) => void) | undefined;
let activeNetwork: NetworkClient | undefined;

function showCompatibilityFailure(message: string): void {
  canvas.hidden = true;
  statusPanel.classList.add("status-panel--error");
  statusMessage.textContent = message;
}

async function createScene(
  engine: Engine,
  botCount: number,
  network?: NetworkClient
): Promise<Scene> {
  const isOnline = network !== undefined;
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
  playerMaterial.alpha = 0;
  player.material = playerMaterial;
  const playerVisual = await addCharacterModel(
    scene,
    player,
    "player",
    "player-model"
  );

  const targetMaterial = new StandardMaterial("target-material", scene);
  targetMaterial.diffuseColor = Color3.FromHexString("#ff557c");
  targetMaterial.alpha = 0;
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
    .slice(0, isOnline ? 0 : botCount)
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
      mesh.ellipsoidOffset = Vector3.Zero();
      return { id, mesh, spawnPosition: mesh.position.clone() };
    });
  await Promise.all(
    bots.map((bot) =>
      addCharacterModel(scene, bot.mesh, "bot", `${bot.id}-model`)
    )
  );
  for (const mesh of map.collisionMeshes) {
    if (mesh.name.startsWith("building-") || mesh.name.startsWith("cover-")) {
      mesh.visibility = 0;
    }
  }
  await Promise.all([
    addCityModel(
      scene,
      "building-a",
      new Vector3(-14, 3, 11),
      new Vector3(5, 3, 4),
      "city-building-north-west"
    ),
    addCityModel(
      scene,
      "building-f",
      new Vector3(14, 4, 11),
      new Vector3(5, 3.2, 4),
      "city-building-north-east"
    ),
    addCityModel(
      scene,
      "building-d",
      new Vector3(-14, 3.5, -11),
      new Vector3(5, 3.2, 4),
      "city-building-south-west"
    ),
    addCityModel(
      scene,
      "building-a",
      new Vector3(14, 2.5, -11),
      new Vector3(5, 2.5, 4),
      "city-building-south-east"
    ),
    addCityModel(
      scene,
      "parasol",
      new Vector3(2.5, 1, 2.5),
      new Vector3(1.5, 1.5, 1.5),
      "plaza-parasol"
    ),
    addVehiclePropModel(
      scene,
      "box",
      new Vector3(-8, 0.63, 3),
      new Vector3(2, 0.63, 0.5),
      "cover-crates-west-north"
    ),
    addVehiclePropModel(
      scene,
      "box",
      new Vector3(8, 0.63, -3),
      new Vector3(2, 0.63, 0.5),
      "cover-crates-east-south"
    ),
    addVehiclePropModel(
      scene,
      "cone",
      new Vector3(2, 0.55, -4),
      new Vector3(0.45, 0.55, 0.45),
      "traffic-cone-one"
    ),
    addVehiclePropModel(
      scene,
      "cone",
      new Vector3(3, 0.55, -4),
      new Vector3(0.45, 0.55, 0.45),
      "traffic-cone-two"
    )
  ]);
  const vehicleMaterial = new StandardMaterial("vehicle-collider", scene);
  vehicleMaterial.alpha = 0;
  const vehicleDefinitions = [
    {
      id: "vehicle-sedan",
      model: "sedan" as const,
      position: new Vector3(-15.5, 0.65, -3)
    },
    {
      id: "vehicle-hatchback",
      model: "hatchback-sports" as const,
      position: new Vector3(10, 0.65, 3)
    }
  ];
  const vehicles = vehicleDefinitions.map((definition) => {
    const mesh = MeshBuilder.CreateBox(
      definition.id,
      { width: 2.2, height: 1.3, depth: 3.2 },
      scene
    );
    mesh.position.copyFrom(definition.position);
    mesh.material = vehicleMaterial;
    mesh.checkCollisions = true;
    mesh.ellipsoid = new Vector3(1.1, 0.65, 1.6);
    return { id: definition.id, mesh, model: definition.model };
  });
  await Promise.all(
    vehicles.map((vehicle) =>
      addVehicleModel(scene, vehicle.mesh, vehicle.model, `${vehicle.id}-model`)
    )
  );
  const lastMoveInput = { x: 0, z: 0 };
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

  const camera = createTopDownCamera(scene, player);
  gameShell.dataset.cameraMode = "top-down";
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
  const vehicleController = new VehicleController(
    scene,
    vehicles,
    playerController,
    playerVisual,
    vehicleActionButton
  );
  const movementJoystick = new VirtualJoystick(movementJoystickElement, {
    deadZone: DEFAULT_GAME_CONFIG.movement.inputDeadZone,
    onInput: (x, y) => {
      lastMoveInput.x = x;
      lastMoveInput.z = y;
      playerController.setMoveInput(
        combatController.isPlayerAlive() ? x : 0,
        combatController.isPlayerAlive() ? y : 0
      );
    }
  });
  const pistolControllerReference: { current?: PistolController } = {};
  const aimController = new AimController(camera, player, {
    onFireIntentChanged: (isFiring) => {
      const canFire = isFiring && combatController.isPlayerAlive();
      aimJoystickElement.dataset.firing = String(canFire);
      pistolControllerReference.current?.setTriggerHeld(canFire);
    }
  });
  const pistolController = new PistolController(scene, player, {
    getAimDirection: () => aimController.getAimDirection(),
    onAmmoChanged: (ammo, magazineSize) => {
      ammoValueElement.textContent = String(ammo);
      ammoValueElement.parentElement?.setAttribute(
        "aria-label",
        `Ammunition ${String(ammo)} of ${String(magazineSize)}`
      );
    },
    onShot: (origin, direction) => {
      if (network !== undefined) {
        network.sendFire(
          network.takeInputSequence(),
          { x: origin.x, y: origin.y, z: origin.z },
          { x: direction.x, y: direction.y, z: direction.z }
        );
        crosshairElement.dataset.lastShotResult = "sent";
        return;
      }
      const result = hitscanResolver.resolve(origin, direction);
      crosshairElement.dataset.lastShotResult = result.kind;
      if (result.kind === "target") {
        combatController.registerTargetHit(result.targetId, performance.now());
      }
    }
  });
  pistolControllerReference.current = pistolController;
  const desktopAimController = new DesktopAimController(
    scene,
    canvas,
    camera,
    player,
    aimController
  );
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
    {
      canEngage: (nowMs) => combatController.isRoundLive(nowMs),
      onAttack: (botId, nowMs, damage) => {
        combatController.registerBotHit(botId, nowMs, damage);
      }
    }
  );
  const onlineSession =
    network === undefined
      ? undefined
      : new OnlineSessionController(
          scene,
          network,
          player,
          new ShotEffects(scene, "#ffd657", "online"),
          {
            blueScore: blueScoreElement,
            feedback: combatFeedbackElement,
            health: healthValueElement,
            matchState: matchStateElement,
            redScore: redScoreElement,
            respawn: respawnStatusElement,
            timer: matchTimerElement
          },
          {
            getMovement: () => playerController.getWorldMoveDirection(),
            getAimYaw: () => {
              const aim = aimController.getAimDirection();
              return Math.atan2(aim.x, aim.z);
            }
          }
        );
  if (onlineSession !== undefined && network !== undefined) {
    networkMessageSink = (message) => {
      onlineSession.handleMessage(message);
    };
  }

  scene.onBeforeRenderObservable.add(() => {
    const nowMs = performance.now();
    if (onlineSession !== undefined) {
      onlineSession.update(nowMs);
      gameShell.dataset.onlineRemotePlayers = String(
        onlineSession.remotePlayerCount
      );
      gameShell.dataset.onlineSnapshots = String(
        onlineSession.snapshotsApplied
      );
      gameShell.dataset.onlinePhase = onlineSession.phase;
    } else {
      combatController.update(nowMs);
    }
    gameShell.dataset.playerPosition = `${player.position.x.toFixed(2)},${player.position.z.toFixed(2)}`;
    gameShell.dataset.botPositions = bots
      .map(
        (bot) =>
          `${bot.mesh.position.x.toFixed(2)},${bot.mesh.position.y.toFixed(2)},${bot.mesh.position.z.toFixed(2)}`
      )
      .join(";");
    const aimDirection = aimController.getAimDirection();
    gameShell.dataset.aimDirection = `${aimDirection.x.toFixed(2)},${aimDirection.z.toFixed(2)}`;
    gameShell.dataset.botShotEffects = String(
      botController.getActiveShotEffectCount()
    );
    gameShell.dataset.botShotEffectsRendered = String(
      botController.getRenderedShotEffectCount()
    );
    const accuracy = botController.getAccuracyTelemetry();
    gameShell.dataset.botShotsFired = String(accuracy.fired);
    gameShell.dataset.botShotsHit = String(accuracy.hit);
    gameShell.dataset.roundLive = String(combatController.isRoundLive(nowMs));
    const alive =
      onlineSession === undefined
        ? combatController.isPlayerAlive()
        : onlineSession.isPlayerAlive;
    if (!alive) {
      vehicleController.exitVehicle();
      playerController.setMoveInput(0, 0);
      pistolController.setTriggerHeld(false);
    }
  });
  scene.onDisposeObservable.addOnce(() => {
    onlineSession?.dispose();
    performanceMonitor.dispose();
    botController.dispose();
    vehicleController.dispose(scene);
    desktopAimController.dispose();
    pistolController.dispose();
    aimJoystick.dispose();
    aimController.dispose();
    movementJoystick.dispose();
    playerController.dispose(scene);
  });

  return scene;
}

async function startGame(network?: NetworkClient): Promise<void> {
  if (stopGame !== undefined || isGameStarting) {
    return;
  }
  isGameStarting = true;
  if (!Engine.isSupported()) {
    entryScreen.hidden = true;
    gameShell.hidden = false;
    showCompatibilityFailure(
      "This device does not provide the WebGL support required to play."
    );
    isGameStarting = false;
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
  gameShell.dataset.mode = network === undefined ? "offline" : "online";
  const engine = new Engine(canvas, true, {
    adaptToDeviceRatio: true,
    antialias: true,
    audioEngine: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
    stencil: false
  });
  statusMessage.textContent = "Loading characters, city, and vehicles…";
  let scene: Scene;
  try {
    scene = await createScene(engine, botCount, network);
  } catch (error: unknown) {
    engine.dispose();
    showCompatibilityFailure(
      error instanceof Error
        ? `Game assets could not load: ${error.message}`
        : "Game assets could not load."
    );
    isGameStarting = false;
    return;
  }

  statusMessage.textContent =
    network === undefined
      ? `${String(botCount)} training ${botCount === 1 ? "bot" : "bots"} ready`
      : `Online match ready — code ${network.match?.roomCode ?? ""}`;
  statusPanel.classList.add("status-panel--ready");
  isGameStarting = false;

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
    networkMessageSink = undefined;
    network?.disconnect();
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

function describeConnectionStatus(status: ConnectionStatus): string {
  switch (status) {
    case "connecting":
      return "Contacting the game server…";
    case "authenticating":
      return "Signing in to the match…";
    case "joining":
      return "Joining the match…";
    case "connected":
      return "Connected.";
    case "reconnecting":
      return "Connection lost. Reconnecting…";
    case "failed":
      return "Disconnected from the match.";
    default:
      return "";
  }
}

/**
 * Builds an unsigned JWT for builds that have no Firebase config (local
 * previews and end-to-end tests). A server only accepts these when it runs
 * with `ALLOW_UNVERIFIED_TOKENS=true`, so it is never a production bypass.
 */
function createDevToken(): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const encode = (value: unknown): string =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  const payload = {
    sub: `dev-${suffix}`,
    name: `Dev ${suffix.toUpperCase()}`,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
    firebase: { sign_in_provider: "anonymous" }
  };
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.dev`;
}

/**
 * Wires the host and join buttons. A room code is the whole invite mechanism:
 * the host opens a room, reads out six characters, and the other player types
 * them in. The shareable link carries the code so it can also just be sent.
 */
function registerOnlineHandlers(
  authController: FirebaseAuthController | null
): void {
  const serverUrl = resolveServerUrl(import.meta.env, window.location.search);

  if (serverUrl === undefined) {
    hostGameButton.disabled = true;
    joinGameButton.disabled = true;
    joinCodeInput.disabled = true;
    onlineMessage.textContent =
      "Online play is not configured for this build. Training still works.";
    return;
  }

  const createNetwork = (): NetworkClient =>
    new NetworkClient({
      serverUrl,
      clientBuild: "web",
      getAuthToken: () =>
        authController === null
          ? Promise.resolve(createDevToken())
          : authController.getIdToken(),
      onStatusChange: (status) => {
        onlineMessage.textContent = describeConnectionStatus(status);
      },
      onMessage: (message) => {
        if (message.type === "playerJoined") {
          roomRosterElement.textContent = `${message.member.displayName} joined.`;
        }
        networkMessageSink?.(message);
      }
    });

  const setOnlineBusy = (busy: boolean): void => {
    hostGameButton.disabled = busy;
    joinGameButton.disabled = busy;
    joinCodeInput.disabled = busy;
  };

  const enterOnlineMatch = async (
    action: (network: NetworkClient) => Promise<unknown>
  ): Promise<void> => {
    setOnlineBusy(true);
    try {
      const network = createNetwork();
      activeNetwork = network;
      await action(network);

      const match = network.match;
      if (match !== undefined) {
        roomShare.hidden = false;
        roomCodeElement.textContent = match.roomCode;
        roomRosterElement.textContent =
          match.members.length > 1
            ? `${String(match.members.length)} players in this game.`
            : "Waiting for another player…";
      }
      await startGame(network);
    } catch (error: unknown) {
      activeNetwork?.disconnect();
      activeNetwork = undefined;
      onlineMessage.textContent =
        error instanceof NetworkError
          ? error.message
          : "Could not reach the game server.";
    } finally {
      setOnlineBusy(false);
    }
  };

  hostGameButton.addEventListener("click", () => {
    void enterOnlineMatch(async (network) => network.createRoom());
  });

  joinGameButton.addEventListener("click", () => {
    const code = joinCodeInput.value;
    void enterOnlineMatch(async (network) => network.joinRoom(code));
  });

  copyInviteButton.addEventListener("click", () => {
    const code = roomCodeElement.textContent;
    const link = new URL(window.location.href);
    link.searchParams.set("join", code);
    void navigator.clipboard
      .writeText(link.toString())
      .then(() => {
        onlineMessage.textContent = "Invite link copied.";
      })
      .catch(() => {
        onlineMessage.textContent = link.toString();
      });
  });

  // An invite link prefills the code so the guest only has to press Join.
  const invited = new URLSearchParams(window.location.search).get("join");
  if (invited !== null && invited.length > 0) {
    joinCodeInput.value = invited.toUpperCase();
    onlineMessage.textContent =
      "Sign in, then press Join to accept the invite.";
  }

  if (authController === null) {
    // Without Firebase there is no sign-in step, so the online menu would stay
    // hidden. Reveal just the match controls so a dev or preview build can
    // still reach a server supplied via `?server=`.
    signedInMenu.hidden = false;
    playerIdentity.textContent = "Local dev player";
    identityKind.textContent = "unverified";
    linkGoogleButton.hidden = true;
    signOutButton.hidden = true;
  }
}

async function initializeEntryFlow(): Promise<void> {
  openTrainingButton.addEventListener("click", () => {
    void startGame();
  });
  offlineTrainingButton.addEventListener("click", () => {
    void startGame();
  });
  leaveTrainingButton.addEventListener("click", () => {
    stopGame?.();
  });

  const firebaseOptions = readFirebaseOptions(import.meta.env);
  const authController =
    firebaseOptions === null
      ? null
      : new FirebaseAuthController(firebaseOptions);
  registerOnlineHandlers(authController);
  if (authController === null) {
    signedOutActions.hidden = true;
    authMessage.textContent =
      "Firebase sign-in is unavailable in this local build. Offline training is still available.";
    return;
  }
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
