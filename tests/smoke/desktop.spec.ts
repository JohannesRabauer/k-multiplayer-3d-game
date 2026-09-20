import { expect, test, type Page } from "@playwright/test";

test("supports keyboard movement, mouse aiming, and mouse fire", async ({
  page
}) => {
  await openTraining(page);
  const gameShell = page.locator("#game-shell");
  const initialPosition = await gameShell.getAttribute("data-player-position");
  const initialAim = await gameShell.getAttribute("data-aim-direction");

  await page.keyboard.down("KeyW");
  await expect(gameShell).not.toHaveAttribute(
    "data-player-position",
    initialPosition ?? ""
  );
  await page.keyboard.up("KeyW");

  const canvas = page.locator("#game-canvas");
  const bounds = await canvas.boundingBox();
  assertBounds(bounds);
  await page.mouse.move(
    bounds.x + bounds.width * 0.8,
    bounds.y + bounds.height * 0.5
  );
  await expect(gameShell).not.toHaveAttribute(
    "data-aim-direction",
    initialAim ?? ""
  );
  const rightAim = parseVector(
    await gameShell.getAttribute("data-aim-direction")
  );

  await page.mouse.move(
    bounds.x + bounds.width * 0.2,
    bounds.y + bounds.height * 0.5
  );
  // Aiming on the opposite side of the player must flip the world-space aim
  // vector, proving the aim revolves around the player.
  await expect
    .poll(async () => {
      const leftAim = parseVector(
        await gameShell.getAttribute("data-aim-direction")
      );
      return rightAim.x * leftAim.x + rightAim.z * leftAim.z;
    })
    .toBeLessThan(-0.5);

  await page.mouse.down();
  await expect(page.locator("#ammo-value")).not.toHaveText("8");
  await page.mouse.up();
});

test("enters, drives, and exits the nearby vehicle", async ({ page }) => {
  await openTraining(page);
  const gameShell = page.locator("#game-shell");
  const actionButton = page.locator("#vehicle-action");
  await expect(actionButton).toBeVisible();
  await expect(actionButton).toHaveText("Drive vehicle");

  await page.keyboard.press("KeyE");
  await expect(actionButton).toHaveText("Exit vehicle");
  const start = parseVector(
    await gameShell.getAttribute("data-player-position")
  );

  await page.keyboard.down("KeyW");
  // The vehicle must keep travelling, not just nudge once before the player
  // collider blocks it.
  await expect
    .poll(
      async () => {
        const current = parseVector(
          await gameShell.getAttribute("data-player-position")
        );
        return Math.hypot(current.x - start.x, current.z - start.z);
      },
      { timeout: 6_000 }
    )
    .toBeGreaterThan(6);
  await page.keyboard.up("KeyW");

  await page.keyboard.press("KeyE");
  await expect(actionButton).toHaveText("Drive vehicle");
});

test("renders every bot shot and misses often enough to be beatable", async ({
  page
}) => {
  test.setTimeout(180_000);
  await openTraining(page);
  const gameShell = page.locator("#game-shell");

  // Cumulative counters, because an individual tracer is only on screen for a
  // few frames and a sampling poll would race it.
  await expect
    .poll(
      async () =>
        Number((await gameShell.getAttribute("data-bot-shots-fired")) ?? "0"),
      { timeout: 150_000 }
    )
    .toBeGreaterThan(12);

  // One atomic snapshot, because reading each counter separately lets the
  // render loop advance between reads and skew the comparison.
  const { fired, hit, rendered } = await gameShell.evaluate((element) => ({
    fired: Number((element as HTMLElement).dataset.botShotsFired ?? "0"),
    hit: Number((element as HTMLElement).dataset.botShotsHit ?? "0"),
    rendered: Number(
      (element as HTMLElement).dataset.botShotEffectsRendered ?? "0"
    )
  }));

  expect(rendered).toBe(fired);
  expect(hit).toBeLessThan(fired);
});

test("runs rounds with a frozen warmup instead of endless respawns", async ({
  page
}) => {
  test.setTimeout(180_000);
  await openTraining(page);
  const matchState = page.locator("#match-state");
  const gameShell = page.locator("#game-shell");

  // Round 1 opens frozen so nobody can be shot at their spawn point.
  await expect(matchState).toHaveAttribute("data-phase", "warmup");
  await expect(matchState).toContainText("ROUND 1");
  await expect(gameShell).toHaveAttribute("data-round-live", "false");

  await expect(matchState).toHaveAttribute("data-phase", "in_progress", {
    timeout: 15_000
  });
  await expect(gameShell).toHaveAttribute("data-round-live", "true");
  await expect(matchState).toHaveAttribute("data-round", "1");
});

async function openTraining(page: Page): Promise<void> {
  await page.goto("./");
  await page.locator("#offline-training").click();
  await expect(page.locator("#status-message")).toContainText("ready", {
    timeout: 15_000
  });
}

function assertBounds(
  bounds: { height: number; width: number; x: number; y: number } | null
): asserts bounds is { height: number; width: number; x: number; y: number } {
  expect(bounds).not.toBeNull();
}

function parseVector(value: string | null): { x: number; z: number } {
  const [x, z] = (value ?? "0,0").split(",").map(Number);
  return { x: x ?? 0, z: z ?? 0 };
}
