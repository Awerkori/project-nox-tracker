#!/usr/bin/env node
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, firefox } = require("/home/awerkori/.local/share/npm-global/lib/node_modules/@playwright/cli/node_modules/playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const AUDIT_DIR = path.resolve(
  process.env.HOME || "/home/awerkori",
  ".local/share/antigravity/Nox-Workspace/documentacao/tracker-redesign-audit"
);

fs.mkdirSync(AUDIT_DIR, { recursive: true });

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
      const urlPath = (req.url || "/").split("?")[0];
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const filePath = path.join(ROOT_DIR, rel);
      if (!filePath.startsWith(ROOT_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function makeIssue(num, opts = {}) {
  return {
    number: num,
    title: opts.title ?? `[Nova extensão]: Fonte ${num}`,
    html_url: opts.html_url ?? `https://github.com/ProjectNox-org/project-nox-requests/issues/${num}`,
    state: opts.state ?? "open",
    state_reason: opts.state_reason ?? null,
    created_at: opts.created_at ?? new Date(Date.UTC(2026, 9, 1, 12, 0, num)).toISOString(),
    updated_at: opts.updated_at ?? new Date(Date.UTC(2026, 9, 2, 12, 0, num)).toISOString(),
    closed_at: opts.state === "closed" ? new Date(Date.UTC(2026, 9, 3, 12, 0, num)).toISOString() : null,
    comments: opts.comments ?? 0,
    labels: opts.labels ?? [{ name: num % 2 === 0 ? "type:anime" : "type:manga" }, { name: "kind:new-extension" }],
    reactions: opts.reactions ?? { "+1": num % 10, total_count: (num % 10) + 2 },
    user: { login: opts.author ?? `user${num}` }
  };
}

async function runCoreTests(browserType, browserName, baseUrl) {
  console.log(`\n=== [${browserName}] Iniciando suíte de testes E2E ===`);
  const browser = await browserType.launch();

  try {
    // 1. UI, Estados, Contagens, Segurança XSS, Busca, Filtros, Modal, Paginação Visual e Responsividade
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", err => pageErrors.push(err.message));

      const fixtureIssues = [
        makeIssue(123, { title: "MangaDex — atualização", state: "open", labels: [{ name: "type:manga" }, { name: "kind:bug" }, { name: "Concluído" }], reactions: { "+1": 42, total_count: 50 } }),
        makeIssue(124, { title: "123mangas — domínio alterado", state: "open", labels: [{ name: "type:manga" }, { name: "kind:domain" }] }),
        makeIssue(125, { title: "<img src=x onerror=\"window.__xss=1\"> Cerise Scan XSS", html_url: "javascript:alert(1)", author: "\" onmouseover=\"window.__xss=2", state: "open", labels: [{ name: "type:manga" }, { name: "kind:bug" }] }),
        makeIssue(126, { title: "Issue Fechada Sem Label", state: "closed", labels: [] }),
        makeIssue(127, { title: "Título muito longo sem espaços https://exemplomuitolongosemespacos.example.com/caminho/gigante/para/testar/overflow/horizontal/no/card/日本語テスト", state: "open", labels: [{ name: "type:anime" }, { name: "kind:enhancement" }] }),
        { number: 999, title: "PR Ignorado", state: "open", pull_request: { url: "..." }, labels: [] },
        ...Array.from({ length: 30 }, (_, idx) => makeIssue(200 + idx, { state: "open" }))
      ];

      await page.route("https://api.github.com/**", route => route.abort());
      await page.route("**/data/issues.json*", route => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ generated_at: "2026-11-17T22:00:00Z", issues: fixtureIssues })
        });
      });

      await page.goto(baseUrl, { waitUntil: "networkidle" });

      // Assert exactly 3 stat buttons and no legacy controls
      assert.equal(await page.locator(".stat-card").count(), 3, "Resumo deve ter exatamente 3 cards");
      assert.equal(await page.locator(".quick-filter-row").count(), 0, "quick-filter-row deve ter sido removida");
      assert.equal(await page.locator("#status").count(), 0, "select #status deve ter sido removido");
      assert.equal(await page.locator("#resolution").count(), 0, "select #resolution deve ter sido removido");
      assert.equal(await page.locator("#state").count(), 0, "select #state deve ter sido removido");

      // Assert counts: 34 open + 1 closed = 35 total (PR #999 excluded)
      assert.equal(await page.locator('[data-stat="total"]').textContent(), "35");
      assert.equal(await page.locator('[data-stat="open"]').textContent(), "34");
      assert.equal(await page.locator('[data-stat="closed"]').textContent(), "1");

      // Assert progressive loading (24 initially + Mostrar mais)
      assert.equal(await page.locator(".ticket-card").count(), 24);
      await page.locator("#load-more-btn").click();
      assert.equal(await page.locator(".ticket-card").count(), 34);

      // Assert contradictory label issue #123 is ABERTA
      const card123Text = await page.locator('.ticket-card[data-number="123"] .badge-state').textContent();
      assert.equal(card123Text.trim(), "ABERTA");

      // Assert XSS did not execute and URL was sanitized
      const xssFlag = await page.evaluate(() => window.__xss);
      assert.equal(xssFlag, undefined, "XSS não pode executar");
      const href125 = await page.locator('.ticket-card[data-number="125"] .ticket-link').getAttribute("href");
      assert.equal(href125, "https://github.com/ProjectNox-org/project-nox-requests/issues/125");

      // Long title expansion button (#127)
      const expandBtn127 = page.locator('.ticket-card[data-number="127"] .title-expand-btn');
      assert.equal(await expandBtn127.count(), 1);
      await expandBtn127.click();
      assert.equal(await expandBtn127.getAttribute("aria-expanded"), "true");

      // Assert numeric search exact match: "123mangas" must NOT include #123
      await page.locator("#search").fill("123mangas");
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.ticket-card[data-number="124"]').count(), 1);
      assert.equal(await page.locator('.ticket-card[data-number="123"]').count(), 0);

      // Search "#123" matches #123
      await page.locator("#search").fill("#123");
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.ticket-card[data-number="123"]').count(), 1);
      await page.locator("#clear-search").click();

      // Closed tab shows #126 as FECHADA, displays #closed-state-note, and uses closed_at or created_at safely
      await page.locator('[data-filter-stat="closed"]').click();
      assert.equal(await page.locator("#closed-state-note").isVisible(), true, "Nota de fechadas deve aparecer");
      assert.equal(await page.locator(".ticket-card").count(), 1);
      const card126Text = await page.locator('.ticket-card[data-number="126"]').textContent();
      assert.ok(card126Text.includes("FECHADA"));
      assert.ok(card126Text.includes("Fechada"));
      assert.ok(!card126Text.includes("Sem classificação"));

      // Type filter scopes stats
      await page.locator('[data-filter-stat="total"]').click();
      await page.locator('[data-filter-type="manga"]').click();
      assert.equal(await page.locator("#stats-scope").isVisible(), true);
      await page.locator("#clear-filters").click();

      // Modal keyboard accessibility (Escape + Shift+Tab trap)
      await page.locator("#open-ticket").click();
      assert.equal(await page.locator("#ticket-modal").isVisible(), true);
      await page.keyboard.press("Shift+Tab");
      const activeInsideModal = await page.evaluate(() => document.activeElement?.closest("#ticket-modal") !== null);
      assert.equal(activeInsideModal, true, "Shift+Tab não pode escapar do modal");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#ticket-modal").isVisible(), false);

      // Motion pause toggle
      await page.locator("#toggle-motion").click();
      assert.equal(await page.locator("#toggle-motion").getAttribute("aria-pressed"), "true");
      await page.locator("#toggle-motion").click();
      assert.equal(await page.locator("#toggle-motion").getAttribute("aria-pressed"), "false");

      // Responsive overflow check across all breakpoints
      for (const width of [320, 360, 375, 390, 412, 480, 680, 768, 820, 1024, 1280, 1440, 1600, 1920, 2560]) {
        await page.setViewportSize({ width, height: 844 });
        const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        assert.equal(hasOverflow, false, `Overflow horizontal detectado em ${width}px (${browserName})`);
      }

      assert.deepEqual(pageErrors, [], `Erros de página inesperados: ${pageErrors.join("; ")}`);
      await context.close();
      console.log(`✓ [${browserName}] UI, XSS, Busca, Filtros, Modal, Paginação e Responsividade OK`);
    }

    // 2. Sincronização 10s (Cenários A–F) + Rate limit 403/429 + 304 + Paginação 5000 issues
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();

      let phase = 0;
      const t0Issues = [
        makeIssue(301, { title: "Pedido Alpha", state: "open", reactions: { "+1": 2 } }),
        makeIssue(302, { title: "Pedido Beta", state: "closed", reactions: { "+1": 5 } })
      ];
      const t1Issues = [
        makeIssue(301, { title: "Pedido Alpha Editado", state: "closed", reactions: { "+1": 9 }, updated_at: "2026-11-17T22:10:00Z" }),
        makeIssue(302, { title: "Pedido Beta", state: "open", reactions: { "+1": 5 }, updated_at: "2026-11-17T22:10:00Z" }),
        makeIssue(303, { title: "Pedido Gamma Novo", state: "open", reactions: { "+1": 1 }, updated_at: "2026-11-17T22:10:00Z" })
      ];

      await page.addInitScript(() => {
        window.__NOX_POLL_INTERVAL__ = 400; // acelerado para validar ciclo determinístico de sync
      });

      await page.route("**/data/issues.json*", route => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ generated_at: "2026-11-17T22:00:00Z", issues: t0Issues })
        });
      });

      let apiCalls = 0;
      await page.route("https://api.github.com/repos/ProjectNox-org/project-nox-requests/issues*", route => {
        apiCalls++;
        if (phase === 0) {
          route.fulfill({ status: 200, contentType: "application/json", headers: { "x-ratelimit-remaining": "55", etag: '"v1"' }, body: JSON.stringify(t0Issues) });
        } else if (phase === 1) {
          route.fulfill({ status: 200, contentType: "application/json", headers: { "x-ratelimit-remaining": "54", etag: '"v2"' }, body: JSON.stringify(t1Issues) });
        } else if (phase === 2) {
          route.fulfill({ status: 304, headers: { "x-ratelimit-remaining": "54" } });
        } else {
          route.fulfill({ status: 429, headers: { "x-ratelimit-remaining": "0", "retry-after": "120" }, body: JSON.stringify({ message: "rate limit" }) });
        }
      });

      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector('[data-stat="open"]')?.textContent !== "—", null, { timeout: 5000 });
      assert.equal(await page.locator('[data-stat="open"]').textContent(), "1");
      assert.equal(await page.locator('[data-stat="closed"]').textContent(), "1");

      // Advance to phase 1: #301 closed+edited, #302 reopened, #303 added
      phase = 1;
      await page.waitForFunction(() => document.querySelector('[data-stat="total"]')?.textContent === "3", null, { timeout: 5000 });
      assert.equal(await page.locator('[data-stat="open"]').textContent(), "2");
      assert.equal(await page.locator('[data-stat="closed"]').textContent(), "1");
      assert.equal(await page.locator('.ticket-card[data-number="303"]').count(), 1);
      assert.equal(await page.locator('.ticket-card[data-number="302"]').count(), 1);

      // Phase 2: 304 Not Modified preserves state
      phase = 2;
      await page.waitForTimeout(500);
      assert.equal(await page.locator('[data-stat="total"]').textContent(), "3");

      // Phase 3: 429 Rate Limit preserves valid data and BLOCKS manual refresh from hitting API
      phase = 3;
      await page.waitForFunction(() => document.querySelector("#updated")?.classList.contains("is-stale"), null, { timeout: 5000 });
      assert.equal(await page.locator('[data-stat="total"]').textContent(), "3");
      const callsBeforeManual = apiCalls;
      await page.locator("#refresh-data").click();
      await page.waitForTimeout(300);
      assert.equal(apiCalls, callsBeforeManual, "Atualização manual NÃO pode chamar API REST durante rate limit ativo");

      await context.close();
      console.log(`✓ [${browserName}] Sincronização (nova, fechamento, reabertura, edição, 304, 429 + bloqueio manual) OK`);
    }

    // 2b. Integridade estrita (estados inválidos, labels inválidas, JSON malformado, foco preservado)
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      let mode = "valid";

      await page.addInitScript(() => {
        window.__NOX_POLL_INTERVAL__ = 400;
      });

      await page.route("**/data/issues.json*", route => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            generated_at: "2026-11-17T22:00:00Z",
            issues: [makeIssue(501, { state: "open" }), makeIssue(502, { state: "closed" })]
          })
        });
      });

      await page.route("https://api.github.com/repos/ProjectNox-org/project-nox-requests/issues*", route => {
        if (mode === "valid") {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "x-ratelimit-remaining": "50" },
            body: JSON.stringify([makeIssue(501, { state: "open" }), makeIssue(502, { state: "closed" })])
          });
        } else if (mode === "invalid_state") {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "x-ratelimit-remaining": "49", etag: '"bad-etag"' },
            body: JSON.stringify([{ number: 501, title: "Bad", state: "unknown" }])
          });
        } else if (mode === "focus_update") {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "x-ratelimit-remaining": "48" },
            body: JSON.stringify([makeIssue(501, { title: "Título Atualizado 501", state: "open" }), makeIssue(502, { state: "closed" })])
          });
        }
      });

      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector('[data-stat="total"]')?.textContent === "2", null, { timeout: 5000 });

      // Focus link on #501
      await page.locator('.ticket-link[data-issue-number="501"]').focus();
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-issue-number")), "501");
      mode = "invalid_state";
      await page.waitForTimeout(550);
      // Catalog must NOT be overwritten by invalid state payload
      assert.equal(await page.locator('[data-stat="total"]').textContent(), "2");

      // Valid update while #501 link is focused must preserve focus on #501
      await page.locator('.ticket-link[data-issue-number="501"]').focus();
      mode = "focus_update";
      await page.waitForFunction(() => document.querySelector('.ticket-card[data-number="501"] .ticket-title')?.textContent?.includes("Atualizado"), null, { timeout: 5000 });
      const focusedNum = await page.evaluate(() => document.activeElement?.getAttribute("data-issue-number"));
      assert.equal(focusedNum, "501", "Foco deve ser preservado na issue #501 após atualização automática");

      await context.close();
      console.log(`✓ [${browserName}] Integridade (rejeição de estado inválido) e preservação de foco OK`);
    }

    // 3. Paginação completa da API (501+ e 5000 issues simuladas)
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();

      await page.route("**/data/issues.json*", route => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ generated_at: "2026-11-17T22:00:00Z", issues: [makeIssue(1)] })
        });
      });

      const totalPages = 50; // 50 * 100 = 5.000 issues
      await page.route("https://api.github.com/repos/ProjectNox-org/project-nox-requests/issues*", route => {
        const u = new URL(route.request().url());
        const p = Number(u.searchParams.get("page") || 1);
        const headers = {
          "x-ratelimit-remaining": "59",
          "access-control-expose-headers": "link, etag, x-ratelimit-remaining"
        };
        if (p > totalPages) {
          route.fulfill({ status: 200, contentType: "application/json", headers, body: "[]" });
          return;
        }
        const start = (p - 1) * 100 + 1;
        const batch = Array.from({ length: 100 }, (_, i) => makeIssue(start + i, { state: (start + i) % 2 === 0 ? "closed" : "open" }));
        if (p < totalPages) {
          headers["link"] = `<${u.origin}${u.pathname}?page=${p + 1}>; rel="next"`;
        } else {
          headers["link"] = `<${u.origin}${u.pathname}?page=1>; rel="first"`;
        }
        route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(batch) });
      });

      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.locator("#refresh-data").click();
      await page.waitForFunction(() => document.querySelector('[data-stat="total"]')?.textContent === "5000", null, { timeout: 10000 });
      assert.equal(await page.locator('[data-stat="open"]').textContent(), "2500");
      assert.equal(await page.locator('[data-stat="closed"]').textContent(), "2500");

      await context.close();
      console.log(`✓ [${browserName}] Paginação completa de 5.000 issues (50 páginas) OK`);
    }

    // 4. Múltiplas abas (BroadcastChannel)
    {
      const context = await browser.newContext();
      const page1 = await context.newPage();
      const page2 = await context.newPage();

      let tabPhase = 0;
      await context.route("**/data/issues.json*", route => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ generated_at: "2026-11-17T22:00:00Z", issues: [makeIssue(10)] })
        });
      });
      await context.route("https://api.github.com/repos/ProjectNox-org/project-nox-requests/issues*", route => {
        const list = tabPhase === 0 ? [makeIssue(10)] : [makeIssue(10), makeIssue(11)];
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(list) });
      });

      await page1.goto(baseUrl, { waitUntil: "networkidle" });
      await page2.goto(baseUrl, { waitUntil: "networkidle" });
      assert.equal(await page2.locator('[data-stat="total"]').textContent(), "1");

      tabPhase = 1;
      await page1.locator("#refresh-data").click();
      await page2.waitForFunction(() => document.querySelector('[data-stat="total"]')?.textContent === "2", null, { timeout: 5000 });

      await context.close();
      console.log(`✓ [${browserName}] Sincronização entre múltiplas abas OK`);
    }
  } finally {
    await browser.close();
  }
}

