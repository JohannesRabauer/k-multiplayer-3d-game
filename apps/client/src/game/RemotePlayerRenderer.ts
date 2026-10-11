import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import {
  DEFAULT_CAR,
  DEFAULT_SKIN,
  type CarDesign,
  type PlayerSnapshot,
  type RoomMember,
  type Skin,
  type Team
} from "@scooter-shooter/protocol";

import { carCircles, type CircleObstacle } from "@scooter-shooter/simulation";

import { buildCar } from "./CarBuilder";
import { CAR_GROUND_OFFSET } from "./CarLot";
import { buildCharacter } from "./CharacterBuilder";

interface SnapshotSample {
  /** Server clock time of the snapshot, so jitter on the wire does not matter. */
  readonly serverTimeMs: number;
  readonly position: Vector3;
  readonly yaw: number;
  readonly vehicleYaw: number;
}

/** A player's car as shown to everyone else. */
interface RemoteCar {
  node: TransformNode;
  design: CarDesign;
  x: number;
  z: number;
  yaw: number;
  driving: boolean;
}

interface RemotePlayer {
  readonly playerId: string;
  readonly mesh: Mesh;
  readonly team: Team;
  readonly healthFill: Mesh;
  character: TransformNode | undefined;
  readonly label: Mesh;
  samples: SnapshotSample[];
  isAlive: boolean;
  health: number;
  skin: Skin;
}

/**
 * Snapshots arrive at the server tick rate, which is far below the render
 * rate. Remote avatars are therefore drawn slightly in the past and
 * interpolated between the two samples that straddle that render time, which
 * trades a little latency for motion that does not stutter.
 */
const INTERPOLATION_DELAY_MS = 110;
/** A jump larger than this between snapshots is a respawn, not a sprint. */
const TELEPORT_DISTANCE = 4;
const HEALTH_BAR_WIDTH = 1.1;
const MAX_HEALTH = 100;
const MAX_SAMPLES = 24;

export class RemotePlayerRenderer {
  readonly #scene: Scene;
  readonly #players = new Map<string, RemotePlayer>();
  readonly #skins = new Map<string, Skin>();
  readonly #carDesigns = new Map<string, CarDesign>();
  readonly #cars = new Map<string, RemoteCar>();
  readonly #names = new Map<string, string>();
  readonly #blueMaterial: StandardMaterial;
  readonly #redMaterial: StandardMaterial;
  readonly #healthBackMaterial: StandardMaterial;
  readonly #healthFillMaterial: StandardMaterial;
  #localPlayerId: string | undefined;
  /** Local clock minus server clock, tracked as a jitter-resistant minimum. */
  #clockOffsetMs: number | undefined;

