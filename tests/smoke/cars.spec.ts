import { expect, test, type Page } from "@playwright/test";

const SERVER_OVERRIDE = "?server=ws://127.0.0.1:8787";

interface CarDesign {
  bodyStyle: string;
  paintColor: string;
  rims: string;
  rimColor: string;
  spoiler: string;
  roof: string;
  stripes: string;
  lights: string;
}

async function designCar(page: Page): Promise<void> {
  await page.locator("#open-car-editor").click();
  await expect(page.locator("#car-editor")).toBeVisible();
  await page.locator('[data-car-option="bodyStyle:pickup"]').click();
  await page.locator('[data-car-option="rims:turbo"]').click();
  await page.locator('[data-car-option="spoiler:tall"]').click();
  await page.locator('[data-car-option="roof:skibox"]').click();
  await page.locator('[data-car-option="stripes:double"]').click();
  await page.locator('[data-car-option="lights:neon"]').click();
  await page.locator('[data-car-color="paintColor"]').fill("#12ab34");
  await page.locator('[data-car-color="rimColor"]').fill("#ffd700");
  await page.locator("#car-save").click();
  await expect(page.locator("#car-message")).toContainText("saved");
  await page.screenshot({ path: "test-results/car-editor.png" });
}

function parseVector(value: string | null): { x: number; z: number } {
  const [x, z] = (value ?? "0,0").split(",").map(Number);
  return { x: x ?? 0, z: z ?? 0 };
}

async function readPosition(page: Page): Promise<{ x: number; z: number }> {
  return parseVector(
    await page.locator("#game-shell").getAttribute("data-player-position")
  );
}

/** From the blue spawn: up the side alley, then east along the kerb. */
async function walkToOwnCar(page: Page): Promise<void> {
  const button = page.locator("#vehicle-action");
  await page.keyboard.down("KeyW");
  await expect
    .poll(async () => (await readPosition(page)).z)
    .toBeGreaterThan(1);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("KeyD");
  await expect(button).toBeVisible({ timeout: 10_000 });
  await page.keyboard.up("KeyD");
}

async function startTraining(page: Page): Promise<void> {
  await page.goto("./");
  await page.locator("#offline-training").click();
  await expect(page.locator("#status-message")).toContainText("ready", {
    timeout: 20_000
  });
}

test("a saved car design survives a restart", async ({ page }) => {
  await page.goto("./");
  await designCar(page);
  await page.reload();
  await page.locator("#open-car-editor").click();
  await expect(
    page.locator('[data-car-option="bodyStyle:pickup"]')
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator('[data-car-option="spoiler:tall"]')
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-car-color="paintColor"]')).toHaveValue(
    "#12ab34"
  );
});

test("you drive exactly the car you designed", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./");
  await designCar(page);
  await page.locator("#car-close").click();
  await page.locator("#offline-training").click();
  await expect(page.locator("#status-message")).toContainText("ready", {
    timeout: 20_000
  });

  const shell = page.locator("#game-shell");
  const design = JSON.parse(
    (await shell.getAttribute("data-car-design")) ?? "{}"
  ) as CarDesign;
  expect(design).toMatchObject({
    bodyStyle: "pickup",
    paintColor: "#12ab34",
    rims: "turbo",
    rimColor: "#ffd700",
    spoiler: "tall",
    roof: "skibox",
    stripes: "double",
    lights: "neon"
  });

  await walkToOwnCar(page);
  const button = page.locator("#vehicle-action");
  await expect(button).toHaveText("Drive your car");
  await page.keyboard.press("KeyE");
  await expect(button).toHaveText("Exit vehicle");
  await expect(shell).toHaveAttribute("data-driving", "true");
  await page.screenshot({ path: "test-results/car-driving.png" });

  const start = parseVector(await shell.getAttribute("data-car-position"));
  await page.keyboard.down("KeyS");
  await expect
    .poll(
      async () => {
        const car = parseVector(await shell.getAttribute("data-car-position"));
        return Math.hypot(car.x - start.x, car.z - start.z);
      },
      { timeout: 8_000 }
    )
    .toBeGreaterThan(4);
  await page.keyboard.up("KeyS");

  await page.keyboard.press("KeyE");
  await expect(shell).toHaveAttribute("data-driving", "false");
  // The car stays where it was left, and the driver stands clear of it.
  const parked = parseVector(await shell.getAttribute("data-car-position"));
  const driver = await readPosition(page);
  expect(Math.hypot(driver.x - parked.x, driver.z - parked.z)).toBeGreaterThan(
    1.5
  );
});

