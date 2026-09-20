/**
 * The authoritative arena description.
 *
 * The client renders Blocktown with Babylon meshes and resolves its own
 * collisions, but the server cannot load a 3D scene. Both sides therefore
 * agree on this simplified axis-aligned model: it is the single source of
 * truth for spawns, walkable bounds, and what blocks a bullet.
 */

export interface ArenaObstacle {
  readonly name: string;
  readonly centerX: number;
  readonly centerZ: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  /** Obstacles shorter than eye height block movement but not shots. */
  readonly height: number;
}

export interface ArenaSpawn {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** Half-extents of the walkable floor, inside the boundary walls. */
export const ARENA_HALF_WIDTH = 23.25;
export const ARENA_HALF_DEPTH = 17.25;

/** Radius of a player capsule, used for collision push-out. */
export const PLAYER_RADIUS = 0.55;

/** Height a shot travels at, measured from the floor. */
export const SHOT_HEIGHT = 1.35;

export const ARENA_OBSTACLES: readonly ArenaObstacle[] = [
  {
    name: "building-north-west",
    centerX: -14,
    centerZ: 11,
    halfWidth: 5,
    halfDepth: 4,
    height: 6
  },
  {
    name: "building-north-east",
    centerX: 14,
    centerZ: 11,
    halfWidth: 5,
    halfDepth: 4,
    height: 8
  },
  {
    name: "building-south-west",
    centerX: -14,
    centerZ: -11,
    halfWidth: 5,
    halfDepth: 4,
    height: 7
  },
  {
    name: "building-south-east",
    centerX: 14,
    centerZ: -11,
    halfWidth: 5,
    halfDepth: 4,
    height: 5
  },
  {
    name: "cover-west-north",
    centerX: -8,
    centerZ: 3,
    halfWidth: 2,
    halfDepth: 0.5,
    height: 1.25
  },
  {
    name: "cover-west-south",
    centerX: -8,
    centerZ: -3,
    halfWidth: 2,
    halfDepth: 0.5,
    height: 1.25
  },
  {
    name: "cover-east-north",
    centerX: 8,
    centerZ: 3,
    halfWidth: 2,
    halfDepth: 0.5,
    height: 1.25
  },
  {
    name: "cover-east-south",
    centerX: 8,
    centerZ: -3,
    halfWidth: 2,
    halfDepth: 0.5,
    height: 1.25
  },
  {
    name: "plaza-cover-north",
    centerX: 0,
    centerZ: 4.5,
    halfWidth: 0.6,
    halfDepth: 1.5,
    height: 1
  },
  {
    name: "plaza-cover-south",
    centerX: 0,
    centerZ: -4.5,
    halfWidth: 0.6,
    halfDepth: 1.5,
    height: 1
  }
];

export const BLUE_SPAWNS: readonly ArenaSpawn[] = [
  { x: -19, z: -3, yaw: Math.PI / 2 },
  { x: -19, z: 3, yaw: Math.PI / 2 },
  { x: -19, z: -9, yaw: Math.PI / 2 },
  { x: -19, z: 9, yaw: Math.PI / 2 }
];

export const RED_SPAWNS: readonly ArenaSpawn[] = [
  { x: 19, z: -3, yaw: -Math.PI / 2 },
  { x: 19, z: 3, yaw: -Math.PI / 2 },
  { x: 19, z: -9, yaw: -Math.PI / 2 },
  { x: 19, z: 9, yaw: -Math.PI / 2 }
];

export function getSpawn(team: "blue" | "red", index: number): ArenaSpawn {
  const spawns = team === "blue" ? BLUE_SPAWNS : RED_SPAWNS;
  const safeIndex = ((index % spawns.length) + spawns.length) % spawns.length;
  const spawn = spawns[safeIndex];
  if (spawn === undefined) {
    throw new RangeError("Arena spawn table must not be empty.");
  }
  return spawn;
}

/**
 * Slides a circle of {@link PLAYER_RADIUS} to a target position, pushing it out
 * of any obstacle it would overlap and clamping it to the arena bounds.
 */
export function resolveMovement(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number
): { readonly x: number; readonly z: number } {
  let x = clamp(toX, -ARENA_HALF_WIDTH, ARENA_HALF_WIDTH);
  let z = clamp(toZ, -ARENA_HALF_DEPTH, ARENA_HALF_DEPTH);

  for (const obstacle of ARENA_OBSTACLES) {
    const minX = obstacle.centerX - obstacle.halfWidth - PLAYER_RADIUS;
    const maxX = obstacle.centerX + obstacle.halfWidth + PLAYER_RADIUS;
    const minZ = obstacle.centerZ - obstacle.halfDepth - PLAYER_RADIUS;
    const maxZ = obstacle.centerZ + obstacle.halfDepth + PLAYER_RADIUS;

    if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) {
      continue;
    }

    // Push out along whichever axis needs the least correction, which makes a
    // player slide along a wall instead of sticking to it.
    const pushLeft = x - minX;
    const pushRight = maxX - x;
    const pushDown = z - minZ;
    const pushUp = maxZ - z;
    const smallest = Math.min(pushLeft, pushRight, pushDown, pushUp);

    if (smallest === pushLeft) {
      x = minX;
    } else if (smallest === pushRight) {
      x = maxX;
    } else if (smallest === pushDown) {
      z = minZ;
    } else {
      z = maxZ;
    }
  }

  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return { x: fromX, z: fromZ };
  }
  return { x, z };
}