  constructor(scene: Scene) {
    this.#scene = scene;

    this.#blueMaterial = unlitMaterial("remote-blue", "#57c7ff", scene);
    this.#redMaterial = unlitMaterial("remote-red", "#ff557c", scene);
    this.#healthBackMaterial = unlitMaterial(
      "remote-hp-back",
      "#14141c",
      scene
    );
    this.#healthFillMaterial = unlitMaterial(
      "remote-hp-fill",
      "#5be37d",
      scene
    );
  }

  setLocalPlayerId(playerId: string): void {
    if (this.#localPlayerId === playerId) {
      return;
    }
    this.#localPlayerId = playerId;
    this.remove(playerId);
  }

  get count(): number {
    return this.#players.size;
  }

  /** Learns who is in the room so skins and names are known before spawning. */
  registerMember(member: RoomMember): void {
    this.#names.set(member.playerId, member.displayName);
    if (member.skin !== undefined) {
      this.setSkin(member.playerId, member.skin);
    }
    if (member.car !== undefined) {
      this.setCar(member.playerId, member.car);
    }
  }

  /** Applies a car design immediately if the car exists, otherwise on spawn. */
  setCar(playerId: string, design: CarDesign): void {
    this.#carDesigns.set(playerId, design);
    const car = this.#cars.get(playerId);
    if (car === undefined) {
      return;
    }
    car.design = design;
    car.node.dispose(false, false);
    car.node = this.#buildRemoteCar(playerId, design);
    this.#placeCar(car);
  }

  /** Circles of every remote car that is standing still, for collisions. */
  getParkedCircles(): CircleObstacle[] {
    const circles: CircleObstacle[] = [];
    for (const car of this.#cars.values()) {
      if (!car.driving) {
        circles.push(...carCircles(car.x, car.z, car.yaw));
      }
    }
    return circles;
  }

  #buildRemoteCar(playerId: string, design: CarDesign): TransformNode {
    return buildCar(this.#scene, design, `remote-${playerId}-car`);
  }

  #placeCar(car: RemoteCar): void {
    car.node.position.set(car.x, CAR_GROUND_OFFSET, car.z);
    car.node.rotation.y = car.yaw;
  }

  /** Applies a skin immediately if the avatar exists, otherwise on spawn. */
  setSkin(playerId: string, skin: Skin): void {
    this.#skins.set(playerId, skin);
    const remote = this.#players.get(playerId);
    if (remote === undefined) {
      return;
    }
    remote.skin = skin;
    remote.character?.dispose(false, true);
    remote.character = buildCharacter(
      this.#scene,
      remote.mesh,
      skin,
      `remote-${playerId}-model`
    );
  }

  /** Feeds one authoritative snapshot in, spawning avatars as players appear. */
  applySnapshot(
    players: readonly PlayerSnapshot[],
    serverTimeMs: number,
    nowMs: number
  ): void {
    const candidate = nowMs - serverTimeMs;
    if (this.#clockOffsetMs === undefined || candidate < this.#clockOffsetMs) {
      this.#clockOffsetMs = candidate;
    } else {
      this.#clockOffsetMs += (candidate - this.#clockOffsetMs) * 0.05;
    }

    const seen = new Set<string>();

    for (const snapshot of players) {
      if (snapshot.playerId === this.#localPlayerId) {
        continue;
      }
      seen.add(snapshot.playerId);

      let remote = this.#players.get(snapshot.playerId);
      if (remote === undefined) {
        remote = this.#spawn(snapshot);
        this.#players.set(snapshot.playerId, remote);
      }

      const position = new Vector3(
        snapshot.position.x,
        snapshot.position.y + 1.2,
        snapshot.position.z
      );
      const previous = remote.samples[remote.samples.length - 1];
      if (
        (!remote.isAlive && snapshot.isAlive) ||
        (previous !== undefined &&
          Vector3.Distance(previous.position, position) > TELEPORT_DISTANCE)
      ) {
        // A respawn must appear at the new spot, not slide across the map.
        remote.samples.length = 0;
      }

      this.#applyVehicle(remote, snapshot);
      remote.isAlive = snapshot.isAlive;
      remote.mesh.setEnabled(snapshot.isAlive);
      this.#setHealth(remote, snapshot.health);
      remote.samples.push({
        serverTimeMs,
        position,
        yaw: snapshot.yaw,
        vehicleYaw: snapshot.vehicle?.yaw ?? snapshot.yaw
      });
      if (remote.samples.length > MAX_SAMPLES) {
        remote.samples.shift();
      }
    }

    for (const [playerId, remote] of this.#players) {
      if (!seen.has(playerId)) {
        this.#disposeRemote(remote);
        this.#players.delete(playerId);
        this.#cars.get(playerId)?.node.dispose(false, false);
        this.#cars.delete(playerId);
      }
    }
  }

  remove(playerId: string): void {
    const remote = this.#players.get(playerId);
    if (remote !== undefined) {
      this.#disposeRemote(remote);
      this.#players.delete(playerId);
    }
    this.#skins.delete(playerId);
    this.#names.delete(playerId);
    const car = this.#cars.get(playerId);
    if (car !== undefined) {
      car.node.dispose(false, false);
      this.#cars.delete(playerId);
    }
    this.#carDesigns.delete(playerId);
  }

  /** Creates or moves a player's car to where the server says it is. */
  #applyVehicle(remote: RemotePlayer, snapshot: PlayerSnapshot): void {
    const vehicle = snapshot.vehicle;
    if (vehicle === undefined) {
      return;
    }
    let car = this.#cars.get(remote.playerId);
    if (car === undefined) {
      const design = this.#carDesigns.get(remote.playerId) ?? {
        ...DEFAULT_CAR
      };
      car = {
        node: this.#buildRemoteCar(remote.playerId, design),
        design,
        x: vehicle.x,
        z: vehicle.z,
        yaw: vehicle.yaw,
        driving: vehicle.driving
      };
      this.#cars.set(remote.playerId, car);
      this.#placeCar(car);
    }
    car.x = vehicle.x;
    car.z = vehicle.z;
    car.yaw = vehicle.yaw;
    car.driving = vehicle.driving;
    // The driver sits inside the car, so the walking avatar is hidden.
    remote.character?.setEnabled(!vehicle.driving);
    if (!vehicle.driving) {
      this.#placeCar(car);
    }
  }

  /** Advances every avatar to its interpolated pose for this frame. */
  update(nowMs: number): void {
    if (this.#clockOffsetMs === undefined) {
      return;
    }
    const renderTimeMs = nowMs - this.#clockOffsetMs - INTERPOLATION_DELAY_MS;

    for (const remote of this.#players.values()) {
      const samples = remote.samples;
      const newest = samples[samples.length - 1];
      if (newest === undefined) {
        continue;
      }

      if (samples.length === 1 || renderTimeMs >= newest.serverTimeMs) {
        remote.mesh.position.copyFrom(newest.position);
        remote.mesh.rotation.y = newest.yaw;
        this.#followDriver(remote, newest.vehicleYaw);
        continue;
      }

      let older = samples[0] ?? newest;
      let newer = newest;
      for (let index = 1; index < samples.length; index += 1) {
        const next = samples[index];
        const previous = samples[index - 1];
        if (next === undefined || previous === undefined) {
          continue;
        }
        if (next.serverTimeMs >= renderTimeMs) {
          newer = next;
          older = previous;
          break;
        }
      }

      const span = newer.serverTimeMs - older.serverTimeMs;
      const ratio =
        span <= 0 ? 1 : clamp((renderTimeMs - older.serverTimeMs) / span, 0, 1);

      Vector3.LerpToRef(
        older.position,
        newer.position,
        ratio,
        remote.mesh.position
      );
      remote.mesh.rotation.y = lerpAngle(older.yaw, newer.yaw, ratio);
      this.#followDriver(
        remote,
        lerpAngle(older.vehicleYaw, newer.vehicleYaw, ratio)
      );

      // Drop samples that are now fully in the past.
      while (samples.length > 2) {
        const second = samples[1];
        if (second === undefined || second.serverTimeMs >= renderTimeMs) {
          break;
        }
        samples.shift();
      }
    }
  }

  /** While a player drives, their car rides along with the smoothed avatar. */
  #followDriver(remote: RemotePlayer, vehicleYaw: number): void {
    const car = this.#cars.get(remote.playerId);
    if (!car?.driving) {
      return;
    }
    car.node.position.set(
      remote.mesh.position.x,
      CAR_GROUND_OFFSET,
      remote.mesh.position.z
    );
    car.node.rotation.y = vehicleYaw;
  }

  /** Returns an avatar's current rendered position, if it is on screen. */
  getPosition(playerId: string): Vector3 | undefined {
    return this.#players.get(playerId)?.mesh.position;
  }

  /** A plain description of every avatar, used by diagnostics and tests. */
  describe(): readonly {
    readonly playerId: string;
    readonly team: Team;
    readonly health: number;
    readonly isAlive: boolean;
    readonly skin: Skin;
    readonly car: CarDesign;
    readonly driving: boolean;
  }[] {
    return [...this.#players.values()].map((remote) => ({
      playerId: remote.playerId,
      team: remote.team,
      health: remote.health,
      isAlive: remote.isAlive,
      skin: remote.skin,
      car: this.#cars.get(remote.playerId)?.design ?? { ...DEFAULT_CAR },
      driving: this.#cars.get(remote.playerId)?.driving ?? false
    }));
  }

  /** Health of a remote player as last reported by the server. */
  getHealth(playerId: string): number | undefined {
    return this.#players.get(playerId)?.health;
  }

  dispose(): void {
    for (const remote of this.#players.values()) {
      this.#disposeRemote(remote);
    }
    this.#players.clear();
    for (const car of this.#cars.values()) {
      car.node.dispose(false, false);
    }
    this.#cars.clear();
  }

  /** Frees one avatar without touching the materials the team shares. */
  #disposeRemote(remote: RemotePlayer): void {
    remote.character?.dispose(false, true);
    remote.label.dispose(false, true);
    remote.mesh.dispose(false, false);
  }

  #setHealth(remote: RemotePlayer, health: number): void {
    remote.health = health;
    const ratio = clamp(health / MAX_HEALTH, 0, 1);
    remote.healthFill.scaling.x = Math.max(ratio, 0.001);
    remote.healthFill.position.x = (-(1 - ratio) * HEALTH_BAR_WIDTH) / 2;
  }

  #spawn(snapshot: PlayerSnapshot): RemotePlayer {
    const mesh = MeshBuilder.CreateCapsule(
      `remote-${snapshot.playerId}`,
      { height: 2.4, radius: 0.55 },
      this.#scene
    );
    mesh.position.set(
      snapshot.position.x,
      snapshot.position.y + 1.2,
      snapshot.position.z
    );
    mesh.material =
      snapshot.team === "blue" ? this.#blueMaterial : this.#redMaterial;
    mesh.visibility = 0;
    mesh.isPickable = false;
    mesh.checkCollisions = false;

    const skin = this.#skins.get(snapshot.playerId) ?? { ...DEFAULT_SKIN };
    const character = buildCharacter(
      this.#scene,
      mesh,
      skin,
      `remote-${snapshot.playerId}-model`
    );

    // A team ring under the feet keeps allies and enemies apart whatever skin
    // they wear.
    const ring = MeshBuilder.CreateTorus(
      `remote-${snapshot.playerId}-ring`,
      { diameter: 1.5, thickness: 0.09, tessellation: 24 },
      this.#scene
    );
    ring.parent = mesh;
    ring.position.y = -1.17;
    ring.material =
      snapshot.team === "blue" ? this.#blueMaterial : this.#redMaterial;
    ring.isPickable = false;

    const healthBack = MeshBuilder.CreatePlane(
      `remote-${snapshot.playerId}-hp-back`,
      { width: HEALTH_BAR_WIDTH + 0.08, height: 0.2 },
      this.#scene
    );
    healthBack.parent = mesh;
    healthBack.position.y = 1.75;
    healthBack.billboardMode = Mesh.BILLBOARDMODE_ALL;
    healthBack.material = this.#healthBackMaterial;
    healthBack.isPickable = false;

    const healthFill = MeshBuilder.CreatePlane(
      `remote-${snapshot.playerId}-hp-fill`,
      { width: HEALTH_BAR_WIDTH, height: 0.13 },
      this.#scene
    );
    healthFill.parent = healthBack;
    healthFill.position.z = -0.01;
    healthFill.material = this.#healthFillMaterial;
    healthFill.isPickable = false;

    const label = this.#createNameLabel(
      snapshot.playerId,
      this.#names.get(snapshot.playerId) ?? "Player"
    );
    label.parent = mesh;
    label.position.y = 2.05;

    const remote: RemotePlayer = {
      playerId: snapshot.playerId,
      mesh,
      team: snapshot.team,
      healthFill,
      character,
      label,
      samples: [],
      isAlive: snapshot.isAlive,
      health: snapshot.health,
      skin
    };
    this.#setHealth(remote, snapshot.health);
    return remote;
  }

  #createNameLabel(playerId: string, name: string): Mesh {
    const plane = MeshBuilder.CreatePlane(
      `remote-${playerId}-name`,
      { width: 2, height: 0.5 },
      this.#scene
    );
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;

    const texture = new DynamicTexture(
      `remote-${playerId}-name-texture`,
      { width: 256, height: 64 },
      this.#scene,
      false
    );
    texture.hasAlpha = true;
    texture.drawText(
      name.slice(0, 16),
      null,
      44,
      "bold 38px sans-serif",
      "#ffffff",
      "transparent",
      true
    );
    const material = new StandardMaterial(
      `remote-${playerId}-name-mat`,
      this.#scene
    );
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.useAlphaFromDiffuseTexture = true;
    plane.material = material;
    return plane;
  }
}

function unlitMaterial(
  name: string,
  hex: string,
  scene: Scene
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.Black();
  material.emissiveColor = Color3.FromHexString(hex);
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  return material;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Interpolates yaw the short way around the circle. */
function lerpAngle(from: number, to: number, ratio: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) {
    delta -= Math.PI * 2;
  } else if (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return from + delta * ratio;
}
