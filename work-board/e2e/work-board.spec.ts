import { expect, test } from "@playwright/test";

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

  await page.locator("g.node").first().focus();
  await expect(page.locator("#tip")).toBeVisible();
  await expect(page.locator("#tip")).toContainText(/approved|review|draft|standup/i);

  const reviewing = page.getByRole("button", { name: "reviewing", exact: true });
  await reviewing.focus();
  await expect(page.locator("#tip")).toBeHidden();
  await reviewing.click();
  await expect(reviewing).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "all", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("g.node")).toHaveCount(2);

  await page.getByRole("button", { name: /low-signal/ }).click();
  await expect(page.getByRole("button", { name: /low-signal/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("g.node")).toHaveCount(3);

  await page.getByRole("button", { name: "stack", exact: true }).click();
  await expect(page.getByRole("button", { name: "stack", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-now-line]")).toHaveCount(1);

  await page.getByRole("button", { name: "sweep", exact: true }).click();
  await expect(page.locator("svg#dial")).toHaveAttribute("data-mode", "sweep");
  await expect(page.getByRole("button", { name: "sweep", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(consoleErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
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
