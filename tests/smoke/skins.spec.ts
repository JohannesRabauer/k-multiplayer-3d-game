import { expect, test, type Page } from "@playwright/test";

const SERVER_OVERRIDE = "?server=ws://127.0.0.1:8787";

async function openLobby(page: Page): Promise<void> {
  await page.goto(SERVER_OVERRIDE);
  await expect(page.locator("#entry-screen")).toBeVisible();
  await expect(page.locator("#host-game")).toBeEnabled();
}

async function customize(page: Page): Promise<void> {
  await page.locator("#open-skin-editor").click();
  await expect(page.locator("#skin-editor")).toBeVisible();
  await page.locator('[data-skin-option="headwear:knight"]').click();
  await page.locator('[data-skin-option="glasses:sunglasses"]').click();
  await page.locator('[data-skin-option="top:hoodie"]').click();
  await page.locator('[data-skin-option="pants:shorts"]').click();
  await page.locator('[data-skin-option="shoes:boots"]').click();
  await page.locator('[data-skin-option="eyeShape:angry"]').click();
  await page.locator('[data-skin-color="topColor"]').fill("#ff00aa");
  await page.locator('[data-skin-color="eyeColor"]').fill("#00ff88");
  await page.locator("#skin-name").fill("Night knight");
  await page.locator("#skin-save").click();
  await expect(page.locator("#skin-message")).toContainText("saved");
  await page.screenshot({ path: "test-results/skin-editor.png" });
}

test("a saved skin survives a restart", async ({ page }) => {
  await openLobby(page);
  await customize(page);

  await page.reload();
  await expect(page.locator("#entry-screen")).toBeVisible();
  await page.locator("#open-skin-editor").click();

  await expect(page.locator("#skin-name")).toHaveValue("Night knight");
  await expect(
    page.locator('[data-skin-option="headwear:knight"]')
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-skin-color="topColor"]')).toHaveValue(
    "#ff00aa"
  );
});

test("other players see the exact skin, health and score", async ({
  browser
}) => {
  test.setTimeout(120_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await openLobby(host);
    await customize(host);
    await host.locator("#skin-close").click();
    await host.locator("#host-game").click();
    const roomCode = (
      (await host.locator("#room-code").textContent()) ?? ""
    ).trim();

    await openLobby(guest);
    await guest.locator("#join-code").fill(roomCode);
    await guest.locator("#join-game").click();

    await expect
      .poll(
        async () => {
          const raw = await guest
            .locator("#game-shell")
            .getAttribute("data-online-remotes");
          const remotes = JSON.parse(raw ?? "[]") as {
            skin: Record<string, string>;
          }[];
          return remotes[0]?.skin;
        },
        { timeout: 75_000 }
      )
      .toMatchObject({
        headwear: "knight",
        glasses: "sunglasses",
        top: "hoodie",
        pants: "shorts",
        shoes: "boots",
        eyeShape: "angry",
        topColor: "#ff00aa",
        eyeColor: "#00ff88"
      });

    // Both devices must agree on score and on the local player's health.
    await expect(guest.locator("#game-shell")).toHaveAttribute(
      "data-online-score",
      /^\d+-\d+$/
    );
    const hostScore = await host
      .locator("#game-shell")
      .getAttribute("data-online-score");
    const guestScore = await guest
      .locator("#game-shell")
      .getAttribute("data-online-score");
    expect(guestScore).toBe(hostScore);
    await guest.waitForTimeout(500);
    await guest.screenshot({ path: "test-results/guest-view.png" });
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
