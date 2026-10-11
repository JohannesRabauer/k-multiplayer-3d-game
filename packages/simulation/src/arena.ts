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

/** Radius of a player capsule, used for collision push-out. */
export const PLAYER_RADIUS = 0.55;

/** Inner faces of the boundary walls the client draws. */
export const ARENA_WALL_X = 23.5;
export const ARENA_WALL_Z = 17.5;

/** Half-extents of the area a player's centre may occupy. */
export const ARENA_HALF_WIDTH = ARENA_WALL_X - PLAYER_RADIUS;
export const ARENA_HALF_DEPTH = ARENA_WALL_Z - PLAYER_RADIUS;

/** A circular obstacle on the floor plane, e.g. one end of a parked car. */
export interface CircleObstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * A car is collided as a capsule made of two circles, one near each end. That
 * hugs a 1.8 x 3.4 m body far better than a single circle and, unlike a box,
 * does not depend on the heading to stay axis aligned.
 */
export const CAR_CIRCLE_RADIUS = 1;
export const CAR_CIRCLE_OFFSET = 0.7;
/** Speed of a driven car relative to walking. */
export const VEHICLE_SPEED_MULTIPLIER = 1.75;
/** How close a player must be to a car to get in. */
export const VEHICLE_ENTER_DISTANCE = 4;
/** Cars a room can park; one bay per player. */
export const MAX_PARKING_SLOTS = 8;

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

/**
 * Spawns sit in the side alleys, clear of every building and parking bay, so a
 * freshly spawned player is never wedged against a wall.
 */
export const BLUE_SPAWNS: readonly ArenaSpawn[] = [
  { x: -21, z: -8, yaw: Math.PI / 2 },
  { x: -21, z: 8, yaw: Math.PI / 2 },
  { x: -21, z: -12, yaw: Math.PI / 2 },
  { x: -21, z: 12, yaw: Math.PI / 2 }
];

export const RED_SPAWNS: readonly ArenaSpawn[] = [
  { x: 21, z: -8, yaw: -Math.PI / 2 },
  { x: 21, z: 8, yaw: -Math.PI / 2 },
  { x: 21, z: -12, yaw: -Math.PI / 2 },
  { x: 21, z: 12, yaw: -Math.PI / 2 }
];

/**
 * Marked bays along both kerbs of the main road, four per side of the plaza.
 * Neighbouring bays are 4 m apart and the middle of the road stays open, so no
 * parked car can block another or the lane between them.
 */
export const PARKING_SLOTS: readonly ArenaSpawn[] = [
  { x: -12.5, z: 3.3, yaw: Math.PI / 2 },
  { x: 12.5, z: 3.3, yaw: Math.PI / 2 },
  { x: -16.5, z: 3.3, yaw: Math.PI / 2 },
  { x: 16.5, z: 3.3, yaw: Math.PI / 2 },
  { x: -12.5, z: -3.3, yaw: Math.PI / 2 },
  { x: 12.5, z: -3.3, yaw: Math.PI / 2 },
  { x: -16.5, z: -3.3, yaw: Math.PI / 2 },
  { x: 16.5, z: -3.3, yaw: Math.PI / 2 }
];

export function getParkingSlot(index: number): ArenaSpawn {
  const slot =
    PARKING_SLOTS[
      ((index % PARKING_SLOTS.length) + PARKING_SLOTS.length) %
        PARKING_SLOTS.length
    ];
  if (slot === undefined) {
    throw new RangeError("Parking slot table must not be empty.");
  }
  return slot;
}

/** The two circles a car at this pose occupies; yaw 0 faces +Z. */
export function carCircles(
  x: number,
  z: number,
  yaw: number
): readonly [CircleObstacle, CircleObstacle] {
  const offsetX = Math.sin(yaw) * CAR_CIRCLE_OFFSET;
  const offsetZ = Math.cos(yaw) * CAR_CIRCLE_OFFSET;
  return [
    { x: x + offsetX, z: z + offsetZ, radius: CAR_CIRCLE_RADIUS },
    { x: x - offsetX, z: z - offsetZ, radius: CAR_CIRCLE_RADIUS }
  ];
}

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
 * Slides a circle (a player by default) to a target position. Walls and
 * parked cars push it out along the contact normal, so it glides around
 * corners instead of catching on them, and the arena bounds clamp it.
 */
export function resolveMovement(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  circles: readonly CircleObstacle[] = [],
  radius: number = PLAYER_RADIUS
): { readonly x: number; readonly z: number } {
  const resolved = pushOutOfWorld(toX, toZ, radius, circles);
  if (!Number.isFinite(resolved.x) || !Number.isFinite(resolved.z)) {
    return { x: fromX, z: fromZ };
  }
  return resolved;
}

/**
 * Moves a car (see {@link carCircles}) to a target position. Each end is
 * pushed out of the world on its own and the correction is applied to the
 * whole car, which lets it scrape along walls and swing round corners.
 */
