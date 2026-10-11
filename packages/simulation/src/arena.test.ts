import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ARENA_OBSTACLES,
  BLUE_SPAWNS,
  PARKING_SLOTS,
  PLAYER_RADIUS,
  RED_SPAWNS,
  carCircles,
  getVehicleExit,
  resolveMovement,
  resolveVehicleMovement,
  type CircleObstacle
} from "./arena.js";

function overlapsBox(x: number, z: number, radius: number): boolean {
  return ARENA_OBSTACLES.some((box) => {
    const nearestX = Math.min(
      box.centerX + box.halfWidth,
      Math.max(box.centerX - box.halfWidth, x)
    );
    const nearestZ = Math.min(
      box.centerZ + box.halfDepth,
      Math.max(box.centerZ - box.halfDepth, z)
    );
    return Math.hypot(x - nearestX, z - nearestZ) < radius - 1e-6;
  });
}

void describe("walking collisions", () => {
  void it("keeps a player out of every building when walking straight at it", () => {
    for (const box of ARENA_OBSTACLES) {
      let x = box.centerX - box.halfWidth - 3;
      const z = box.centerZ;
      for (let step = 0; step < 120; step += 1) {
        const next = resolveMovement(x, z, x + 0.1, z);
        x = next.x;
        assert.equal(overlapsBox(x, z, PLAYER_RADIUS), false, box.name);
      }
    }
  });

  void it("slides along a wall instead of sticking to it", () => {
    // Run diagonally into the west face of the north-west building.
    let x = -20;
    let z = 10;
    for (let step = 0; step < 60; step += 1) {
      const next = resolveMovement(x, z, x + 0.1, z + 0.1);
      x = next.x;
      z = next.z;
    }
    assert.ok(
      z > 14,
      `should have slid along the wall, ended at z=${String(z)}`
    );
    assert.equal(overlapsBox(x, z, PLAYER_RADIUS), false);
  });

  void it("rounds a building corner without snagging", () => {
    let x = -8.7;
    let z = 5.5;
    // Walk north along the building's east face and past its far corner.
    for (let step = 0; step < 130; step += 1) {
      const next = resolveMovement(x, z, x, z + 0.1);
      x = next.x;
      z = next.z;
    }
    assert.ok(z >= 15, "should reach the far side of the building");
  });

  void it("lets a player through the alley between a building and the wall", () => {
    // The side alleys are 4.25 m wide; a walker must be able to use them.
    let z = -16;
    for (let step = 0; step < 340; step += 1) {
      z = resolveMovement(-21, z, -21, z + 0.1).z;
    }
    assert.ok(z > 16);
  });

  void it("keeps every spawn and parking bay clear of buildings", () => {
    for (const spawn of [...BLUE_SPAWNS, ...RED_SPAWNS]) {
      assert.equal(overlapsBox(spawn.x, spawn.z, PLAYER_RADIUS), false);
      const resolved = resolveMovement(spawn.x, spawn.z, spawn.x, spawn.z);
      assert.deepEqual(resolved, { x: spawn.x, z: spawn.z });
    }
    for (const slot of PARKING_SLOTS) {
      for (const circle of carCircles(slot.x, slot.z, slot.yaw)) {
        assert.equal(
          overlapsBox(circle.x, circle.z, circle.radius),
          false,
          `bay at ${String(slot.x)},${String(slot.z)}`
        );
      }
    }
  });

  void it("never lets a player into a parked car", () => {
    const [front, back] = carCircles(-12.5, 3.3, Math.PI / 2);
    const circles: CircleObstacle[] = [front, back];
    const next = resolveMovement(-12.5, 6, -12.5, 3.3, circles);
    assert.ok(
      Math.hypot(next.x - front.x, next.z - front.z) >=
        PLAYER_RADIUS + front.radius - 1e-6 ||
        Math.hypot(next.x - back.x, next.z - back.z) >=
          PLAYER_RADIUS + back.radius - 1e-6
    );
    for (const circle of circles) {
      assert.ok(
        Math.hypot(next.x - circle.x, next.z - circle.z) >=
          PLAYER_RADIUS + circle.radius - 1e-6
      );
    }
  });
});

void describe("parking", () => {
  void it("gives every bay its own space with a free lane between them", () => {
    const circles = PARKING_SLOTS.map((slot) =>
      carCircles(slot.x, slot.z, slot.yaw)
    );
    for (let first = 0; first < circles.length; first += 1) {
      for (let second = first + 1; second < circles.length; second += 1) {
        for (const a of circles[first] ?? []) {
          for (const b of circles[second] ?? []) {
            assert.ok(
              Math.hypot(a.x - b.x, a.z - b.z) >= a.radius + b.radius - 1e-6,
              `bays ${String(first)} and ${String(second)} overlap`
            );
          }
        }
      }
    }
    // A player must be able to pass between the two rows of cars.
    const lane = resolveMovement(
      -14,
      0,
      14,
      0,
      PARKING_SLOTS.flatMap((slot) => carCircles(slot.x, slot.z, slot.yaw))
    );
    assert.ok(lane.x > 13);
  });

  void it("always has room to exit a car parked in any bay", () => {
    const others = PARKING_SLOTS.flatMap((slot) =>
      carCircles(slot.x, slot.z, slot.yaw)
    );
    for (const slot of PARKING_SLOTS) {
      const exit = getVehicleExit(slot.x, slot.z, slot.yaw, others);
      const settled = resolveMovement(exit.x, exit.z, exit.x, exit.z, others);
      assert.ok(Math.hypot(settled.x - exit.x, settled.z - exit.z) < 0.6);
      assert.equal(overlapsBox(exit.x, exit.z, PLAYER_RADIUS), false);
    }
  });
});

void describe("driving collisions", () => {
  void it("stops a car at a building instead of driving through it", () => {
    let x = -4;
    let z = 11;
    for (let step = 0; step < 200; step += 1) {
      const next = resolveVehicleMovement(x, z, x - 0.15, z, Math.PI / 2);
      x = next.x;
      z = next.z;
    }
    for (const circle of carCircles(x, z, Math.PI / 2)) {
      assert.equal(overlapsBox(circle.x, circle.z, circle.radius), false);
    }
    assert.ok(x > -9 + 1.7 - 1e-6, "car should rest against the building");
  });

  void it("cannot drive through a parked car", () => {
    const parked = carCircles(-12.5, 3.3, Math.PI / 2);
    let x = -5;
    const z = 3.3;
    for (let step = 0; step < 150; step += 1) {
      x = resolveVehicleMovement(x, z, x - 0.1, z, Math.PI / 2, parked).x;
    }
    assert.ok(x > -12.5 + 3.4 - 0.2, `stopped at ${String(x)}`);
  });
});
