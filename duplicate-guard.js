// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Project Nox Contributors & Awerkori

/**
 * Nox Duplicate Guard — Pre-creation search & similarity engine for Project Nox Tracker.
 * Pure, dependency-free UMD module (browser global `window.NoxDuplicateGuard` + Node CommonJS).
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NoxDuplicateGuard = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const REPO_ISSUES_SEARCH_URL = "https://github.com/ProjectNox-org/project-nox-requests/issues";

  const STOPWORDS = new Set([
    "a", "o", "os", "as", "um", "uma", "de", "do", "da", "dos", "das",
    "em", "no", "na", "nos", "nas", "por", "para", "pra", "com", "sem",
    "e", "ou", "mas", "que", "se", "como", "ao", "nao", "sim", "ja",
    "esta", "estao", "erro", "problema", "extensao", "fonte", "site",
    "nova", "novo", "pedido", "the", "and", "for", "with"
  ]);

  const RESOLUTION_LABELS = new Map([
    ["concluído", "Concluído"],
    ["concluido", "Concluído"],
    ["resolution:done", "Concluído"],
    ["duplicado", "Duplicado"],
    ["resolution:duplicate", "Duplicado"],
    ["recusado", "Recusado"],
    ["resolution:declined", "Recusado"],
    ["cancelado", "Cancelado"],
    ["resolution:cancelled", "Cancelado"]
  ]);

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function compactText(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, "");
  }

  function stripTitlePrefix(title) {
    return String(title || "")
      .replace(/^\s*(?:\[(?:Nova extensão|Problema na extensão|Bug|Mudança de domínio|Fonte indisponível|Fonte morta|Sugestão)\]\s*:\s*)+/i, "")
      .trim();
  }

  function extractPrimaryNameSegment(cleanTitle) {
    const parts = String(cleanTitle || "").split(/\s*(?:—|,|\s-\s)\s*/);
    return (parts[0] || "").trim();
  }

  function extractHostStem(rawInput) {
    const cleaned = String(rawInput || "")
      .trim()
      .replace(/^htpps?:\/\//i, "https://")
      .replace(/^(https?)\/\/:/i, "$1://");
    const m = cleaned.match(/(?:https?:\/\/)?(?:www\d*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
    if (!m) return "";
    const host = m[1].toLowerCase();
    const parts = host.split(".");
    if (parts.length < 2) return "";
    const tld = parts[parts.length - 1];
    if (/^\d+$/.test(tld) || tld.length < 2) return "";
    return parts.length >= 3 && ["com", "org", "net", "edu", "gov", "co"].includes(parts[parts.length - 2])
      ? parts[parts.length - 3]
      : parts[0];
  }

  function tokenize(text) {
    const norm = normalizeText(text);
    const raw = norm.match(/[a-z0-9]+/g) || [];
    const out = [];
    const seen = new Set();
    for (const tok of raw) {
      if (tok.length < 2 || STOPWORDS.has(tok) || seen.has(tok)) continue;
      seen.add(tok);
      out.push(tok);
    }
    return out;
  }

  function levenshteinDistance(a, b, maxCap = 64) {
    if (a === b) return 0;
    const la = a.length;
    const lb = b.length;
    if (!la) return lb;
    if (!lb) return la;
    if (Math.abs(la - lb) > maxCap) return maxCap + 1;

    let prev = new Array(lb + 1);
    let curr = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;

    for (let i = 1; i <= la; i++) {
      curr[0] = i;
      let rowMin = curr[0];
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        const val = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        curr[j] = val;
        if (val < rowMin) rowMin = val;
      }
      if (rowMin > maxCap) return maxCap + 1;
      const tmp = prev;
      prev = curr;
      curr = tmp;
    }
    return prev[lb];
  }

  function editRatio(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    const dist = levenshteinDistance(a, b, Math.ceil(maxLen * 0.5) + 2);
    return dist > maxLen ? 0 : Math.max(0, 1 - dist / maxLen);
  }

  function diceBigrams(a, b) {
    const sa = normalizeText(a);
    const sb = normalizeText(b);
    if (!sa || !sb) return 0;
    if (sa === sb) return 1;
    if (sa.length < 2 || sb.length < 2) return 0;
    const mapA = new Map();
    for (let i = 0; i < sa.length - 1; i++) {
      const bg = sa.slice(i, i + 2);
      mapA.set(bg, (mapA.get(bg) || 0) + 1);
    }
    let inter = 0;
    for (let j = 0; j < sb.length - 1; j++) {
      const bg = sb.slice(j, j + 2);
      const cnt = mapA.get(bg) || 0;
      if (cnt > 0) {
        inter++;
        mapA.set(bg, cnt - 1);
      }
    }
    return (2 * inter) / ((sa.length - 1) + (sb.length - 1));
  }

  function extractQuerySignals(rawQuery) {
    const raw = String(rawQuery || "").slice(0, 200).trim();
    const norm = normalizeText(raw);
    const compact = compactText(raw);
    const numMatch = /^\s*#?(\d+)\s*$/.exec(raw);
    const exactNumber = numMatch ? Number(numMatch[1]) : null;
    const hostStem = extractHostStem(raw);
    const tokens = tokenize(raw);
    return { raw, norm, compact, exactNumber, hostStem, tokens };
  }

  function getResolutionLabel(issue) {
    if (!issue || issue.state !== "closed") return "";
    const labels = Array.isArray(issue.rawLabels)
      ? issue.rawLabels
      : (Array.isArray(issue.labels) ? issue.labels.map(l => (typeof l === "string" ? l : l?.name || "")) : []);
    for (const lbl of labels) {
      const mapped = RESOLUTION_LABELS.get(String(lbl || "").toLowerCase());
      if (mapped) return mapped;
    }
    if (issue.state_reason === "duplicate") return "Duplicado";
    return "";
  }

  function buildGitHubSearchUrl(query) {
    const clean = String(query || "").trim().slice(0, 150);
    if (!clean) return REPO_ISSUES_SEARCH_URL;
    return `${REPO_ISSUES_SEARCH_URL}?q=${encodeURIComponent(`is:issue ${clean}`)}`;
  }

  function scoreIssue(signals, issue, selectedCategory) {
    const title = String(issue.title || "");
    const cleanTitle = stripTitlePrefix(title);
    const primarySegment = extractPrimaryNameSegment(cleanTitle);
    const primaryCompact = compactText(primarySegment);
    const titleNorm = normalizeText(cleanTitle);
    const fullTitleNorm = normalizeText(title);
    const titleCompact = compactText(cleanTitle);
    const titleTokens = tokenize(cleanTitle);

    let score = 0;
    let reason = "";

    // 1. Exact issue number (#132 or 132)
    if (signals.exactNumber !== null && Number(issue.number) === signals.exactNumber) {
      score = 100;
      reason = "Número exato";
    }

    // 2. Host stem extracted from pasted URL (e.g. https://www.watchanimehentai.com/pt/)
    if (signals.hostStem && signals.hostStem.length >= 3) {
      if (primaryCompact === signals.hostStem || titleCompact.includes(signals.hostStem)) {
        score = Math.max(score, 88);
        reason = reason || "Domínio / fonte correspondente";
      }
    }

    // 3. Compact alphanumeric match on extension segment or full clean title
    if (signals.compact && signals.compact.length >= 3) {
      if (titleCompact === signals.compact || primaryCompact === signals.compact) {
        score = Math.max(score, 94);
        reason = reason || "Nome idêntico";
      } else if (
        primaryCompact &&
        (primaryCompact.includes(signals.compact) ||
          (signals.compact.length >= 5 && signals.compact.includes(primaryCompact) && primaryCompact.length >= 4 && primaryCompact.length / signals.compact.length >= 0.7))
      ) {
        score = Math.max(score, 84);
        reason = reason || "Nome correspondente";
      } else if (titleCompact && titleCompact.includes(signals.compact)) {
        score = Math.max(score, 78);
        reason = reason || "Nome correspondente";
      }
    }

    // 4. Normalized substring match
    if (signals.norm.length >= 2 && (titleNorm.includes(signals.norm) || fullTitleNorm.includes(signals.norm))) {
      score = Math.max(score, 76);
      reason = reason || "Termo encontrado no título";
    }

    // 5. Token overlap (prevent short generic tokens like "manga" inside "taimumangas" from false matching)
    if (signals.tokens.length > 0 && titleTokens.length > 0) {
      let hits = 0;
      for (const qt of signals.tokens) {
        if (titleTokens.some(tt => tt === qt)) {
          hits += 1.0;
        } else if (qt.length >= 4 && titleTokens.some(tt => tt.includes(qt))) {
          hits += 0.85;
        } else if (
          qt.length >= 5 &&
          titleTokens.some(tt => tt.length >= 5 && qt.includes(tt) && (tt.length / qt.length) >= 0.72)
        ) {
          hits += 0.6;
        } else if (qt.length >= 5 && titleTokens.some(tt => editRatio(qt, tt) >= 0.78)) {
          hits += 0.75;
        }
      }
      if (hits > 0) {
        const tokenCov = hits / signals.tokens.length;
        const tokenScore = 40 + tokenCov * 44;
        if (tokenScore > score) {
          score = tokenScore;
          reason = reason || "Palavras-chave semelhantes";
        }
      }
    }

    // 6. Typo-tolerant similarity over compact / bigram form (e.g. "Wacht anime hentai")
    if (score < 58 && signals.compact.length >= 5 && titleCompact.length >= 5) {
      const ratio = editRatio(signals.compact, titleCompact);
      const dice = diceBigrams(signals.norm, titleNorm);
      const fuzzy = Math.max(ratio, dice);
      if (fuzzy >= 0.64) {
        score = Math.max(score, Math.round(fuzzy * 72));
        reason = reason || "Grafia semelhante";
      }
    }

    if (score < 42) return null;

    // Gentle prioritization bonuses (never overwhelm core textual relevance)
    if (issue.state === "open" || issue.isOpen) {
      score += 8;
    }
    if (selectedCategory && selectedCategory !== "all" && issue.kind === selectedCategory) {
      score += 6;
    }
    const upvotes = Number(issue.upvotes ?? issue.reactions?.["+1"] ?? 0) || 0;
    score += Math.min(4, upvotes * 0.5);

    return {
      issue,
      score: Math.round(score * 10) / 10,
      matchReason: reason,
      resolutionLabel: getResolutionLabel(issue)
    };
  }

  function findSimilarIssues(rawQuery, issues, options = {}) {
    const category = options.category || "all";
    const limit = Math.max(1, Math.min(10, Number(options.limit || 5)));
    const signals = extractQuerySignals(rawQuery);
    const githubSearchUrl = buildGitHubSearchUrl(signals.raw);

    if (!signals.raw || (signals.exactNumber === null && signals.norm.length < 2)) {
      return {
        query: signals.raw,
        results: [],
        githubSearchUrl,
        tooShort: true
      };
    }

    const list = Array.isArray(issues) ? issues : [];
    const scored = [];
    for (const issue of list) {
      if (!issue || !issue.number) continue;
      const item = scoreIssue(signals, issue, category);
      if (item) scored.push(item);
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const openDiff = (b.issue.state === "open" ? 1 : 0) - (a.issue.state === "open" ? 1 : 0);
      if (openDiff !== 0) return openDiff;
      const upDiff = (Number(b.issue.upvotes ?? b.issue.reactions?.["+1"] ?? 0) || 0) -
        (Number(a.issue.upvotes ?? a.issue.reactions?.["+1"] ?? 0) || 0);
      if (upDiff !== 0) return upDiff;
      return Number(b.issue.number) - Number(a.issue.number);
    });

    return {
      query: signals.raw,
      results: scored.slice(0, limit),
      githubSearchUrl,
      tooShort: false
    };
  }

  return {
    normalizeText,
    compactText,
    stripTitlePrefix,
    extractHostStem,
    extractQuerySignals,
    levenshteinDistance,
    diceBigrams,
    getResolutionLabel,
    buildGitHubSearchUrl,
    findSimilarIssues
  };
});