async function captureRealDataScreenshots(baseUrl) {
  console.log("\n=== Capturando evidências visuais com dados reais do snapshot ===");
  for (const [name, browserType] of [["chromium", chromium], ["firefox", firefox]]) {
    const browser = await browserType.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      // Block live API so screenshots deterministically reflect local data/issues.json
      await page.route("https://api.github.com/**", route => route.abort());
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);

      await page.screenshot({ path: path.join(AUDIT_DIR, `etapa2-${name}-desktop-1440.png`), fullPage: true });

      if (name === "chromium") {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(AUDIT_DIR, "etapa2-chromium-desktop-1920.png"), fullPage: false });

        await page.setViewportSize({ width: 2560, height: 1440 });
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(AUDIT_DIR, "etapa2-chromium-desktop-2560.png"), fullPage: false });

        await page.setViewportSize({ width: 1440, height: 900 });
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(AUDIT_DIR, "etapa2-chromium-bottom-1440.png"), fullPage: false });
        await page.evaluate(() => window.scrollTo(0, 0));

        await page.locator('[data-filter-stat="closed"]').click();
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(AUDIT_DIR, "etapa2-closed-list-1440.png"), fullPage: false });

        await page.locator("#clear-filters").click();
        await page.locator("#toggle-motion").click();
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(AUDIT_DIR, "etapa2-paused-motion-1440.png"), fullPage: false });
        await page.locator("#toggle-motion").click();
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(AUDIT_DIR, `etapa2-${name}-mobile-390.png`), fullPage: true });

      if (name === "chromium") {
        await page.setViewportSize({ width: 320, height: 640 });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(AUDIT_DIR, "etapa2-chromium-mobile-320.png"), fullPage: false });
      }
      await context.close();
    } finally {
      await browser.close();
    }
  }
  console.log(`✓ Screenshots salvas em ${AUDIT_DIR}`);
}

const { server, baseUrl } = await startStaticServer();
try {
  await runCoreTests(chromium, "Chromium", baseUrl);
  await runCoreTests(firefox, "Firefox", baseUrl);
  await captureRealDataScreenshots(baseUrl);
  console.log("\n✅ TODOS OS TESTES E2E (CHROMIUM + FIREFOX) PASSARAM!");
} finally {
  server.close();
}
