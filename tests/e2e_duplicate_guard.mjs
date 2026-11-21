// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Project Nox Contributors & Awerkori

import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let playwrightMod;
try {
  playwrightMod = require("playwright");
} catch {
  playwrightMod = require("/home/awerkori/.local/share/npm-global/lib/node_modules/@playwright/cli/node_modules/playwright");
}
const { chromium, firefox } = playwrightMod;
const SKIP_SCREENSHOTS = process.argv.includes("--no-screenshots");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const AUDIT_DIR = path.resolve(
  process.env.HOME || "/home/awerkori",
  ".local/share/antigravity/Nox-Workspace/documentacao/nox-duplicate-guard-audit"
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqPath = (req.url || "/").split("?")[0];
      const rel = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
      const filePath = path.join(ROOT_DIR, rel);
      if (!filePath.startsWith(ROOT_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

const MOCK_ISSUES = [
  {
    number: 132,
    title: "[Problema na extensão]: Bakai — Bakai no pages found",
    html_url: "https://github.com/ProjectNox-org/project-nox-requests/issues/132",
    state: "open",
    state_reason: null,
    created_at: "2026-11-07T21:01:53Z",
    updated_at: "2026-11-20T10:00:00Z",
    closed_at: null,
    comments: 1,
    labels: [{ name: "Problema na extensão", color: "ef4444" }, { name: "Mangá", color: "3b82f6" }],
    reactions: { total_count: 5, "+1": 5 },
    author: { login: "reader1" }
  },
  {
    number: 140,
    title: "[Nova extensão]: WatchAnimeHentai <img src=x onerror=alert(1)>",
    html_url: "https://github.com/ProjectNox-org/project-nox-requests/issues/140",
    state: "open",
    state_reason: null,
    created_at: "2026-11-09T10:00:00Z",
    updated_at: "2026-11-09T10:00:00Z",
    closed_at: null,
    comments: 0,
    labels: [{ name: "Anime", color: "6366f1" }, { name: "Nova extensão", color: "8b5cf6" }],
    reactions: { total_count: 3, "+1": 3 },
    author: { login: "user2" }
  },
  {
    number: 130,
    title: "[Mudança de domínio]: Fleur Blanche",
    html_url: "https://github.com/ProjectNox-org/project-nox-requests/issues/130",
    state: "closed",
    state_reason: "completed",
    created_at: "2026-11-05T13:40:51Z",
    updated_at: "2026-11-18T00:56:25Z",
    closed_at: "2026-11-18T00:56:25Z",
    comments: 4,
    labels: [{ name: "Mangá", color: "3b82f6" }, { name: "Mudança de domínio", color: "06b6d4" }, { name: "Concluído", color: "10b981" }],
    reactions: { total_count: 1, "+1": 1 },
    author: { login: "user3" }
  }
];

async function runForBrowser(browserType, browserName, baseUrl) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("dialog", async (d) => {
      pageErrors.push(`Unexpected dialog XSS: ${d.message()}`);
      await d.dismiss();
    });

    await page.route("**/data/issues.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: '"dg-e2e-v1"' },
        body: JSON.stringify({ generated_at: "2026-11-21T01:00:00Z", repository: "ProjectNox-org/project-nox-requests", issues: MOCK_ISSUES })
      });
    });
    await page.route("https://api.github.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-ratelimit-remaining": "55" },
        body: JSON.stringify(MOCK_ISSUES)
      });
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".ticket-card");

    // 1. Open modal and verify pre-check panel exists along with all 5 official template links
    await page.locator("#open-ticket").click();
    assert.equal(await page.locator("#ticket-modal").isVisible(), true);
    assert.equal(await page.locator(".template-option").count(), 5);

    // 2. Search existing issue ("Bakai") -> shows #132 with vote count and safe GitHub link
    await page.locator("#dup-guard-input").fill("Bakai");
    await page.waitForSelector('[data-guard-issue="132"]');
    const row132Text = await page.locator('[data-guard-issue="132"]').textContent();
    assert.ok(row132Text.includes("#132"));
    assert.ok(row132Text.includes("👍 5"));
    assert.ok(row132Text.includes("Ver e votar"));
    const href132 = await page.locator('[data-guard-issue="132"] .dup-guard-item-link').getAttribute("href");
    assert.equal(href132, "https://github.com/ProjectNox-org/project-nox-requests/issues/132");

    // 3. XSS payload in title and search input renders safely as text
    await page.locator("#dup-guard-input").fill("WatchAnimeHentai");
    await page.waitForSelector('[data-guard-issue="140"]');
    const html140 = await page.locator('[data-guard-issue="140"] .dup-guard-item-title').innerHTML();
    assert.ok(!html140.includes("<img"), "XSS payload must be escaped as textContent");

    // 4. Category chip filter in modal
    await page.locator('.dup-guard-cat-btn[data-guard-category="domain"]').click();
    assert.equal(await page.locator('.dup-guard-cat-btn[data-guard-category="domain"]').getAttribute("aria-pressed"), "true");

    // 5. No-match query displays honest snapshot disclaimer & GitHub fallback search link
    await page.locator("#dup-guard-input").fill("FonteCompletamenteInexistenteXYZ");
    await page.waitForSelector(".dup-guard-empty");
    const emptyText = await page.locator(".dup-guard-empty").textContent();
    assert.ok(emptyText.includes("snapshot") || emptyText.includes("não garante"));
    assert.ok((await page.locator(".dup-guard-gh-search").getAttribute("href")).includes("github.com/ProjectNox-org/project-nox-requests/issues?q="));

    // 6. Focus trap + Tab navigation reaches input inside modal without escaping
    await page.locator("#dup-guard-clear").click();
    assert.equal(await page.locator("#dup-guard-input").inputValue(), "");
    await page.keyboard.press("Tab");
    const insideAfterTab = await page.evaluate(() => document.activeElement?.closest("#ticket-modal") !== null);
    assert.equal(insideAfterTab, true);

    // 7. Capture real visual screenshots for desktop & mobile when enabled
    if (!SKIP_SCREENSHOTS && browserName === "chromium") {
      fs.mkdirSync(AUDIT_DIR, { recursive: true });
      await page.locator('.dup-guard-cat-btn[data-guard-category="all"]').click();
      await page.locator("#dup-guard-input").fill("Bakai");
      await page.waitForSelector('[data-guard-issue="132"]');
      await page.screenshot({ path: path.join(AUDIT_DIR, "modal_guard_desktop_1440.png") });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(AUDIT_DIR, "modal_guard_mobile_390.png") });

      await page.setViewportSize({ width: 320, height: 667 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(AUDIT_DIR, "modal_guard_mobile_320.png") });

      await page.locator("#dup-guard-input").fill("NaoExisteAinda999");
      await page.waitForSelector(".dup-guard-empty");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(AUDIT_DIR, "modal_guard_empty_1440.png") });
    }

    // 8. Responsive overflow check with modal open across desktop and mobile
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false, `Overflow horizontal com modal aberto em ${width}px (${browserName})`);
    }

    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#ticket-modal").isVisible(), false);
    assert.deepEqual(pageErrors, [], `Erros inesperados: ${pageErrors.join("; ")}`);
    await context.close();
    console.log(`✓ [${browserName}] Duplicate Guard Modal E2E + XSS + Responsividade OK`);
  } finally {
    await browser.close();
  }
}

const { server, baseUrl } = await startStaticServer();
try {
  await runForBrowser(chromium, "chromium", baseUrl);
  await runForBrowser(firefox, "firefox", baseUrl);
  console.log("SUCCESS: All Duplicate Guard E2E tests passed on Chromium and Firefox.");
} finally {
  server.close();
}
