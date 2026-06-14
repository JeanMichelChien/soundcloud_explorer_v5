import { expect, test, type Page } from "@playwright/test";
import demoFixture from "../data/demo/graph.sample.json";

async function loadDemo(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "SoundCloud Explorer" })).toBeVisible();
  await expect(page.getByText("Mira Coast").first()).toBeVisible();
  await expect(page.getByTestId("network-graph").locator("canvas").first()).toBeVisible();
}

async function expectGraphHasInk(page: Page) {
  await expect
    .poll(
      async () =>
        page
          .getByTestId("network-graph")
          .locator("canvas")
          .first()
          .evaluate((canvas) => {
            const canvasElement = canvas as HTMLCanvasElement;
            const context = canvasElement.getContext("2d");
            if (!context) return false;
            const pixels = context.getImageData(0, 0, canvasElement.width, canvasElement.height).data;
            let nonBackgroundPixels = 0;

            for (let index = 0; index < pixels.length; index += 40) {
              const red = pixels[index];
              const green = pixels[index + 1];
              const blue = pixels[index + 2];
              const alpha = pixels[index + 3];
              if (alpha && !(red > 246 && green > 247 && blue > 250)) nonBackgroundPixels += 1;
              if (nonBackgroundPixels > 100) return true;
            }

            return false;
          }),
      { timeout: 5_000 },
    )
    .toBe(true);
}

async function expectTooltipInsideViewport(page: Page, label: string) {
  await page.getByRole("button", { name: `About ${label}`, exact: true }).focus();
  const bubble = page.locator(".info-bubble").last();
  await expect(bubble).toBeVisible();

  const bubbleBox = await bubble.boundingBox();
  const viewport = page.viewportSize();
  expect(bubbleBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bubbleBox!.x).toBeGreaterThanOrEqual(0);
  expect(bubbleBox!.y).toBeGreaterThanOrEqual(0);
  expect(bubbleBox!.x + bubbleBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(bubbleBox!.y + bubbleBox!.height).toBeLessThanOrEqual(viewport!.height);
}

test("demo graph loads and supports search, tooltips, and artist details", async ({ page }) => {
  await loadDemo(page);
  await expectGraphHasInk(page);
  await expect(page.getByText("Label density")).toHaveCount(0);

  for (const label of [
    "seed artists",
    "likes per seed",
    "graph density",
    "seeds",
    "discover artists",
    "known artists",
    "liked by at least",
  ]) {
    await expectTooltipInsideViewport(page, label);
  }

  await page.getByRole("button", { name: "About liked by at least", exact: true }).focus();
  await expect(page.getByText("Show only artists liked by at least this many seed artists")).toBeVisible();
  await page.getByRole("button", { name: "About discover artists", exact: true }).focus();
  await expect(
    page.getByText("Artists liked by seed artists that Demo Listener does not already like or follow."),
  ).toBeVisible();

  await page.getByLabel("Search artists", { exact: true }).fill("Mira");
  const miraRow = page.getByRole("button", { name: /1\. Mira Coast/ });
  await miraRow.scrollIntoViewIfNeeded();
  const miraBox = await miraRow.boundingBox();
  expect(miraBox).not.toBeNull();
  await page.mouse.click(miraBox!.x + miraBox!.width / 2, miraBox!.y + miraBox!.height / 2);

  await expect(page.getByRole("heading", { name: "Mira Coast" })).toBeVisible();
  await expect(page.getByText("Known already")).toBeVisible();
  await expect(page.locator(".detail-panel").getByText("No", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open in SoundCloud/ })).toHaveAttribute(
    "href",
    /soundcloud\.com/,
  );

  await page.getByRole("button", { name: "Clear selected artist", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mira Coast" })).toBeHidden();
});

test("graph filters, support slider, zoom, and demo reset work", async ({ page }) => {
  await loadDemo(page);
  const categoryFilter = page.getByLabel("Graph category filter", { exact: true });
  await expect(categoryFilter).toBeVisible();

  await categoryFilter.selectOption("known");
  await expect(page.locator(".graph-status")).toContainText("0 discover");
  await expect(page.locator(".graph-status")).toContainText("8 links");

  await categoryFilter.selectOption("discover");
  await expect(page.locator(".graph-status")).toContainText("8 discover");
  await expect(page.locator(".graph-status")).toContainText("18 links");

  await page.getByRole("slider", { name: "Liked by at least", exact: true }).fill("8");
  await expect(page.getByText("No graph nodes match the current filters.")).toBeVisible();

  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await expect(page.getByText("Demo data")).toBeVisible();
  await expect(page.getByRole("slider", { name: "Liked by at least", exact: true })).toHaveValue("1");
  await expect(page.locator(".graph-status")).toContainText("8 discover");
  await expect(page.locator(".graph-status")).toContainText("26 links");
  await expectGraphHasInk(page);

  await page.getByRole("button", { name: "Zoom to fit", exact: true }).click();
  await expect(page.getByTestId("network-graph").locator("canvas").first()).toBeVisible();
  await expectGraphHasInk(page);

  await page.getByRole("button", { name: "Known", exact: true }).click();
  await page.getByLabel("Search artists", { exact: true }).fill("Unknown Artist Name");
  await expect(page.locator(".artist-row")).toHaveCount(0);
  await page.getByLabel("Search artists", { exact: true }).fill("Mira");
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await expect(page.getByText("Mira Coast").first()).toBeVisible();
});

test("live analyze handles success payloads, API errors, and recovery", async ({ page }) => {
  let requestBody: Record<string, unknown> | null = null;
  const successPayload = structuredClone(demoFixture);
  successPayload.profile.username = "Mock Listener";

  await page.route("**/api/analyze", async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(successPayload),
    });
  });

  await loadDemo(page);
  await page.getByLabel("Profile", { exact: true }).fill("mock-listener");
  await page.locator('label:has-text("Seed artists") input').fill("12");
  await page.locator('label:has-text("Likes per seed") input').fill("34");
  await page.locator('label:has-text("Graph density") select').selectOption("expanded");
  await page.getByRole("button", { name: /Analyze/ }).click();

  await expect(page.getByText("Live analysis for Mock Listener")).toBeVisible();
  expect(requestBody).toEqual({
    profile: "mock-listener",
    maxSeedArtists: 12,
    likesPerSeed: 34,
    graphDensity: "expanded",
  });
  await expectGraphHasInk(page);

  await page.unroute("**/api/analyze");
  await page.route("**/api/analyze", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "Mock profile not found." }),
    });
  });

  await page.getByLabel("Profile", { exact: true }).fill("missing-profile");
  await page.getByRole("button", { name: /Analyze/ }).click();
  await expect(page.getByText("Mock profile not found.")).toBeVisible();

  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await expect(page.getByText("Demo data")).toBeVisible();
  await expect(page.getByText("Mira Coast").first()).toBeVisible();
  await expectGraphHasInk(page);
});
