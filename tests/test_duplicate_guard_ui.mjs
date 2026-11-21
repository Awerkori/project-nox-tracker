// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Project Nox Contributors & Awerkori

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const guard = require("../duplicate-guard.js");

const SAMPLE_ISSUES = [
  {
    number: 132,
    title: "[Problema na extensão]: Bakai — Bakai no pages found",
    html_url: "https://github.com/ProjectNox-org/project-nox-requests/issues/132",
    state: "open",
    isOpen: true,
    type: "manga",
    kind: "bug",
    kindLabel: "Problema na extensão",
    upvotes: 7,
    rawLabels: ["Problema na extensão", "Mangá", "Em análise"]
  },
  {
    number: 140,
    title: "[Nova extensão]: WatchAnimeHentai",
    html_url: "https://github.com/ProjectNox-org/project-nox-requests/issues/140",
    state: "open",
    isOpen: true,
    type: "anime",
    kind: "new-extension",
    kindLabel: "Nova extensão",
    upvotes: 4,
    rawLabels: ["Anime", "Nova extensão", "Em análise", "Conteúdo +18"]
  },
  {
    number: 130,
    title: "[Mudança de domínio]: Fleur Blanche",
    html_url: "https://github.com/ProjectNox-org/project-nox-requests/issues/130",
    state: "closed",
    state_reason: "completed",
    isOpen: false,
    type: "manga",
    kind: "domain",
    kindLabel: "Mudança de domínio",
    upvotes: 2,
    rawLabels: ["Mangá", "Mudança de domínio", "Concluído"]
  },
  {
    number: 55,
    title: "[Bug]: TaimuMangas, Não foi possível resolver apiv2.taimumangas.com: NXDOMAIN",
    html_url: "https://github.com/ProjectNox-org/project-nox-requests/issues/55",
    state: "closed",
    state_reason: "duplicate",
    isOpen: false,
    type: "manga",
    kind: "bug",
    kindLabel: "Problema na extensão",
    upvotes: 0,
    rawLabels: ["Problema na extensão", "Mangá", "Duplicado"]
  },
  {
    number: 201,
    title: "[Nova extensão]: Manga Livre",
    html_url: "https://github.com/ProjectNox-org/project-nox-requests/issues/201",
    state: "open",
    isOpen: true,
    type: "manga",
    kind: "new-extension",
    kindLabel: "Nova extensão",
    upvotes: 10,
    rawLabels: ["Nova extensão", "Mangá", "Em análise"]
  }
];

test("normalizes accents, spacing, and compact source names", () => {
  assert.equal(guard.normalizeText("  Mangá  Livre  "), "manga livre");
  assert.equal(guard.compactText("Manga Livre"), "mangalivre");
  const res = guard.findSimilarIssues("MangaLivre", SAMPLE_ISSUES);
  assert.ok(res.results.length >= 1);
  assert.equal(res.results[0].issue.number, 201);
});

test("extracts host stem when user pastes full URL", () => {
  assert.equal(guard.extractHostStem("https://www.watchanimehentai.com/pt/ranking"), "watchanimehentai");
  const res = guard.findSimilarIssues("https://www.watchanimehentai.com/pt/", SAMPLE_ISSUES);
  assert.ok(res.results.length >= 1);
  assert.equal(res.results[0].issue.number, 140);
});

test("matches typos via fuzzy similarity (Wacht anime hentai -> WatchAnimeHentai)", () => {
  const res = guard.findSimilarIssues("Wacht anime hentai", SAMPLE_ISSUES);
  assert.ok(res.results.length >= 1);
  assert.equal(res.results[0].issue.number, 140);
});

test("finds structured bug issue #132 by keywords and exact number", () => {
  const byWords = guard.findSimilarIssues("Bakai erro no pages found", SAMPLE_ISSUES);
  assert.equal(byWords.results[0].issue.number, 132);

  const byNum = guard.findSimilarIssues("#132", SAMPLE_ISSUES);
  assert.equal(byNum.results.length, 1);
  assert.equal(byNum.results[0].issue.number, 132);
});

test("returns closed issues with official resolution badge without blocking search", () => {
  const res = guard.findSimilarIssues("Fleur Blanche", SAMPLE_ISSUES);
  assert.equal(res.results[0].issue.number, 130);
  assert.equal(res.results[0].resolutionLabel, "Concluído");

  const dupRes = guard.findSimilarIssues("TaimuMangas", SAMPLE_ISSUES);
  assert.equal(dupRes.results[0].issue.number, 55);
  assert.equal(dupRes.results[0].resolutionLabel, "Duplicado");
});

test("handles short queries, malicious input, and 2000-issue scale quickly", () => {
  const tooShort = guard.findSimilarIssues("a", SAMPLE_ISSUES);
  assert.equal(tooShort.tooShort, true);
  assert.equal(tooShort.results.length, 0);

  const xss = guard.findSimilarIssues('<script>alert("x")</script>', SAMPLE_ISSUES);
  assert.ok(xss.githubSearchUrl.startsWith("https://github.com/ProjectNox-org/project-nox-requests/issues?q="));

  const large = [];
  for (let i = 1; i <= 2000; i++) {
    large.push({
      number: i,
      title: `[Nova extensão]: FonteExemplo${i}`,
      state: i % 2 === 0 ? "open" : "closed",
      kind: "new-extension",
      kindLabel: "Nova extensão",
      upvotes: i % 7,
      rawLabels: ["Nova extensão", "Mangá"]
    });
  }
  const t0 = performance.now();
  const perfRes = guard.findSimilarIssues("FonteExemplo1998", large, { limit: 5 });
  const elapsedMs = performance.now() - t0;
  assert.equal(perfRes.results[0].issue.number, 1998);
  assert.ok(elapsedMs < 250, `Expected fast search over 2000 issues, took ${elapsedMs}ms`);
});
