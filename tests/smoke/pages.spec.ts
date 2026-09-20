import { expect, test, type Page } from "@playwright/test";

test("loads the 3D PWA from its GitHub Pages base path", async ({
  page,
  request
}) => {
  await page.goto("./");

  await expect(page).toHaveTitle("scooter-shooter");
  await expect(page.locator("#entry-screen")).toBeVisible();
  await expect(page.locator("#offline-training")).toBeVisible();
  await expect(page.locator("#game-shell")).toBeHidden();
  await page.locator("#bot-count").selectOption("8");
  await page.locator("#offline-training").click();

  await expect(page.locator("#game-shell")).toHaveAttribute(
    "data-bot-count",
    "8"
  );
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.locator("#movement-joystick")).toBeVisible();
  await expect(page.locator("#aim-joystick")).toBeVisible();
  await expect(page.locator("#status-message")).toHaveText(
    "8 training bots ready"
  );
  await expect(page.locator("#match-state")).toContainText("MATCH STARTS IN");
  await expect(page.locator("#blue-score")).toHaveText("0");
  await expect(page.locator("#red-score")).toHaveText("0");
  await expect(page.locator("#health-value")).toHaveText("100");
  await expect(page.locator("#combat-feedback")).toBeAttached();
  await expect(page.locator("#respawn-status")).toBeHidden();
  await page.locator("#leave-training").click();
  await expect(page.locator("#entry-screen")).toBeVisible();
  await expect(page.locator("#game-shell")).toBeHidden();
  await page.locator("#bot-count").selectOption("1");
  await page.locator("#offline-training").click();
  await expect(page.locator("#game-shell")).toHaveAttribute(
    "data-bot-count",
    "1"
  );
  await expect(page.locator("#status-message")).toHaveText(
    "1 training bot ready"
  );

  const manifestResponse = await request.get("./manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()["content-type"]).toContain(
    "application/manifest+json"
  );

  const manifest = (await manifestResponse.json()) as {
    display?: unknown;
    name?: unknown;
    start_url?: unknown;
  };
  expect(manifest).toMatchObject({
    display: "standalone",
    name: "scooter-shooter",
    start_url: "/k-multiplayer-3d-game/"
  });

  const registrationScope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  });
  expect(registrationScope.endsWith("/k-multiplayer-3d-game/")).toBe(true);
});

test("tracks independent movement and aim pointer input", async ({ page }) => {
  await openTraining(page);

  const movement = page.locator("#movement-joystick");
  const movementBounds = await movement.boundingBox();
  assertBounds(movementBounds);
  await page.mouse.move(
    movementBounds.x + movementBounds.width / 2,
    movementBounds.y + movementBounds.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    movementBounds.x + movementBounds.width,
    movementBounds.y + movementBounds.height / 2
  );
  await expect(movement.locator(".joystick__knob")).not.toHaveCSS(
    "transform",
    "none"
  );
  await page.mouse.up();

  const aim = page.locator("#aim-joystick");
  const aimBounds = await aim.boundingBox();
  assertBounds(aimBounds);
  await page.mouse.move(
    aimBounds.x + aimBounds.width / 2,
    aimBounds.y + aimBounds.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    aimBounds.x + aimBounds.width,
    aimBounds.y + aimBounds.height / 2
  );
  await expect(aim).toHaveAttribute("data-firing", "true");
  await expect(page.locator("#ammo-value")).not.toHaveText("8");
  await expect(page.locator("#crosshair")).toHaveAttribute(
    "data-last-shot-result",
    /^(miss|target|world)$/
  );
  await page.mouse.up();
  await expect(aim).toHaveAttribute("data-firing", "false");
});

test("requires landscape while gameplay controls are shown", async ({
  page
}) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("./");

  await expect(page.locator("#entry-screen")).toBeVisible();
  await expect(page.locator("#orientation-overlay")).toBeHidden();
  await page.locator("#offline-training").click();
  await expect(page.locator("#orientation-overlay")).toBeVisible();
  await expect(page.locator("#game-controls")).toBeHidden();

  await page.setViewportSize({ width: 915, height: 412 });
  await expect(page.locator("#orientation-overlay")).toBeHidden();
  await expect(page.locator("#game-controls")).toBeVisible();
});

test("exposes performance data and reduced effects on request", async ({
  page
}) => {
  await page.goto("./?debug=performance&quality=low");
  await page.locator("#offline-training").click();

  await expect(page.locator("#performance-stats")).toBeVisible();
  await expect(page.locator("#performance-stats")).toContainText("FPS");
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-effects",
    "true"
  );
});

async function openTraining(page: Page): Promise<void> {
  await page.goto("./");
  await page.locator("#offline-training").click();
  await expect(page.locator("#game-shell")).toBeVisible();
}

function assertBounds(
  bounds: { height: number; width: number; x: number; y: number } | null
): asserts bounds is { height: number; width: number; x: number; y: number } {
  expect(bounds).not.toBeNull();
}