/**
 * Returns the distance along the segment at which it first meets an obstacle
 * tall enough to stop a shot, or undefined when the path is clear.
 */
export function raycastObstacles(
  originX: number,
  originZ: number,
  directionX: number,
  directionZ: number,
  maxDistance: number
): number | undefined {
  let nearest: number | undefined;

  for (const obstacle of ARENA_OBSTACLES) {
    if (obstacle.height < SHOT_HEIGHT) {
      continue;
    }

    const hit = raySlab(
      originX,
      originZ,
      directionX,
      directionZ,
      obstacle.centerX - obstacle.halfWidth,
      obstacle.centerX + obstacle.halfWidth,
      obstacle.centerZ - obstacle.halfDepth,
      obstacle.centerZ + obstacle.halfDepth,
      maxDistance
    );
    if (hit !== undefined && (nearest === undefined || hit < nearest)) {
      nearest = hit;
    }
  }

  return nearest;
}

/**
 * Returns the distance at which a ray meets a circle of the given radius, or
 * undefined when it misses. Used to test shots against player capsules.
 */
export function raycastCircle(
  originX: number,
  originZ: number,
  directionX: number,
  directionZ: number,
  centerX: number,
  centerZ: number,
  radius: number,
  maxDistance: number
): number | undefined {
  const offsetX = originX - centerX;
  const offsetZ = originZ - centerZ;
  const b = offsetX * directionX + offsetZ * directionZ;
  const c = offsetX * offsetX + offsetZ * offsetZ - radius * radius;

  if (c > 0 && b > 0) {
    return undefined;
  }

  const discriminant = b * b - c;
  if (discriminant < 0) {
    return undefined;
  }

  const distance = -b - Math.sqrt(discriminant);
  if (distance < 0 || distance > maxDistance) {
    // The origin may sit inside the circle, which still counts as a hit.
    return c <= 0 ? 0 : undefined;
  }
  return distance;
}

function raySlab(
  originX: number,
  originZ: number,
  directionX: number,
  directionZ: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  maxDistance: number
): number | undefined {
  let near = 0;
  let far = maxDistance;

  const axes: readonly (readonly [number, number, number, number])[] = [
    [originX, directionX, minX, maxX],
    [originZ, directionZ, minZ, maxZ]
  ];

  for (const [origin, direction, min, max] of axes) {
    if (Math.abs(direction) < 1e-8) {
      if (origin < min || origin > max) {
        return undefined;
      }
      continue;
    }
    const inverse = 1 / direction;
    let t0 = (min - origin) * inverse;
    let t1 = (max - origin) * inverse;
    if (t0 > t1) {
      [t0, t1] = [t1, t0];
    }
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) {
      return undefined;
    }
  }

  return near;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
