import { expect, test, type Page } from "@playwright/test";

const SERVER_OVERRIDE = "?server=ws://127.0.0.1:8787";

test("two players join the same room by code and see each other", async ({
  browser
}) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await openLobby(host);
    await host.locator("#host-game").click();

    const roomCode = await readRoomCode(host);
    expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);

    await openLobby(guest);
    await guest.locator("#join-code").fill(roomCode);
    await guest.locator("#join-game").click();

    // Both clients must leave the lobby and enter the shared arena.
    await expect(host.locator("#game-shell")).toHaveAttribute(
      "data-mode",
      "online"
    );
    await expect(guest.locator("#game-shell")).toHaveAttribute(
      "data-mode",
      "online"
    );

    // Each client renders exactly one remote avatar: the other player.
    await expect
      .poll(async () => readRemotePlayerCount(host), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () => readRemotePlayerCount(guest), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1);

    // Movement by the host must propagate through the server to the guest.
    const before = await readRemotePosition(guest);
    await host.keyboard.down("KeyW");
    await expect
      .poll(async () => readRemotePosition(guest), { timeout: 20_000 })
      .not.toBe(before);
    await host.keyboard.up("KeyW");
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("an unknown room code is rejected with a readable message", async ({
  page
}) => {
  await openLobby(page);
  await page.locator("#join-code").fill("ZZZZZZ");
  await page.locator("#join-game").click();

  await expect(page.locator("#online-message")).toContainText(/room|code/i, {
    timeout: 20_000
  });
  await expect(page.locator("#entry-screen")).toBeVisible();
});

async function openLobby(page: Page): Promise<void> {
  await page.goto(SERVER_OVERRIDE);
  await expect(page.locator("#entry-screen")).toBeVisible();
  await expect(page.locator("#host-game")).toBeEnabled();
}

async function readRoomCode(page: Page): Promise<string> {
  const roomCode = page.locator("#room-code");
  await expect(roomCode).toHaveText(/^[A-Z2-9]{6}$/, { timeout: 20_000 });
  return ((await roomCode.textContent()) ?? "").trim();
}

async function readRemotePlayerCount(page: Page): Promise<number> {
  const value = await page
    .locator("#game-shell")
    .getAttribute("data-online-remote-players");
  return Number.parseInt(value ?? "0", 10);
}

async function readRemotePosition(page: Page): Promise<string> {
  return (
    (await page.locator("#game-shell").getAttribute("data-online-snapshots")) ??
    ""
  );
}
