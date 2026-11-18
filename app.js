// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Project Nox Contributors & Awerkori

/**
 * Project Nox Tracker 3.0 — Operational Core
 *
 * Principles:
 * 1. Official GitHub `state` ("open" | "closed") is the sole source of truth for issue state.
 * 2. Labels never override native state and missing workflow/resolution labels are never inferred.
 * 3. Safe DOM construction (no untrusted innerHTML interpolation) + strict URL validation.
 * 4. Complete API pagination + 10s check loop with GitHub unauthenticated rate-limit protection.
 * 5. Progressive list rendering (24 items per step) without losing full-inventory search/sort/counts.
 */

(function () {
  'use strict';

  // Constants
  const DATA_URL = "data/issues.json";
  const REPO_URL = "https://github.com/ProjectNox-org/project-nox-requests";
  const GITHUB_API_BASE = "https://api.github.com/repos/ProjectNox-org/project-nox-requests/issues";

  const CACHE_KEY = "project-nox-live-issues-v3";
  const CACHE_TIME_KEY = "project-nox-live-issues-v3-time";
  const CACHE_SIG_KEY = "project-nox-live-issues-v3-sig";
  const CACHE_VERSION_KEY = "project-nox-live-issues-v3-ver";
  const CACHE_ETAG_STORE_KEY = "project-nox-live-etags-v3";
  const CACHE_PAGE_STORE_KEY = "project-nox-live-pages-v3";
  const STORAGE_LAST_SYNC_KEY = "project-nox-last-sync-time-v3";
  const STORAGE_LAST_API_SYNC_KEY = "project-nox-last-api-sync-time-v3";
  const STORAGE_LAST_RECONCILE_KEY = "project-nox-last-reconcile-time-v3";
  const SYNC_CHANNEL_NAME = "project-nox-sync-channel-v3";

  // Polling & Rate-Limit Safe Intervals
  const CHECK_INTERVAL = 10 * 1000;            // 10s lightweight check cycle
  const GITHUB_API_MIN_INTERVAL = 65 * 1000;   // <= ~55 req/h safe for unauthenticated 60 req/h limit
  const THROTTLED_API_INTERVAL = 180 * 1000;   // 3 min when remaining quota < 15
  const RECONCILE_INTERVAL = 10 * 60 * 1000;   // 10 min full inventory reconciliation
  const MAX_SAFE_PAGES = 100;                  // Up to 10,000 issues safety ceiling
  const PAGE_SIZE = 24;

  // Label Taxonomy Maps (for Type & Category classification only)
  const TYPE_MAP = {
    "type:manga": "manga",
    "mangá": "manga",
    "manga": "manga",
    "type:anime": "anime",
    "anime": "anime"
  };

  const KIND_MAP = {
    "kind:new-extension": { key: "new-extension", label: "Nova extensão", icon: "🌐" },
    "nova extensão": { key: "new-extension", label: "Nova extensão", icon: "🌐" },
    "kind:bug": { key: "bug", label: "Problema na extensão", icon: "🐛" },
    "problema na extensão": { key: "bug", label: "Problema na extensão", icon: "🐛" },
    "bug": { key: "bug", label: "Problema na extensão", icon: "🐛" },
    "kind:domain": { key: "domain", label: "Mudança de domínio", icon: "🔗" },
    "mudança de domínio": { key: "domain", label: "Mudança de domínio", icon: "🔗" },
    "kind:dead-source": { key: "dead-source", label: "Fonte indisponível", icon: "💀" },
    "fonte indisponível": { key: "dead-source", label: "Fonte indisponível", icon: "💀" },
    "fonte morta": { key: "dead-source", label: "Fonte indisponível", icon: "💀" },
    "kind:enhancement": { key: "enhancement", label: "Sugestão", icon: "✨" },
    "sugestão": { key: "enhancement", label: "Sugestão", icon: "✨" }
  };

  const VALID_TYPES = new Set(["all", "manga", "anime"]);
  const VALID_STATES = new Set(["all", "open", "closed"]);
  const VALID_CATEGORIES = new Set(["all", "new-extension", "bug", "domain", "dead-source", "enhancement"]);
  const VALID_SORTS = new Set(["recent", "updated", "demand", "oldest"]);

  const defaults = {
    type: "all",
    state: "open",
    category: "all",
    sort: "recent",
    search: ""
  };

  // Cleanup legacy v1/v2 storage keys safely
  try {
    [
      "nox_tracker_sort",
      "project-nox-sort",
      "tracker_sort",
      "sort_preference",
      "tracker_filters",
      "project-nox-live-issues",
      "project-nox-live-issues-time",
      "project-nox-live-issues-v2",
      "project-nox-live-issues-v2-time",
      "project-nox-live-issues-v2-sig",
      "project-nox-live-issues-v2-ver",
      "project-nox-live-issues-v2-etag",
      "project-nox-live-etags-v2",
      "project-nox-live-pages-v2"
    ].forEach(k => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
  } catch {
    // Ignore storage restrictions
  }

  const filters = { ...defaults };
  let allIssues = [];
  let currentRawIssues = [];
  let hasLoadedData = false;
  let visibleCount = PAGE_SIZE;
  let lastFocus = null;
  let generatedAt = null;
  let lastCheckedAt = 0;
  let snapshotEtag = "";
  let currentSignature = "";
  let isFetching = false;
  let pendingManualRefresh = false;
  let pollTimer = null;
  let rateLimitUntil = 0;
  let rateLimitRemaining = null;
  let lastSyncTime = 0;
  let lastApiSyncTime = 0;
  let lastReconcileTime = Date.now();
  let currentDataTimeMs = 0;
  let currentDataVersion = 0;
  let syncChannel = null;
  let activeDataSource = "loading"; // "loading" | "live" | "published" | "offline" | "rate_limited" | "stale_error" | "error"
  const etagStore = new Map();
  const pageIssuesStore = new Map();

  function safeStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore quota or privacy mode errors
    }
  }

  function initEtagStore() {
    try {
      const raw = safeStorageGet(CACHE_ETAG_STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") etagStore.set(k, v);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  function getStoredEtag(url) {
    return etagStore.get(url) || "";
  }

  function setStoredEtag(url, etag) {
    if (!url || !etag) return;
    etagStore.set(url, etag);
    try {
      safeStorageSet(CACHE_ETAG_STORE_KEY, JSON.stringify(Object.fromEntries(etagStore.entries())));
    } catch {
      // ignore
    }
  }

  function initPageIssuesStore() {
    try {
      const raw = safeStorageGet(CACHE_PAGE_STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed)) {
            if (Array.isArray(v)) pageIssuesStore.set(k, v);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  function getStoredPageIssues(url) {
    return pageIssuesStore.get(url) || null;
  }

  function setStoredPageIssues(url, batch, persist = false) {
    if (!url || !Array.isArray(batch)) return;
    pageIssuesStore.set(url, batch);
    if (persist) {
      persistPageIssuesStore();
    }
  }

  function persistPageIssuesStore() {
    try {
      let totalItems = 0;
      for (const batch of pageIssuesStore.values()) {
        totalItems += batch.length;
      }
      // Avoid exceeding ~5MB localStorage quota on very large inventories
      if (totalItems > 1000) return;
      safeStorageSet(CACHE_PAGE_STORE_KEY, JSON.stringify(Object.fromEntries(pageIssuesStore.entries())));
    } catch {
      // ignore
    }
  }

  function parseTimestampMs(value) {
    if (!value) return 0;
    if (typeof value === "number") return isNaN(value) ? 0 : value;
    const ms = new Date(value).getTime();
    return isNaN(ms) ? 0 : ms;
  }

  function isValidRawIssueArray(data) {
    return Array.isArray(data) && data.every(
      item => item && typeof item === "object" && Number.isInteger(Number(item.number)) && Number(item.number) > 0
    );
  }

  initEtagStore();
  initPageIssuesStore();
  currentDataVersion = Number(safeStorageGet(CACHE_VERSION_KEY) || 0);

  try {
    if (typeof BroadcastChannel !== "undefined") {
      syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
      syncChannel.onmessage = (event) => {
        if (event.data && event.data.type === "issues-sync" && isValidRawIssueArray(event.data.rawIssues)) {
          const incomingMs = event.data.timestampMs || parseTimestampMs(event.data.generatedAt);
          const incomingVer = Number(event.data.version || 0);
          if (incomingMs && currentDataTimeMs) {
            if (incomingMs < currentDataTimeMs) return;
            if (incomingMs === currentDataTimeMs && incomingVer && incomingVer < currentDataVersion) return;
          }
          if (incomingVer) {
            currentDataVersion = Math.max(currentDataVersion, incomingVer);
          }
          applyRawIssues(event.data.rawIssues, event.data.generatedAt, event.data.dataSource || "live", false, false, incomingMs);
        }
      };
    }
  } catch {
    // BroadcastChannel unsupported or blocked
  }

  window.addEventListener("storage", (e) => {
    if (e.key === CACHE_KEY && e.newValue) {
      try {
        const syncSource = safeStorageGet(STORAGE_LAST_SYNC_KEY);
        if (syncSource && Math.abs(Date.now() - Number(syncSource)) < 15000) {
          const newTime = safeStorageGet(CACHE_TIME_KEY);
          const incomingMs = parseTimestampMs(newTime);
          const incomingVer = Number(safeStorageGet(CACHE_VERSION_KEY) || 0);
          if (incomingMs && currentDataTimeMs) {
            if (incomingMs < currentDataTimeMs) return;
            if (incomingMs === currentDataTimeMs && incomingVer && incomingVer < currentDataVersion) return;
          }
          if (incomingVer) {
            currentDataVersion = Math.max(currentDataVersion, incomingVer);
          }
          const newIssues = JSON.parse(e.newValue);
          if (isValidRawIssueArray(newIssues)) {
            applyRawIssues(newIssues, newTime, "live", false, false, incomingMs);
          }
        }
      } catch {
        // ignore
      }
    }
  });

  // DOM Elements Cache
  const el = {};

  function initElements() {
    el.search = document.querySelector("#search");
    el.clearSearch = document.querySelector("#clear-search");
    el.sort = document.querySelector("#sort");
    el.category = document.querySelector("#category");
    el.tickets = document.querySelector("#tickets");
    el.ticketCount = document.querySelector("#ticket-count");
    el.updated = document.querySelector("#updated");
    el.refresh = document.querySelector("#refresh-data");
    el.toggleMotion = document.querySelector("#toggle-motion");
    el.clearFilters = document.querySelector("#clear-filters");
    el.activeFiltersContainer = document.querySelector("#active-filters");
    el.filterChips = document.querySelector("#filter-chips");
    el.loadMoreBar = document.querySelector("#load-more-bar");
    el.loadMoreBtn = document.querySelector("#load-more-btn");

    // Modal elements
    el.modal = document.querySelector("#ticket-modal");
    el.openTicket = document.querySelector("#open-ticket");
    el.closeTicket = document.querySelector("#close-ticket");
    el.dialog = document.querySelector(".modal-dialog");

    // Summary indicators (3 cards)
    el.statTotal = document.querySelector('[data-stat="total"]');
    el.statOpen = document.querySelector('[data-stat="open"]');
    el.statClosed = document.querySelector('[data-stat="closed"]');
    el.statsScope = document.querySelector("#stats-scope");
    el.statCards = document.querySelectorAll(".stat-card[data-filter-stat]");
    el.typeButtons = document.querySelectorAll(".type-btn[data-filter-type]");
  }

  function normalizeText(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function buildSafeIssueUrl(issueNumber, rawUrl) {
    const safeNum = Number(issueNumber);
    const canonical = Number.isInteger(safeNum) && safeNum > 0
      ? `${REPO_URL}/issues/${safeNum}`
      : REPO_URL;

    if (typeof rawUrl !== "string" || !rawUrl.trim()) {
      return canonical;
    }

    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === "https:" && parsed.origin === "https://github.com" && parsed.pathname.startsWith("/ProjectNox-org/project-nox-requests/issues/")) {
        return parsed.href;
      }
    } catch {
      // Invalid URL -> fallback to canonical
    }
    return canonical;
  }

  function formatDate(isoString) {
    if (!isoString) return "—";
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return "—";
      return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      }).format(date);
    } catch {
      return "—";
    }
  }

  function formatRelativeDate(isoString) {
    if (!isoString) return "—";
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return "—";
      const diffMs = Date.now() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) return "hoje";
      if (diffDays === 1) return "ontem";
      if (diffDays < 30) return `há ${diffDays} dias`;
      if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        return `há ${months} ${months === 1 ? "mês" : "meses"}`;
      }
      const years = Math.floor(diffDays / 365);
      return `há ${years} ${years === 1 ? "ano" : "anos"}`;
    } catch {
      return formatDate(isoString);
    }
  }

  // Issue Normalizer: Official `state` ("open" | "closed") is the sole truth for state
  function normalizeIssue(raw) {
    const rawNumber = Number(raw.number);
    const rawLabels = (raw.labels || [])
      .map(l => (typeof l === "string" ? l : (l && l.name) || ""))
      .filter(Boolean);
    const lowerLabels = rawLabels.map(l => l.toLowerCase());

    let type = "other";
    for (const label of lowerLabels) {
      if (TYPE_MAP[label]) {
        type = TYPE_MAP[label];
        break;
      }
    }

    let kind = "general";
    let kindLabel = "Geral";
    let kindIcon = "📌";
    for (const label of lowerLabels) {
      if (KIND_MAP[label]) {
        kind = KIND_MAP[label].key;
        kindLabel = KIND_MAP[label].label;
        kindIcon = KIND_MAP[label].icon;
        break;
      }
    }

    const isOpen = raw.state === "open";
    const isClosed = !isOpen;

    const isAdult = lowerLabels.includes("conteúdo +18") || lowerLabels.includes("content:adult") || lowerLabels.includes("+18");
    const isPriority = lowerLabels.includes("alta prioridade") || lowerLabels.includes("priority:high") || lowerLabels.includes("prioridade");

    const reactions = raw.reactions || {};
    const upvotes = Math.max(0, Number(reactions["+1"] ?? reactions.plus_one ?? 0) || 0);
    const comments = Math.max(0, Number(raw.comments || 0) || 0);

    return {
      number: rawNumber,
      title: String(raw.title || `Solicitação #${rawNumber}`),
      html_url: buildSafeIssueUrl(rawNumber, raw.html_url),
      state: isOpen ? "open" : "closed",
      isOpen,
      isClosed,
      type,
      kind,
      kindLabel,
      kindIcon,
      isAdult,
      isPriority,
      upvotes,
      comments,
      author: String(raw.author?.login || raw.user?.login || "github-user"),
      created_at: raw.created_at || null,
      updated_at: raw.updated_at || raw.created_at || null,
      closed_at: raw.closed_at || null,
      rawLabels
    };
  }

  // Calculate Statistics: Strictly Total = Abertas + Fechadas
  function calculateStats(issues) {
    let open = 0;
    let closed = 0;
    for (const issue of issues) {
      if (issue.isOpen) open++;
      else closed++;
    }
    return {
      total: open + closed,
      open,
      closed
    };
  }

  function updateActiveIndicators() {
    if (el.statCards) {
      el.statCards.forEach(btn => {
        const target = btn.getAttribute("data-filter-stat");
        const isActive = (target === "total" && filters.state === "all") || target === filters.state;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    if (el.typeButtons) {
      el.typeButtons.forEach(btn => {
        const target = btn.getAttribute("data-filter-type");
        const isActive = target === filters.type;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }
  }

  function renderStats() {
    updateActiveIndicators();

    if (!hasLoadedData) {
      if (el.statTotal) el.statTotal.textContent = "—";
      if (el.statOpen) el.statOpen.textContent = "—";
      if (el.statClosed) el.statClosed.textContent = "—";
      if (el.statsScope) el.statsScope.hidden = true;
      return;
    }

    const scopedIssues = filters.type !== "all"
      ? allIssues.filter(i => i.type === filters.type)
      : allIssues;
    const stats = calculateStats(scopedIssues);

    if (el.statTotal) el.statTotal.textContent = String(stats.total);
    if (el.statOpen) el.statOpen.textContent = String(stats.open);
    if (el.statClosed) el.statClosed.textContent = String(stats.closed);

    if (el.statsScope) {
      if (filters.type === "manga") {
        el.statsScope.textContent = "Escopo: Mangás";
        el.statsScope.hidden = false;
      } else if (filters.type === "anime") {
        el.statsScope.textContent = "Escopo: Animes";
        el.statsScope.hidden = false;
      } else {
        el.statsScope.textContent = "";
        el.statsScope.hidden = true;
      }
    }
  }

  // Filter & Sort Issues
  function filterIssues() {
    const searchRaw = filters.search.trim();
    const searchNorm = normalizeText(searchRaw);

    // Exact numeric match only (e.g. "123" or "#123"; "123mangas" will NOT match #123)
    const numberMatch = /^\s*#?(\d+)\s*$/.exec(searchRaw);
    const exactIssueNumber = numberMatch ? Number(numberMatch[1]) : null;

    return allIssues.filter(issue => {
      if (searchNorm) {
        const matchTitle = normalizeText(issue.title).includes(searchNorm);
        const matchAuthor = normalizeText(issue.author).includes(searchNorm);
        const matchNumber = exactIssueNumber !== null && issue.number === exactIssueNumber;
        if (!matchTitle && !matchAuthor && !matchNumber) return false;
      }

      if (filters.type !== "all" && issue.type !== filters.type) return false;
      if (filters.state === "open" && !issue.isOpen) return false;
      if (filters.state === "closed" && !issue.isClosed) return false;
      if (filters.category !== "all" && issue.kind !== filters.category) return false;

      return true;
    }).sort((a, b) => {
      if (filters.sort === "updated") {
        const diffTime = parseTimestampMs(b.updated_at) - parseTimestampMs(a.updated_at);
        if (diffTime !== 0) return diffTime;
        return b.number - a.number;
      }

      if (filters.sort === "oldest") {
        const diffTime = parseTimestampMs(a.created_at) - parseTimestampMs(b.created_at);
        if (diffTime !== 0) return diffTime;
        return a.number - b.number;
      }

      if (filters.sort === "demand") {
        const diff = b.upvotes - a.upvotes;
        if (diff !== 0) return diff;
        const diffTime = parseTimestampMs(b.created_at) - parseTimestampMs(a.created_at);
        if (diffTime !== 0) return diffTime;
        return b.number - a.number;
      }

      // Default: most recent creation first, deterministic number tiebreaker
      const diffTime = parseTimestampMs(b.created_at) - parseTimestampMs(a.created_at);
      if (diffTime !== 0) return diffTime;
      return b.number - a.number;
    });
  }

  function createSvgIcon(pathD, width = 12, height = 12, viewBox = "0 0 24 24") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    return svg;
  }

  // Safe DOM Card Builder (Zero innerHTML with untrusted data)
  function createTicketCard(issue) {
    const card = document.createElement("article");
    card.className = `ticket-card card-state-${issue.state}`;
    card.setAttribute("data-number", String(issue.number));

    const body = document.createElement("div");
    body.className = "ticket-body";

    // Level 1: Title
    const titleEl = document.createElement("h3");
    titleEl.className = "ticket-title";
    titleEl.title = issue.title;
    titleEl.textContent = issue.title;
    body.appendChild(titleEl);

    // Level 2: Native State (ABERTA / FECHADA)
    const statusRow = document.createElement("div");
    statusRow.className = "ticket-status-row";

    const stateBadge = document.createElement("span");
    stateBadge.className = `badge-state ${issue.isOpen ? "state-open" : "state-closed"}`;
    const dot = document.createElement("span");
    dot.className = `state-dot ${issue.isOpen ? "open-dot" : "closed-dot"}`;
    dot.setAttribute("aria-hidden", "true");
    stateBadge.appendChild(dot);
    stateBadge.appendChild(document.createTextNode(issue.isOpen ? "ABERTA" : "FECHADA"));
    statusRow.appendChild(stateBadge);
    body.appendChild(statusRow);

    // Level 3: Type & Category
    const tagsRow = document.createElement("div");
    tagsRow.className = "ticket-tags-row";

    if (issue.type === "manga") {
      const mangaTag = document.createElement("span");
      mangaTag.className = "badge-tag tag-manga";
      mangaTag.textContent = "📖 Mangá";
      tagsRow.appendChild(mangaTag);
    } else if (issue.type === "anime") {
      const animeTag = document.createElement("span");
      animeTag.className = "badge-tag tag-anime";
      animeTag.textContent = "📺 Anime";
      tagsRow.appendChild(animeTag);
    }

    const kindTag = document.createElement("span");
    kindTag.className = "badge-tag tag-kind";
    kindTag.textContent = `${issue.kindIcon} ${issue.kindLabel}`;
    tagsRow.appendChild(kindTag);

    if (issue.isAdult) {
      const adultTag = document.createElement("span");
      adultTag.className = "badge-tag tag-adult";
      adultTag.textContent = "+18";
      tagsRow.appendChild(adultTag);
    }

    if (issue.isPriority) {
      const priorityTag = document.createElement("span");
      priorityTag.className = "badge-tag tag-priority";
      priorityTag.textContent = "★ Prioridade";
      tagsRow.appendChild(priorityTag);
    }

    body.appendChild(tagsRow);

    // Level 4: Votes & Metadata
    const metaRow = document.createElement("div");
    metaRow.className = "ticket-meta-row";

    const numEl = document.createElement("span");
    numEl.className = "meta-item meta-number";
    numEl.textContent = `#${issue.number}`;
    metaRow.appendChild(numEl);

    const votesEl = document.createElement("span");
    votesEl.className = `meta-item meta-votes${issue.upvotes > 0 ? " has-votes" : ""}`;
    votesEl.textContent = `👍 ${issue.upvotes} ${issue.upvotes === 1 ? "voto" : "votos"}`;
    metaRow.appendChild(votesEl);

    const authorEl = document.createElement("span");
    authorEl.className = "meta-item meta-author";
    authorEl.appendChild(createSvgIcon("M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"));
    authorEl.appendChild(document.createTextNode(`@${issue.author}`));
    metaRow.appendChild(authorEl);

    const dateEl = document.createElement("span");
    dateEl.className = "meta-item meta-date";
    dateEl.title = `Criada em ${formatDate(issue.created_at)} • Atualizada em ${formatDate(issue.updated_at)}`;
    dateEl.appendChild(createSvgIcon("M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"));
    dateEl.appendChild(document.createTextNode(formatRelativeDate(filters.sort === "updated" ? issue.updated_at : issue.created_at)));
    metaRow.appendChild(dateEl);

    if (issue.comments > 0) {
      const commentsEl = document.createElement("span");
      commentsEl.className = "meta-item meta-comments";
      commentsEl.title = `${issue.comments} ${issue.comments === 1 ? "comentário" : "comentários"}`;
      commentsEl.appendChild(createSvgIcon("M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"));
      commentsEl.appendChild(document.createTextNode(String(issue.comments)));
      metaRow.appendChild(commentsEl);
    }

    body.appendChild(metaRow);
    card.appendChild(body);

    // Action Footer
    const footer = document.createElement("div");
    footer.className = "ticket-footer";

    const link = document.createElement("a");
    link.className = "ticket-link";
    link.href = issue.html_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `Ver solicitação #${issue.number} no GitHub: ${issue.title}`);
    link.appendChild(document.createTextNode(issue.isOpen ? "Ver e votar no GitHub" : "Ver solicitação no GitHub"));
    link.appendChild(createSvgIcon("M6 6v2h8.59L3.29 19.29l1.42 1.42L16 9.41V18h2V6z", 13, 13));

    footer.appendChild(link);
    card.appendChild(footer);

    return card;
  }

  // Safe DOM Filter Chips
  function renderFilterChips() {
    if (!el.activeFiltersContainer || !el.filterChips) return;

    const chips = [];

    if (filters.search) {
      chips.push({ label: `Busca: "${filters.search}"`, key: "search" });
    }
    if (filters.type !== defaults.type) {
      const typeLabels = { manga: "Mangás", anime: "Animes" };
      chips.push({ label: `Tipo: ${typeLabels[filters.type] || filters.type}`, key: "type" });
    }
    if (filters.state !== defaults.state) {
      const stateLabels = { all: "Todas", closed: "Fechadas", open: "Abertas" };
      chips.push({ label: `Estado: ${stateLabels[filters.state] || filters.state}`, key: "state" });
    }
    if (filters.category !== defaults.category) {
      const catLabels = {
        "new-extension": "Nova extensão",
        "bug": "Problema na extensão",
        "domain": "Mudança de domínio",
        "dead-source": "Fonte indisponível",
        "enhancement": "Sugestão"
      };
      chips.push({ label: `Categoria: ${catLabels[filters.category] || filters.category}`, key: "category" });
    }
    if (filters.sort !== defaults.sort) {
      const sortLabels = {
        "recent": "Mais recentes",
        "updated": "Atualizados recentemente",
        "demand": "Mais votados",
        "oldest": "Mais antigos"
      };
      chips.push({ label: `Ordem: ${sortLabels[filters.sort] || filters.sort}`, key: "sort" });
    }

    if (chips.length > 0) {
      el.activeFiltersContainer.hidden = false;
      const frag = document.createDocumentFragment();
      for (const chip of chips) {
        const btn = document.createElement("button");
        btn.className = "chip";
        btn.type = "button";
        btn.setAttribute("data-clear-filter", chip.key);
        btn.setAttribute("aria-label", `Remover filtro ${chip.label}`);

        const labelSpan = document.createElement("span");
        labelSpan.textContent = chip.label;
        const removeSpan = document.createElement("span");
        removeSpan.className = "chip-remove";
        removeSpan.setAttribute("aria-hidden", "true");
        removeSpan.textContent = "×";

        btn.appendChild(labelSpan);
        btn.appendChild(removeSpan);
        frag.appendChild(btn);
      }
      el.filterChips.replaceChildren(frag);
    } else {
      el.activeFiltersContainer.hidden = true;
      el.filterChips.replaceChildren();
    }
  }

  function renderStateMessage({ icon, title, description, actions = [] }) {
    const box = document.createElement("div");
    box.className = "empty-state";

    const iconEl = document.createElement("div");
    iconEl.className = "empty-icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = icon;

    const h3 = document.createElement("h3");
    h3.textContent = title;

    const p = document.createElement("p");
    p.textContent = description;

    box.appendChild(iconEl);
    box.appendChild(h3);
    box.appendChild(p);

    if (actions.length > 0) {
      const actionsWrap = document.createElement("div");
      actionsWrap.className = "empty-actions";
      for (const act of actions) {
        if (act.href) {
          const a = document.createElement("a");
          a.className = "button secondary";
          a.href = act.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = act.label;
          actionsWrap.appendChild(a);
        } else {
          const btn = document.createElement("button");
          btn.className = "button secondary";
          btn.type = "button";
          btn.textContent = act.label;
          btn.addEventListener("click", act.onClick);
          actionsWrap.appendChild(btn);
        }
      }
      box.appendChild(actionsWrap);
    }

    el.tickets.replaceChildren(box);
  }

  function formatResultsCountText(count) {
    if (!hasLoadedData) {
      return activeDataSource === "error"
        ? "Falha ao carregar solicitações"
        : "Carregando solicitações...";
    }

    const hasSearchOrCat = Boolean(filters.search.trim()) || filters.category !== "all";
    if (hasSearchOrCat) {
      return `${count} ${count === 1 ? "resultado encontrado" : "resultados encontrados"}`;
    }

    const scopeSuffix = filters.type === "manga" ? " em Mangás" : filters.type === "anime" ? " em Animes" : "";
    if (filters.state === "open") {
      return `${count} ${count === 1 ? "solicitação aberta" : "solicitações abertas"}${scopeSuffix}`;
    }
    if (filters.state === "closed") {
      return `${count} ${count === 1 ? "solicitação fechada" : "solicitações fechadas"}${scopeSuffix}`;
    }
    return `${count} ${count === 1 ? "solicitação no total" : "solicitações no total"}${scopeSuffix}`;
  }

  // Render Tickets List
  function renderTickets({ preserveScroll = false } = {}) {
    const scrollY = preserveScroll ? (window.scrollY || window.pageYOffset || 0) : 0;
    const scrollX = preserveScroll ? (window.scrollX || window.pageXOffset || 0) : 0;

    renderFilterChips();
    renderStats();

    if (!hasLoadedData) {
      if (el.ticketCount) el.ticketCount.textContent = formatResultsCountText(0);
      if (el.loadMoreBar) el.loadMoreBar.hidden = true;

      if (activeDataSource === "error") {
        renderStateMessage({
          icon: "⚠️",
          title: "Não foi possível carregar as solicitações.",
          description: "Verifique sua conexão e tente novamente ou acesse diretamente o repositório no GitHub.",
          actions: [
            { label: "Tentar novamente", onClick: () => loadData(true) },
            { label: "Abrir Central no GitHub", href: `${REPO_URL}/issues` }
          ]
        });
      } else {
        renderStateMessage({
          icon: "⏳",
          title: "Carregando solicitações...",
          description: "Buscando os dados mais recentes do Project Nox."
        });
      }
      return;
    }

    const filtered = filterIssues();
    const count = filtered.length;

    if (el.ticketCount) {
      el.ticketCount.textContent = formatResultsCountText(count);
    }

    if (count === 0) {
      if (el.loadMoreBar) el.loadMoreBar.hidden = true;
      renderStateMessage({
        icon: "🔍",
        title: "Nenhuma solicitação encontrada.",
        description: "Experimente outro termo ou restaure os filtros padrão.",
        actions: [{ label: "Restaurar filtros padrão", onClick: resetAllFilters }]
      });
      if (preserveScroll && (scrollY > 0 || scrollX > 0)) {
        window.scrollTo(scrollX, scrollY);
      }
      return;
    }

    const limit = Math.min(count, visibleCount);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < limit; i++) {
      fragment.appendChild(createTicketCard(filtered[i]));
    }
    el.tickets.replaceChildren(fragment);

    if (el.loadMoreBar && el.loadMoreBtn) {
      const remaining = count - limit;
      if (remaining > 0) {
        el.loadMoreBar.hidden = false;
        el.loadMoreBtn.textContent = `Mostrar mais (${remaining} restantes)`;
      } else {
        el.loadMoreBar.hidden = true;
      }
    }

    if (preserveScroll && (scrollY > 0 || scrollX > 0)) {
      window.scrollTo(scrollX, scrollY);
    }
  }

  // URL Synchronization (with safe handling for legacy status/resolution params)
  function syncToUrl() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== defaults[key] && val !== "") {
        params.set(key, String(val));
      }
    });
    const query = params.toString();
    const newUrl = `${location.pathname}${query ? `?${query}` : ""}`;
    history.replaceState(null, "", newUrl);
  }

  function syncFromUrl() {
    Object.assign(filters, defaults);
    const params = new URLSearchParams(location.search);

    const typeParam = params.get("type");
    if (VALID_TYPES.has(typeParam)) filters.type = typeParam;

    const stateParam = params.get("state");
    if (VALID_STATES.has(stateParam)) filters.state = stateParam;

    const catParam = params.get("category");
    if (VALID_CATEGORIES.has(catParam)) filters.category = catParam;

    const sortParam = params.get("sort");
    if (sortParam === "newest") {
      filters.sort = "recent";
    } else if (VALID_SORTS.has(sortParam)) {
      filters.sort = sortParam;
    }

    if (params.has("search")) {
      filters.search = String(params.get("search") || "").slice(0, 200);
    }

    if (params.get("modal") === "open" || params.has("novo") || params.has("open")) {
      openModal();
    }

    applyInputsFromFilters();
  }

  function applyInputsFromFilters() {
    if (el.search) el.search.value = filters.search;
    if (el.clearSearch) el.clearSearch.hidden = !filters.search;
    if (el.sort) el.sort.value = filters.sort;
    if (el.category) el.category.value = filters.category;
    updateActiveIndicators();
  }

  function resetAllFilters() {
    Object.assign(filters, defaults);
    visibleCount = PAGE_SIZE;
    applyInputsFromFilters();
    syncToUrl();
    renderTickets();
  }

  // Modal Management
  function openModal() {
    if (!el.modal) return;
    lastFocus = document.activeElement;
    el.modal.hidden = false;
    document.body.classList.add("modal-open");
    const appContent = document.querySelector(".app-content");
    if (appContent) {
      appContent.setAttribute("aria-hidden", "true");
      appContent.inert = true;
    }
    if (el.dialog) el.dialog.focus();
  }

  function closeModal() {
    if (!el.modal || el.modal.hidden) return;
    el.modal.hidden = true;
    document.body.classList.remove("modal-open");
    const appContent = document.querySelector(".app-content");
    if (appContent) {
      appContent.removeAttribute("aria-hidden");
      appContent.inert = false;
    }
    if (lastFocus && typeof lastFocus.focus === "function") {
      lastFocus.focus();
    }
  }

  function handleModalKeyDown(e) {
    if (!el.modal || el.modal.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === "Tab") {
      const focusables = el.dialog.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && (document.activeElement === first || document.activeElement === el.dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function syncMotionButtonUI() {
    if (!el.toggleMotion) return;
    const api = window.__noxParticles;
    const isPaused = api ? api.isPaused() : document.documentElement.classList.contains("animations-paused");
    const isReduced = api ? api.isReducedMotion() : false;

    el.toggleMotion.setAttribute("aria-pressed", isPaused ? "true" : "false");
    const iconEl = el.toggleMotion.querySelector(".motion-icon");
    const labelEl = el.toggleMotion.querySelector(".motion-label");

    if (isReduced) {
      el.toggleMotion.disabled = true;
      el.toggleMotion.title = "Animações reduzidas pela preferência do sistema";
      if (iconEl) iconEl.textContent = "⏸";
      if (labelEl) labelEl.textContent = "Movimento reduzido";
    } else {
      el.toggleMotion.disabled = false;
      el.toggleMotion.title = isPaused ? "Retomar animações decorativas" : "Pausar animações decorativas";
      if (iconEl) iconEl.textContent = isPaused ? "▶" : "⏸";
      if (labelEl) labelEl.textContent = isPaused ? "Retomar animações" : "Pausar animações";
    }
  }

  // Setup Event Listeners
  function setupListeners() {
    // 3 Summary Stat Buttons (Total, Abertas, Fechadas)
    if (el.statCards) {
      el.statCards.forEach(btn => {
        btn.addEventListener("click", () => {
          const statType = btn.getAttribute("data-filter-stat");
          if (statType === "total") filters.state = "all";
          else if (statType === "open") filters.state = "open";
          else if (statType === "closed") filters.state = "closed";
          visibleCount = PAGE_SIZE;
          syncToUrl();
          renderTickets();
        });
      });
    }

    // Type Segmented Buttons (Todos | Mangás | Animes)
    if (el.typeButtons) {
      el.typeButtons.forEach(btn => {
        btn.addEventListener("click", () => {
          const typeVal = btn.getAttribute("data-filter-type");
          if (VALID_TYPES.has(typeVal)) {
            filters.type = typeVal;
            visibleCount = PAGE_SIZE;
            syncToUrl();
            renderTickets();
          }
        });
      });
    }

    // Search input
    let searchDebounce = null;
    if (el.search) {
      el.search.addEventListener("input", e => {
        const val = e.target.value;
        if (el.clearSearch) el.clearSearch.hidden = !val;
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
          filters.search = val;
          visibleCount = PAGE_SIZE;
          syncToUrl();
          renderTickets();
        }, 120);
      });
    }

    if (el.clearSearch) {
      el.clearSearch.addEventListener("click", () => {
        el.search.value = "";
        el.clearSearch.hidden = true;
        filters.search = "";
        visibleCount = PAGE_SIZE;
        syncToUrl();
        renderTickets();
        el.search.focus();
      });
    }

    // Sort & Category selectors
    ["sort", "category"].forEach(key => {
      if (el[key]) {
        el[key].addEventListener("change", e => {
          filters[key] = e.target.value;
          visibleCount = PAGE_SIZE;
          syncToUrl();
          renderTickets();
        });
      }
    });

    if (el.clearFilters) {
      el.clearFilters.addEventListener("click", resetAllFilters);
    }

    if (el.filterChips) {
      el.filterChips.addEventListener("click", e => {
        const chipBtn = e.target.closest("[data-clear-filter]");
        if (chipBtn) {
          const filterKey = chipBtn.getAttribute("data-clear-filter");
          if (filterKey && filterKey in filters) {
            filters[filterKey] = defaults[filterKey];
            visibleCount = PAGE_SIZE;
            applyInputsFromFilters();
            syncToUrl();
            renderTickets();
          }
        }
      });
    }

    if (el.loadMoreBtn) {
      el.loadMoreBtn.addEventListener("click", () => {
        visibleCount += PAGE_SIZE;
        renderTickets({ preserveScroll: true });
      });
    }

    // Modal listeners
    if (el.openTicket) el.openTicket.addEventListener("click", openModal);
    if (el.closeTicket) el.closeTicket.addEventListener("click", closeModal);
    if (el.modal) {
      el.modal.addEventListener("click", e => {
        if (e.target.hasAttribute("data-close-modal") || e.target === el.modal) {
          closeModal();
        }
      });
      window.addEventListener("keydown", handleModalKeyDown);
    }

    if (el.refresh) {
      el.refresh.addEventListener("click", () => {
        refreshLive({ manual: true });
      });
    }

    if (el.toggleMotion) {
      syncMotionButtonUI();
      el.toggleMotion.addEventListener("click", () => {
        if (window.__noxParticles) {
          window.__noxParticles.toggle();
        } else {
          document.documentElement.classList.toggle("animations-paused");
        }
        syncMotionButtonUI();
      });
      window.addEventListener("nox:motion-change", syncMotionButtonUI);
    }

    // Global '/' shortcut to focus search (only when not editing text or in modal)
    window.addEventListener("keydown", e => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (el.modal && !el.modal.hidden) return;
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable)) {
        return;
      }
      e.preventDefault();
      el.search?.focus();
      el.search?.select();
    });

    window.addEventListener("popstate", () => {
      syncFromUrl();
      renderTickets();
    });
  }

  // Live GitHub Synchronization & Adaptive Polling
  function getGitHubApiBase() {
    return window.__NOX_API_BASE__ || GITHUB_API_BASE;
  }

  function dataSignature(issues) {
    return (issues || [])
      .map(i => [
        i.number,
        i.state,
        i.title,
        i.updated_at || "",
        (i.rawLabels || []).slice().sort().join(","),
        i.upvotes || 0,
        i.comments || 0
      ].join("|"))
      .sort()
      .join("\n");
  }

  function parseRateLimitHeaders(res) {
    if (!res || !res.headers) return false;
    const remainingHeader = res.headers.get("x-ratelimit-remaining");
    const resetHeader = res.headers.get("x-ratelimit-reset");
    const retryAfterHeader = res.headers.get("retry-after");

    if (remainingHeader !== null) {
      const parsedRemaining = parseInt(remainingHeader, 10);
      if (!isNaN(parsedRemaining)) {
        rateLimitRemaining = parsedRemaining;
      }
    }

    const resetSec = resetHeader ? parseInt(resetHeader, 10) : 0;
    const retrySec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;

    if (res.status === 403 || res.status === 429 || rateLimitRemaining === 0) {
      const resetAt = resetSec > 0 ? resetSec * 1000 : 0;
      const retryAt = retrySec > 0 ? Date.now() + retrySec * 1000 : 0;
      rateLimitUntil = Math.max(rateLimitUntil, resetAt, retryAt, Date.now() + 60 * 1000);
      return true;
    }
    return false;
  }

  function hasNextLink(linkHeader) {
    if (!linkHeader || typeof linkHeader !== "string") return false;
    return /rel="next"/.test(linkHeader);
  }

  function nextPollDelay() {
    if (window.__NOX_POLL_INTERVAL__) {
      return Number(window.__NOX_POLL_INTERVAL__);
    }
    return CHECK_INTERVAL;
  }

  function scheduleNextPoll(delayMs) {
    clearTimeout(pollTimer);
    pollTimer = null;
    if (document.visibilityState === "hidden") {
      return;
    }
    const delay = typeof delayMs === "number" ? delayMs : nextPollDelay();
    pollTimer = setTimeout(() => {
      refreshLive();
    }, delay);
  }

  function shouldQueryGitHubApi(manual) {
    if (manual) return true;
    if (rateLimitUntil > Date.now()) return false;

    const minApiInterval = window.__NOX_POLL_INTERVAL__
      ? Number(window.__NOX_POLL_INTERVAL__)
      : (rateLimitRemaining !== null && rateLimitRemaining < 15 ? THROTTLED_API_INTERVAL : GITHUB_API_MIN_INTERVAL);

    let storedLastApi = 0;
    const rawStored = safeStorageGet(STORAGE_LAST_API_SYNC_KEY);
    if (rawStored) storedLastApi = Number(rawStored) || 0;
    const effectiveLast = Math.max(lastApiSyncTime, storedLastApi);

    return (Date.now() - effectiveLast) >= minApiInterval;
  }

  async function fetchStaticSnapshotIfUpdated() {
    try {
      const headers = { "Accept": "application/json" };
      if (snapshotEtag) {
        headers["If-None-Match"] = snapshotEtag;
      }
      const res = await fetch(DATA_URL, {
        cache: "no-cache",
        headers
      });
      if (res.status === 304) {
        return { notModified: true };
      }
      if (!res.ok) return null;
      const etag = res.headers.get("etag");
      if (etag) snapshotEtag = etag;
      const json = await res.json();
      if (json && Array.isArray(json.issues)) {
        return {
          issues: json.issues,
          generated_at: json.generated_at || null
        };
      }
    } catch {
      // ignore snapshot check error
    }
    return null;
  }

  async function fetchLiveIssuesFromGitHub({ manual = false, isFullReconcile = false } = {}) {
    const apiBase = getGitHubApiBase();
    const all = [];
    const seen = new Set();
    let page = 1;
    const isFull = manual || isFullReconcile;
    const maxPages = isFull ? MAX_SAFE_PAGES : 1;
    const sortParam = isFull ? "created" : "updated";
    let all304 = true;
    let pagesChecked = 0;
    let incomplete = false;

    while (page <= maxPages) {
      const targetUrl = `${apiBase}?state=all&per_page=100&page=${page}&sort=${sortParam}&direction=desc`;
      const headers = {
        "Accept": "application/vnd.github+json"
      };
      const cachedEtag = getStoredEtag(targetUrl);
      const cachedBatch = getStoredPageIssues(targetUrl);

      const canSendEtag = !manual && Boolean(cachedEtag) && (!isFull || (Array.isArray(cachedBatch) && cachedBatch.length > 0));
      if (canSendEtag) {
        headers["If-None-Match"] = cachedEtag;
      }

      const res = await fetch(targetUrl, { headers });
      const isRateLimited = parseRateLimitHeaders(res);

      if (res.status === 304) {
        pagesChecked++;
        if (!isFull) {
          return { notModified: true, incomplete: false };
        }
        if (Array.isArray(cachedBatch) && cachedBatch.length > 0) {
          for (const item of cachedBatch) {
            if (item && !item.pull_request && Number.isInteger(Number(item.number)) && Number(item.number) > 0 && !seen.has(item.number)) {
              seen.add(item.number);
              all.push(item);
            }
          }
          if (cachedBatch.length < 100) break;
          if (page >= maxPages) {
            incomplete = true;
            break;
          }
          page++;
          continue;
        } else {
          incomplete = true;
          break;
        }
      }

      all304 = false;

      if (!res.ok) {
        if (res.status === 403 || res.status === 429 || isRateLimited) {
          throw new Error("RATE_LIMITED");
        }
        throw new Error(`HTTP_${res.status}`);
      }

      pagesChecked++;
      const newEtag = res.headers.get("etag");
      if (newEtag) {
        setStoredEtag(targetUrl, newEtag);
      }

      const batch = await res.json();
      if (!Array.isArray(batch)) {
        throw new Error("INVALID_PAYLOAD");
      }

      if (batch.length === 0) break;

      if (isFull) {
        setStoredPageIssues(targetUrl, batch);
      }

      for (const item of batch) {
        if (item && !item.pull_request && Number.isInteger(Number(item.number)) && Number(item.number) > 0 && !seen.has(item.number)) {
          seen.add(item.number);
          all.push(item);
        }
      }

      const linkHeader = res.headers.get("link");
      const morePages = linkHeader ? hasNextLink(linkHeader) : batch.length >= 100;
      if (!morePages || batch.length < 100) break;

      if (page >= maxPages) {
        incomplete = true;
        break;
      }
      page++;
    }

    if (isFull && pagesChecked > 0 && all304) {
      return { notModified: true, incomplete: false };
    }

    if (isFull && all.length > 0) {
      persistPageIssuesStore();
    }

    return { issues: all, incomplete, notModified: false };
  }

  function mergeRawIssues(existing, fresh) {
    if (!Array.isArray(existing) || existing.length === 0) {
      return fresh;
    }
    const map = new Map(existing.map(i => [i.number, i]));
    for (const item of fresh) {
      if (item && !item.pull_request && Number.isInteger(Number(item.number)) && Number(item.number) > 0) {
        map.set(item.number, item);
      }
    }
    return Array.from(map.values());
  }

  function updateStatusText(dataSource) {
    if (!el.updated) return;
    activeDataSource = dataSource;
    el.updated.classList.remove("is-stale", "is-error");

    const snapTime = generatedAt
      ? new Date(generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : "";
    const snapDate = generatedAt ? formatDate(generatedAt) : "";
    const checkedTime = lastCheckedAt
      ? new Date(lastCheckedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "";

    if (dataSource === "live") {
      el.updated.textContent = checkedTime
        ? `Atualizado agora (${checkedTime})`
        : "Atualizado agora";
      el.updated.title = generatedAt ? `Dados sincronizados • Snapshot: ${snapDate} ${snapTime}` : "";
    } else if (dataSource === "published") {
      el.updated.textContent = snapTime
        ? `Snapshot publicado: ${snapDate} às ${snapTime}`
        : "Snapshot publicado";
      el.updated.title = checkedTime ? `Última verificação às ${checkedTime}` : "";
    } else if (dataSource === "offline") {
      el.updated.classList.add("is-stale");
      el.updated.textContent = "Exibindo os últimos dados disponíveis (offline).";
      el.updated.title = generatedAt ? `Cache de ${snapDate} ${snapTime}` : "";
    } else if (dataSource === "rate_limited") {
      el.updated.classList.add("is-stale");
      el.updated.textContent = "Exibindo os últimos dados disponíveis. A atualização será retomada automaticamente.";
      el.updated.title = "Limite temporário da API pública do GitHub atingido";
    } else if (dataSource === "stale_error") {
      el.updated.classList.add("is-stale");
      el.updated.textContent = "Exibindo os últimos dados disponíveis. A atualização será retomada automaticamente.";
      el.updated.title = "Falha temporária na consulta ao vivo";
    } else if (dataSource === "error") {
      el.updated.classList.add("is-error");
      el.updated.textContent = "Não foi possível carregar as solicitações.";
      el.updated.title = "";
    } else {
      el.updated.textContent = "Sincronizando...";
    }
  }

  function applyRawIssues(rawIssues, timestamp, dataSource = "live", broadcast = true, forceLive = false, explicitMs = null) {
    if (!Array.isArray(rawIssues)) return false;

    const validRaw = rawIssues.filter(item => item && !item.pull_request && Number.isInteger(Number(item.number)) && Number(item.number) > 0);

    const incomingMs = explicitMs || parseTimestampMs(timestamp);
    if (!forceLive && hasLoadedData && incomingMs && currentDataTimeMs && incomingMs < currentDataTimeMs) {
      return false;
    }

    currentRawIssues = validRaw;
    if (timestamp) generatedAt = timestamp;
    if (incomingMs) {
      currentDataTimeMs = Math.max(currentDataTimeMs, incomingMs);
    } else {
      currentDataTimeMs = Math.max(currentDataTimeMs, Date.now());
    }
    currentDataVersion++;
    hasLoadedData = true;

    const normalized = validRaw.map(normalizeIssue);
    const newSignature = dataSignature(normalized);
    const hasChanged = newSignature !== currentSignature;

    if (hasChanged || allIssues.length === 0) {
      allIssues = normalized;
      currentSignature = newSignature;
      renderTickets({ preserveScroll: true });
    }

    updateStatusText(dataSource);

    if (dataSource === "live") {
      safeStorageSet(STORAGE_LAST_SYNC_KEY, String(Date.now()));
    }
    if (generatedAt) safeStorageSet(CACHE_TIME_KEY, String(generatedAt));
    safeStorageSet(CACHE_SIG_KEY, newSignature);
    safeStorageSet(CACHE_VERSION_KEY, String(currentDataVersion));
    safeStorageSet(CACHE_KEY, JSON.stringify(validRaw));

    if (broadcast && syncChannel && hasChanged) {
      try {
        syncChannel.postMessage({
          type: "issues-sync",
          rawIssues: validRaw,
          generatedAt,
          dataSource,
          timestampMs: currentDataTimeMs,
          version: currentDataVersion,
          signature: newSignature
        });
      } catch {
        // ignore
      }
    }

    return hasChanged;
  }

  async function refreshLive({ manual = false } = {}) {
    if (!manual && document.visibilityState === "hidden") {
      return;
    }
    if (isFetching) {
      if (manual) pendingManualRefresh = true;
      return;
    }

    isFetching = true;
    window.__NOX_IS_FETCHING__ = true;
    if (manual && el.refresh) {
      el.refresh.disabled = true;
      el.refresh.classList.add("spinning");
    }

    try {
      // 1. Always perform lightweight static snapshot check (0 GitHub API quota cost)
      const snapResult = await fetchStaticSnapshotIfUpdated();
      if (snapResult && Array.isArray(snapResult.issues)) {
        const snapMs = parseTimestampMs(snapResult.generated_at);
        if (!hasLoadedData || snapMs > currentDataTimeMs) {
          lastCheckedAt = Date.now();
          applyRawIssues(snapResult.issues, snapResult.generated_at, "published", true, false, snapMs);
        }
      }

      // 2. Query GitHub API only when allowed by rate-limit budget (or manual / controlled test)
      if (shouldQueryGitHubApi(manual)) {
        let storedLastReconcile = Number(safeStorageGet(STORAGE_LAST_RECONCILE_KEY) || 0);
        const effectiveLastReconcile = Math.max(lastReconcileTime, storedLastReconcile);
        const reconcileInterval = window.__NOX_RECONCILE_INTERVAL__ || RECONCILE_INTERVAL;
        const isDueForReconcile = (Date.now() - effectiveLastReconcile >= reconcileInterval);
        const hasQuotaForReconcile = (rateLimitRemaining === null || rateLimitRemaining >= 15);
        const isFullReconcile = manual || ((isDueForReconcile && hasQuotaForReconcile) || !!window.__NOX_FORCE_RECONCILE__);

        const freshResult = await fetchLiveIssuesFromGitHub({ manual, isFullReconcile });
        lastApiSyncTime = Date.now();
        lastSyncTime = lastApiSyncTime;
        lastCheckedAt = lastApiSyncTime;
        safeStorageSet(STORAGE_LAST_API_SYNC_KEY, String(lastApiSyncTime));
        safeStorageSet(STORAGE_LAST_SYNC_KEY, String(lastApiSyncTime));

        if (freshResult && freshResult.notModified) {
          if (isFullReconcile) {
            lastReconcileTime = lastApiSyncTime;
            safeStorageSet(STORAGE_LAST_RECONCILE_KEY, String(lastApiSyncTime));
          }
          if (hasLoadedData) {
            updateStatusText("live");
          }
        } else if (freshResult && Array.isArray(freshResult.issues)) {
          // Never overwrite full catalog with an incomplete reconciliation!
          const canReplaceCatalog = isFullReconcile && !freshResult.incomplete;
          const merged = canReplaceCatalog
            ? freshResult.issues
            : mergeRawIssues(currentRawIssues, freshResult.issues);

          applyRawIssues(merged, new Date().toISOString(), "live", true, manual);

          if (canReplaceCatalog) {
            lastReconcileTime = lastApiSyncTime;
            safeStorageSet(STORAGE_LAST_RECONCILE_KEY, String(lastApiSyncTime));
          }
        }
      } else {
        // Still check if another tab updated cache recently
        const cachedStr = safeStorageGet(CACHE_KEY);
        const cachedTime = safeStorageGet(CACHE_TIME_KEY);
        const cachedSig = safeStorageGet(CACHE_SIG_KEY);
        if (cachedStr && cachedSig && cachedSig !== currentSignature) {
          const cachedJson = JSON.parse(cachedStr);
          if (isValidRawIssueArray(cachedJson)) {
            applyRawIssues(cachedJson, cachedTime, "live", false, false, parseTimestampMs(cachedTime));
          }
        }
      }
    } catch (err) {
      const isRateLimit = err && err.message === "RATE_LIMITED";
      const dataSource = isRateLimit ? "rate_limited" : "stale_error";
      console.warn("Live GitHub API query failed or rate-limited:", err);
      if (hasLoadedData) {
        updateStatusText(dataSource);
      }
    } finally {
      isFetching = false;
      window.__NOX_IS_FETCHING__ = false;
      if (manual && el.refresh) {
        setTimeout(() => {
          if (el.refresh) {
            el.refresh.disabled = false;
            el.refresh.classList.remove("spinning");
          }
        }, 400);
      }
      if (pendingManualRefresh) {
        pendingManualRefresh = false;
        setTimeout(() => refreshLive({ manual: true }), 100);
      } else {
        scheduleNextPoll();
      }
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "hidden") {
      clearTimeout(pollTimer);
      pollTimer = null;
    } else if (document.visibilityState === "visible") {
      const elapsed = Date.now() - lastSyncTime;
      const delay = nextPollDelay();
      if (elapsed >= delay) {
        refreshLive();
      } else {
        scheduleNextPoll(delay - elapsed);
      }
    }
  }

  // Initial Data Load
  async function loadData(forceLive = false) {
    let rawIssues = null;
    let dataSource = "published";

    if (forceLive) {
      try {
        const res = await fetchLiveIssuesFromGitHub({ manual: true });
        if (res && Array.isArray(res.issues) && !res.incomplete) {
          rawIssues = res.issues;
          generatedAt = new Date().toISOString();
          lastCheckedAt = Date.now();
          lastApiSyncTime = lastCheckedAt;
          lastSyncTime = lastCheckedAt;
          lastReconcileTime = lastCheckedAt;
          dataSource = "live";
          safeStorageSet(STORAGE_LAST_API_SYNC_KEY, String(lastCheckedAt));
          safeStorageSet(STORAGE_LAST_SYNC_KEY, String(lastCheckedAt));
          safeStorageSet(STORAGE_LAST_RECONCILE_KEY, String(lastCheckedAt));
        }
      } catch (err) {
        const isRateLimit = err && err.message === "RATE_LIMITED";
        dataSource = isRateLimit ? "rate_limited" : "stale_error";
      }
    }

    if (!rawIssues) {
      let cachedIssues = null;
      let cachedTime = null;
      try {
        const cachedStr = safeStorageGet(CACHE_KEY);
        cachedTime = safeStorageGet(CACHE_TIME_KEY);
        if (cachedStr) {
          const parsed = JSON.parse(cachedStr);
          if (isValidRawIssueArray(parsed)) cachedIssues = parsed;
        }
      } catch {
        // ignore
      }

      try {
        const res = await fetch(`${DATA_URL}?_t=${Date.now()}`, {
          cache: "no-store",
          headers: { "Accept": "application/json" }
        });
        if (res.ok) {
          const etag = res.headers.get("etag");
          if (etag) snapshotEtag = etag;
          const json = await res.json();
          if (json && Array.isArray(json.issues)) {
            const staticTime = parseTimestampMs(json.generated_at);
            const cacheTimeVal = parseTimestampMs(cachedTime);

            if (cachedIssues && cacheTimeVal > staticTime) {
              rawIssues = cachedIssues;
              generatedAt = cachedTime;
              dataSource = "live";
            } else {
              rawIssues = json.issues;
              generatedAt = json.generated_at || new Date().toISOString();
              dataSource = "published";
            }
          }
        }
      } catch (err) {
        console.warn("Could not load local issues.json:", err);
      }
    }

    if (!rawIssues) {
      try {
        const cached = safeStorageGet(CACHE_KEY);
        const cachedTime = safeStorageGet(CACHE_TIME_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (isValidRawIssueArray(parsed)) {
            rawIssues = parsed;
            generatedAt = cachedTime || generatedAt;
            dataSource = "offline";
          }
        }
      } catch {
        // ignore
      }
    }

    if (Array.isArray(rawIssues)) {
      lastCheckedAt = lastCheckedAt || Date.now();
      applyRawIssues(rawIssues, generatedAt, dataSource, false, forceLive);
    } else {
      hasLoadedData = false;
      updateStatusText("error");
      renderTickets();
    }
  }

  function initLiveSync() {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleNextPoll(nextPollDelay());
  }

  // Periodic relative status text refresh
  setInterval(() => {
    if (hasLoadedData && activeDataSource === "live" && lastCheckedAt > 0 && el.updated) {
      const diffSec = Math.floor((Date.now() - lastCheckedAt) / 1000);
      if (diffSec < 15) {
        el.updated.textContent = "Atualizado agora";
      } else if (diffSec < 60) {
        el.updated.textContent = `Atualizado há ${diffSec}s`;
      } else {
        const mins = Math.floor(diffSec / 60);
        el.updated.textContent = `Atualizado há ${mins} min`;
      }
    }
  }, 5000);

  async function init() {
    initElements();
    setupListeners();
    syncFromUrl();
    renderTickets();
    await loadData();
    initLiveSync();
  }

  window.addEventListener("pageshow", () => {
    syncFromUrl();
    if (hasLoadedData) renderTickets();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