export function resolveVehicleMovement(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  yaw: number,
  circles: readonly CircleObstacle[] = []
): { readonly x: number; readonly z: number } {
  let x = toX;
  let z = toZ;
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    for (const sign of [1, -1]) {
      const endX = x + Math.sin(yaw) * CAR_CIRCLE_OFFSET * sign;
      const endZ = z + Math.cos(yaw) * CAR_CIRCLE_OFFSET * sign;
      const pushed = pushOutOfWorld(endX, endZ, CAR_CIRCLE_RADIUS, circles);
      const deltaX = pushed.x - endX;
      const deltaZ = pushed.z - endZ;
      if (Math.abs(deltaX) > 1e-6 || Math.abs(deltaZ) > 1e-6) {
        x += deltaX;
        z += deltaZ;
        moved = true;
      }
    }
    if (!moved) {
      break;
    }
  }
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return { x: fromX, z: fromZ };
  }
  return { x, z };
}

/**
 * Where a player lands when leaving a car: the first free spot beside it,
 * then behind and in front. Never inside a wall or another car.
 */
export function getVehicleExit(
  carX: number,
  carZ: number,
  carYaw: number,
  otherCircles: readonly CircleObstacle[] = []
): { readonly x: number; readonly z: number } {
  const circles = [...otherCircles, ...carCircles(carX, carZ, carYaw)];
  const rightX = Math.cos(carYaw);
  const rightZ = -Math.sin(carYaw);
  const forwardX = Math.sin(carYaw);
  const forwardZ = Math.cos(carYaw);
  const candidates = [
    [rightX * 2.1, rightZ * 2.1],
    [-rightX * 2.1, -rightZ * 2.1],
    [-forwardX * 2.9, -forwardZ * 2.9],
    [forwardX * 2.9, forwardZ * 2.9]
  ] as const;

  let fallback: { readonly x: number; readonly z: number } | undefined;
  for (const [offsetX, offsetZ] of candidates) {
    const wantedX = carX + offsetX;
    const wantedZ = carZ + offsetZ;
    const resolved = resolveMovement(
      wantedX,
      wantedZ,
      wantedX,
      wantedZ,
      circles
    );
    fallback ??= resolved;
    if (Math.hypot(resolved.x - wantedX, resolved.z - wantedZ) < 0.05) {
      return resolved;
    }
  }
  return fallback ?? { x: carX, z: carZ };
}

function pushOutOfWorld(
  startX: number,
  startZ: number,
  radius: number,
  circles: readonly CircleObstacle[]
): { x: number; z: number } {
  let x = startX;
  let z = startZ;

  // Pushing out of one obstacle can shove the circle into the next, so repeat
  // until nothing moves it any more.
  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;

    for (const obstacle of ARENA_OBSTACLES) {
      const minX = obstacle.centerX - obstacle.halfWidth;
      const maxX = obstacle.centerX + obstacle.halfWidth;
      const minZ = obstacle.centerZ - obstacle.halfDepth;
      const maxZ = obstacle.centerZ + obstacle.halfDepth;
      const nearestX = clamp(x, minX, maxX);
      const nearestZ = clamp(z, minZ, maxZ);
      const offsetX = x - nearestX;
      const offsetZ = z - nearestZ;
      const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
      if (distanceSquared >= radius * radius) {
        continue;
      }

      if (distanceSquared > 1e-12) {
        // Outside the box: push along the contact normal, which is what makes
        // a corner round instead of sticky.
        const distance = Math.sqrt(distanceSquared);
        const push = radius - distance;
        x += (offsetX / distance) * push;
        z += (offsetZ / distance) * push;
      } else {
        // The centre is inside the box: leave through the nearest face.
        const pushLeft = x - minX;
        const pushRight = maxX - x;
        const pushDown = z - minZ;
        const pushUp = maxZ - z;
        const smallest = Math.min(pushLeft, pushRight, pushDown, pushUp);
        if (smallest === pushLeft) {
          x = minX - radius;
        } else if (smallest === pushRight) {
          x = maxX + radius;
        } else if (smallest === pushDown) {
          z = minZ - radius;
        } else {
          z = maxZ + radius;
        }
      }
      moved = true;
    }

    for (const circle of circles) {
      const offsetX = x - circle.x;
      const offsetZ = z - circle.z;
      const minimum = radius + circle.radius;
      const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
      if (distanceSquared >= minimum * minimum) {
        continue;
      }
      const distance = Math.sqrt(distanceSquared);
      if (distance > 1e-6) {
        const push = minimum - distance;
        x += (offsetX / distance) * push;
        z += (offsetZ / distance) * push;
      } else {
        x = circle.x + minimum;
      }
      moved = true;
    }

    const limitX = ARENA_WALL_X - radius;
    const limitZ = ARENA_WALL_Z - radius;
    const clampedX = clamp(x, -limitX, limitX);
    const clampedZ = clamp(z, -limitZ, limitZ);
    if (clampedX !== x || clampedZ !== z) {
      x = clampedX;
      z = clampedZ;
      moved = true;
    }

    if (!moved) {
      break;
    }
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
