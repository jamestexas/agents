import { expect, test } from "@playwright/test";

function rgb(cssColor: string): [number, number, number] {
  const channels = cssColor.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`expected an RGB color, got ${cssColor}`);
  return channels as [number, number, number];
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = rgb(color).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const values = [luminance(foreground), luminance(background)].toSorted((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

test("renders all layouts, filters, tooltip, and exact visual encoding", async ({ page }) => {
  const consoleErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") externalRequests.push(request.url());
  });

  await page.goto("/board/ui");
  await expect(page.locator("#meta")).toContainText("need you");
  await expect(page.locator("g.node")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "dial", exact: true })).toHaveAttribute("aria-pressed", "true");
  const lowSignal = page.getByRole("button", { name: /low-signal/ });
  await expect(lowSignal).toContainText("1");

  const exampleStatus = page.getByRole("status", { name: "Data status" });
  await expect(exampleStatus).toBeVisible();
  await expect(exampleStatus).toContainText(/example|fixture/i);
  await expect(exampleStatus).toContainText(/not live/i);

  const legend = page.getByLabel("Visual encoding");
  await expect(legend.getByText("circle author", { exact: true })).toBeVisible();
  await expect(legend.getByText("diamond reviewer", { exact: true })).toBeVisible();
  await expect(legend.getByText("square event", { exact: true })).toBeVisible();
  await expect(legend.getByText("filled waiting on me", { exact: true })).toBeVisible();
  await expect(legend.getByText("hollow waiting on others", { exact: true })).toBeVisible();
  await expect(legend.getByText("dashed draft", { exact: true })).toBeVisible();
  await expect(legend.getByText("green outline merge-ready", { exact: true })).toBeVisible();

  const authorPath = page.locator('g.node[aria-label^="#101"] path');
  const reviewerPath = page.locator('g.node[aria-label^="#204"] path');
  const eventPath = page.locator('g.node[aria-label^="team standup"] path');
  const [circleGeometry, diamondGeometry, squareGeometry] = await Promise.all([
    authorPath.getAttribute("d"),
    reviewerPath.getAttribute("d"),
    eventPath.getAttribute("d")
  ]);
  expect(circleGeometry).toMatch(/A/);
  expect(diamondGeometry).toMatch(/L/);
  expect(diamondGeometry).not.toMatch(/[hv]/);
  expect(squareGeometry).toMatch(/h.*v/);
  await expect(authorPath).toHaveAttribute("fill", "currentColor");
  await expect(page.locator('g.node[aria-label^="#206"] path')).toHaveAttribute("fill", "none");
  await expect(page.locator('g.node[aria-label^="#103"] path')).toHaveAttribute("stroke-dasharray", "3,2.5");
  await expect(authorPath).toHaveAttribute("stroke", "#238636");
  await expect(authorPath).toHaveAttribute("stroke-width", "3");

  await page.locator("g.node").first().focus();
  await expect(page.locator("#tip")).toBeVisible();
  await expect(page.locator("#tip")).toContainText(/approved|review|draft|standup/i);

  const mine = page.getByRole("button", { name: "mine", exact: true });
  await mine.focus();
  await expect(page.locator("#tip")).toBeHidden();
  await mine.click();
  await expect(mine).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("g.node")).toHaveCount(4);
  await expect(lowSignal).toContainText("0");

  const needs = page.getByRole("button", { name: "needs me", exact: true });
  await needs.click();
  await expect(needs).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("g.node")).toHaveCount(5);
  await expect(lowSignal).toContainText("1");

  const reviewing = page.getByRole("button", { name: "reviewing", exact: true });
  await reviewing.click();
  await expect(reviewing).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "all", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("g.node")).toHaveCount(2);

  await lowSignal.click();
  await expect(lowSignal).toHaveAttribute("aria-pressed", "true");
  await expect(lowSignal).toContainText("1");
  await expect(page.locator("g.node")).toHaveCount(3);

  await page.getByRole("button", { name: "stack", exact: true }).click();
  await expect(page.getByRole("button", { name: "stack", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-now-line]")).toHaveCount(1);
  await expect(page.locator("#listwrap")).toBeVisible();
  await expect(page.getByRole("button", { name: /copy list/ })).toBeVisible();

  await page.getByRole("button", { name: "sweep", exact: true }).click();
  await expect(page.locator("svg#dial")).toHaveAttribute("data-mode", "sweep");
  await expect(page.getByRole("button", { name: "sweep", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(consoleErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("quiet instrument labels meet small-text contrast", async ({ page }) => {
  await page.goto("/board/ui");
  const background = await page.locator("body").evaluate((element) =>
    getComputedStyle(element).backgroundColor
  );
  const eyebrow = await page.locator(".eyebrow").first().evaluate((element) =>
    getComputedStyle(element).color
  );
  const ringLabel = await page.locator(".ring-label").first().evaluate((element) =>
    getComputedStyle(element).fill
  );

  expect(contrastRatio(eyebrow, background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(ringLabel, background)).toBeGreaterThanOrEqual(4.5);
});

test("refresh is single-flight and preserves the last board on failure", async ({ page }) => {
  let refreshRequests = 0;
  await page.route("**/api/refresh", async (route) => {
    refreshRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue();
  });
  await page.goto("/board/ui");
  const refresh = page.getByRole("button", { name: /refresh/ });

  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  await expect(refresh).toContainText(/refreshing/i);
  await refresh.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(refresh).toBeEnabled();
  await expect(refresh).toHaveAttribute("aria-busy", "false");
  expect(refreshRequests).toBe(1);
  await expect(page.locator("#meta")).toContainText("09:01");
  await expect(page.getByRole("status", { name: "Data status" })).toContainText(/not live/i);

  await page.unroute("**/api/refresh");
  await page.route("**/api/refresh", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ error: "upstream", message: "fixture failed" })
  }));
  const retainedCount = await page.locator("g.node").count();
  await refresh.click();
  await expect(page.locator("#error")).toContainText("fixture failed");
  await expect(page.locator("#error")).toContainText(/last successful board/i);
  await expect(page.locator("g.node")).toHaveCount(retainedCount);
});

test("opens validated artifacts with Enter and Space", async ({ page }) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.defineProperty(window, "__openedArtifacts", {
      configurable: false,
      value: opened
    });
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await page.goto("/board/ui");
  const artifact = page.locator('g.node[aria-label^="#101"]');

  await artifact.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");

  expect(await page.evaluate(() =>
    (window as Window & { __openedArtifacts: string[] }).__openedArtifacts
  )).toEqual([
    "https://github.com/acme/demo/pull/101",
    "https://github.com/acme/demo/pull/101"
  ]);
});

test("copies the action list and reports clipboard success", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/board/ui");
  const copy = page.getByRole("button", { name: /copy list/ });
  await copy.click();
  await expect(page.locator("#copybtn")).toContainText(/copied/i);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("NEEDS YOU");
});

test("surfaces degradations and an explicit empty state", async ({ page }) => {
  await page.route("**/api/board", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-30T12:00:00Z",
      tickStatus: "degraded",
      degradations: ["github slice timed out"],
      items: []
    })
  }));
  await page.goto("/board/ui");
  await expect(page.locator("#error")).toContainText("github slice timed out");
  await expect(page.getByRole("status", { name: "Data status" })).toContainText(/degraded/i);
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator("g.node")).toHaveCount(0);
});
