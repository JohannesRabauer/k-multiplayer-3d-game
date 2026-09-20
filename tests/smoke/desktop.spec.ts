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

  await page.mouse.down();
  await expect(page.locator("#ammo-value")).not.toHaveText("8");
  await page.mouse.up();
});

test("enters, drives, and exits the nearby vehicle", async ({ page }) => {
  await openTraining(page);
  const actionButton = page.locator("#vehicle-action");
  await expect(actionButton).toBeVisible();
  await expect(actionButton).toHaveText("Drive vehicle");

  await page.keyboard.press("KeyE");
  await expect(actionButton).toHaveText("Exit vehicle");
  const positionBeforeDriving = await page
    .locator("#game-shell")
    .getAttribute("data-player-position");
  await page.keyboard.down("KeyW");
  await expect(page.locator("#game-shell")).not.toHaveAttribute(
    "data-player-position",
    positionBeforeDriving ?? ""
  );
  await page.keyboard.up("KeyW");

  await page.keyboard.press("KeyE");
  await expect(actionButton).toHaveText("Drive vehicle");
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