test("a walker is stopped by a building, then rounds its corner", async ({
  page
}) => {
  test.setTimeout(120_000);
  await startTraining(page);

  // The south-west building starts at x = -19 and spans z -15..-7, right
  // beside the spawn. Walking straight at it must stop at the wall...
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(2_000);
  const atWall = await readPosition(page);
  expect(atWall.x).toBeLessThan(-19.4);
  expect(atWall.x).toBeGreaterThan(-19.8);

  // ...and pushing on diagonally must glide along the wall and round the
  // corner, never snag on it and never enter the building.
  await page.keyboard.down("KeyW");
  await expect
    .poll(async () => (await readPosition(page)).x, { timeout: 30_000 })
    .toBeGreaterThan(-17);
  const rounded = await readPosition(page);
  await page.keyboard.up("KeyD");
  await page.keyboard.up("KeyW");
  expect(rounded.z).toBeGreaterThan(-7);
});

test("a driven car cannot pass through a building", async ({ page }) => {
  test.setTimeout(120_000);
  await startTraining(page);
  await walkToOwnCar(page);
  await page.keyboard.press("KeyE");

  const shell = page.locator("#game-shell");
  // Drive north into the north-west building (x -19..-9, z 7..15).
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(3_000);
  const car = parseVector(await shell.getAttribute("data-car-position"));
  await page.keyboard.up("KeyW");
  // The front of the car (1.7 m ahead) must stay south of the building's face.
  expect(car.z).toBeLessThan(7 - 1.65);
});

test("the other player sees my car design and me driving it", async ({
  browser
}) => {
  test.setTimeout(240_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await host.goto(SERVER_OVERRIDE);
    await expect(host.locator("#host-game")).toBeEnabled();
    await designCar(host);
    await host.locator("#car-close").click();
    await host.locator("#host-game").click();
    await expect(host.locator("#room-code")).toHaveText(/^[A-Z2-9]{6}$/, {
      timeout: 120_000
    });
    const roomCode = (
      (await host.locator("#room-code").textContent()) ?? ""
    ).trim();

    await guest.goto(SERVER_OVERRIDE);
    await expect(guest.locator("#join-game")).toBeEnabled();
    await guest.locator("#join-code").fill(roomCode);
    await guest.locator("#join-game").click();

    const readRemote = async () => {
      const raw = await guest
        .locator("#game-shell")
        .getAttribute("data-online-remotes");
      return (
        JSON.parse(raw ?? "[]") as { car: CarDesign; driving: boolean }[]
      )[0];
    };

    await expect
      .poll(async () => (await readRemote())?.car, { timeout: 150_000 })
      .toMatchObject({
        bodyStyle: "pickup",
        paintColor: "#12ab34",
        rims: "turbo",
        rimColor: "#ffd700",
        spoiler: "tall",
        roof: "skibox",
        stripes: "double",
        lights: "neon"
      });

    // Online the host's car stands in the bay the server assigned.
    await expect(host.locator("#game-shell")).toHaveAttribute(
      "data-car-slot",
      /^\d$/
    );
    const hostCar = parseVector(
      await host.locator("#game-shell").getAttribute("data-car-position")
    );
    const guestCar = parseVector(
      await guest.locator("#game-shell").getAttribute("data-car-position")
    );
    expect(
      Math.hypot(hostCar.x - guestCar.x, hostCar.z - guestCar.z)
    ).toBeGreaterThan(3.5);

    // The host walks to the car and drives; the guest sees it move.
    await host.bringToFront();
    await host.keyboard.down("KeyW");
    await expect
      .poll(async () => (await readPosition(host)).z, { timeout: 20_000 })
      .toBeGreaterThan(1);
    await host.keyboard.up("KeyW");
    await host.keyboard.down("KeyD");
    await expect(host.locator("#vehicle-action")).toBeVisible({
      timeout: 20_000
    });
    await host.keyboard.up("KeyD");
    await host.keyboard.press("KeyE");
    await expect(host.locator("#game-shell")).toHaveAttribute(
      "data-driving",
      "true"
    );
    await expect
      .poll(async () => (await readRemote())?.driving, { timeout: 20_000 })
      .toBe(true);
    await guest.screenshot({ path: "test-results/guest-sees-car.png" });
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
