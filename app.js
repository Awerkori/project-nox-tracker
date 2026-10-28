/**
 * Project Nox Tracker 2.0 - Core Application Logic
 *
 * Priorities:
 * 1. Default ordering: Newest issues first (#120 -> #119 -> #118 -> ... -> #1) strictly integer-based.
 * 2. Explicit separation of native state (ABERTO vs FECHADO) and resolution/workflow status.
 * 3. Transparent reconciliation of statistics including GitHub native state_reason duplicates.
 * 4. Quick segmented state filter (Todos | Abertos | Fechados).
 * 5. URL state synchronization and accessible interactions.
 */

(function () {
  'use strict';

  // Constants
  const DATA_URL = "data/issues.json";
  const CONFIG_URL = "data/config.json";
  const REPO_URL = "https://github.com/Awerkori/project-nox-requests";
  const CACHE_KEY = "project-nox-live-issues-v2";

  // Label Taxonomy Maps
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

  const STATUS_MAP = {
    "status:triage": { key: "triage", label: "Em análise", color: "indigo" },
    "em análise": { key: "triage", label: "Em análise", color: "indigo" },
    "status:accepted": { key: "accepted", label: "Aceito", color: "cyan" },
    "aceito": { key: "accepted", label: "Aceito", color: "cyan" },
    "status:in-progress": { key: "in-progress", label: "Em desenvolvimento", color: "purple" },
    "em desenvolvimento": { key: "in-progress", label: "Em desenvolvimento", color: "purple" },
    "status:needs-info": { key: "needs-info", label: "Aguardando informações", color: "amber" },
    "aguardando informações": { key: "needs-info", label: "Aguardando informações", color: "amber" }
  };

  const RESOLUTION_MAP = {
    "resolution:done": { key: "done", label: "Concluído", color: "emerald" },
    "concluído": { key: "done", label: "Concluído", color: "emerald" },
    "resolution:declined": { key: "declined", label: "Recusado", color: "rose" },
    "recusado": { key: "declined", label: "Recusado", color: "rose" },
    "resolution:duplicate": { key: "duplicate", label: "Duplicado", color: "orange" },
    "duplicado": { key: "duplicate", label: "Duplicado", color: "orange" },
    "resolution:cancelled": { key: "cancelled", label: "Cancelado", color: "slate" },
    "cancelado": { key: "cancelled", label: "Cancelado", color: "slate" }
  };

  // State & Filters (Default sort is strictly Mais recentes by updated_at DESC)
  const defaults = {
    type: "all",
    state: "all",
    category: "all",
    status: "all",
    resolution: "all",
    sort: "recent", // Default is strictly Mais recentes (updated_at DESC, tiebreaker number DESC)
    search: ""
  };

  // Safe migration & cleanup of any legacy sort preferences or stale cached data
  try {
    const legacyKeys = [
      "nox_tracker_sort",
      "project-nox-sort",
      "tracker_sort",
      "sort_preference",
      "tracker_filters",
      "project-nox-live-issues",
      "project-nox-live-issues-time"
    ];
    legacyKeys.forEach(k => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
  } catch (e) {
    // Ignore storage restrictions
  }

  const filters = { ...defaults };
  let allIssues = [];
  let trackerConfig = null;
  let lastFocus = null;
  let generatedAt = null;

  // DOM Elements Cache
  const el = {};

  function initElements() {
    el.search = document.querySelector("#search");
    el.clearSearch = document.querySelector("#clear-search");
    el.sort = document.querySelector("#sort");
    el.type = document.querySelector("#type");
    el.state = document.querySelector("#state");
    el.category = document.querySelector("#category");
    el.status = document.querySelector("#status");
    el.resolution = document.querySelector("#resolution");
    el.tickets = document.querySelector("#tickets");
    el.ticketCount = document.querySelector("#ticket-count");
    el.updated = document.querySelector("#updated");
    el.refresh = document.querySelector("#refresh-data");
    el.clearFilters = document.querySelector("#clear-filters");
    el.activeFiltersContainer = document.querySelector("#active-filters");
    el.filterChips = document.querySelector("#filter-chips");

    // Modal elements
    el.modal = document.querySelector("#ticket-modal");
    el.openTicket = document.querySelector("#open-ticket");
    el.closeTicket = document.querySelector("#close-ticket");
    el.dialog = document.querySelector(".modal-dialog");

    // Main Stat elements
    el.statTotal = document.querySelector('[data-stat="total"]');
    el.statOpen = document.querySelector('[data-stat="open"]');
    el.statClosed = document.querySelector('[data-stat="closed"]');
    el.statInProgress = document.querySelector('[data-stat="in-progress"]');
    el.statDone = document.querySelector('[data-stat="done"]');
    el.statDeclined = document.querySelector('[data-stat="declined"]');

    // Secondary Stat elements
    el.statDuplicate = document.querySelector('[data-stat="duplicate"]');
    el.statUnclassified = document.querySelector('[data-stat="unclassified"]');
    el.statManga = document.querySelector('[data-stat="manga"]');
    el.statAnime = document.querySelector('[data-stat="anime"]');

    // Quick Segmented State buttons
    el.quickStateButtons = document.querySelectorAll("[data-quick-state]");
  }

  function normalizeText(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function formatDate(isoString) {
    if (!isoString) return "—";
    try {
      const date = new Date(isoString);
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
      const now = new Date();
      const date = new Date(isoString);
      const diffMs = now - date;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return "hoje";
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

  // Issue Normalizer with clean Native State vs Resolution separation
  function normalizeIssue(raw) {
    const rawNumber = Number(raw.number);
    const rawLabels = (raw.labels || []).map(l => (typeof l === "string" ? l : l.name || "")).filter(Boolean);
    const lowerLabels = rawLabels.map(l => l.toLowerCase());

    // 1. Detect Type (Mangá or Anime)
    let type = "other";
    for (const label of lowerLabels) {
      if (TYPE_MAP[label]) {
        type = TYPE_MAP[label];
        break;
      }
    }

    // 2. Detect Kind / Category
    let kind = null;
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

    // 3. Detect Workflow Status (for open or in-progress issues)
    let status = null;
    let statusLabel = null;
    let statusColor = null;
    for (const label of lowerLabels) {
      if (STATUS_MAP[label]) {
        status = STATUS_MAP[label].key;
        statusLabel = STATUS_MAP[label].label;
        statusColor = STATUS_MAP[label].color;
        break;
      }
    }

    // 4. Detect Resolution (for closed issues)
    let resolution = null;
    let resolutionLabel = null;
    let resolutionColor = null;
    let resolutionSource = "label";

    for (const label of lowerLabels) {
      if (RESOLUTION_MAP[label]) {
        resolution = RESOLUTION_MAP[label].key;
        resolutionLabel = RESOLUTION_MAP[label].label;
        resolutionColor = RESOLUTION_MAP[label].color;
        break;
      }
    }

    const isOpen = raw.state === "open";
    const isClosed = raw.state === "closed";
    const stateReason = raw.state_reason || null;

    // Derived resolution for closed issues without explicit resolution label:
    // Check if closed with GitHub native state_reason === "duplicate" (e.g. Issues #55, #61, #65)
    if (isClosed && !resolution) {
      if (stateReason === "duplicate" || lowerLabels.includes("duplicado")) {
        resolution = "duplicate";
        resolutionLabel = "Duplicado (GitHub)";
        resolutionColor = "orange";
        resolutionSource = "github_reason";
      } else {
        resolution = "unclassified";
        resolutionLabel = "Sem classificação";
        resolutionColor = "slate";
        resolutionSource = "derived";
      }
    }

    // Complementary labels
    const isAdult = lowerLabels.includes("conteúdo +18") || lowerLabels.includes("content:adult") || lowerLabels.includes("+18");
    const isPriority = lowerLabels.includes("alta prioridade") || lowerLabels.includes("priority:high") || lowerLabels.includes("prioridade");

    // Reactions & Votes
    const reactions = raw.reactions || {};
    const upvotes = Number(reactions["+1"] || reactions.plus_one || 0);
    const comments = Number(raw.comments || 0);

    return {
      number: rawNumber,
      title: raw.title || `Issue #${rawNumber}`,
      html_url: raw.html_url || `${REPO_URL}/issues/${rawNumber}`,
      state: raw.state || "closed",
      state_reason: stateReason,
      isOpen,
      isClosed,
      type,
      kind: kind || "general",
      kindLabel,
      kindIcon,
      status,
      statusLabel,
      statusColor,
      resolution,
      resolutionLabel,
      resolutionColor,
      resolutionSource,
      isAdult,
      isPriority,
      upvotes,
      comments,
      author: raw.author?.login || raw.user?.login || "github-user",
      created_at: raw.created_at,
      updated_at: raw.updated_at,
      closed_at: raw.closed_at,
      rawLabels
    };
  }

  // Calculate Statistics with Exact Mathematical Reconciliation
  function calculateStats(issues) {
    let total = issues.length;
    let open = 0;
    let closed = 0;
    let inProgress = 0;
    let done = 0;
    let declined = 0;
    let duplicate = 0;
    let cancelled = 0;
    let unclassified = 0;
    let manga = 0;
    let anime = 0;

    for (const issue of issues) {
      if (issue.isOpen) {
        open++;
        if (issue.status === "in-progress") inProgress++;
      } else {
        closed++;
        if (issue.resolution === "done") done++;
        else if (issue.resolution === "declined") declined++;
        else if (issue.resolution === "duplicate") duplicate++;
        else if (issue.resolution === "cancelled") cancelled++;
        else if (issue.resolution === "unclassified") unclassified++;
      }

      if (issue.type === "manga") manga++;
      else if (issue.type === "anime") anime++;
    }

    // Verify mathematical reconciliation
    const closedBreakdown = done + declined + duplicate + cancelled + unclassified;
    if (closed !== closedBreakdown) {
      console.warn(`Math discrepancy: closed (${closed}) !== breakdown (${closedBreakdown})`);
    }

    return {
      total,
      open,
      closed,
      inProgress,
      done,
      declined,
      duplicate,
      cancelled,
      unclassified,
      manga,
      anime
    };
  }

  function renderStats(stats) {
    if (el.statTotal) el.statTotal.textContent = stats.total;
    if (el.statOpen) el.statOpen.textContent = stats.open;
    if (el.statClosed) el.statClosed.textContent = stats.closed;
    if (el.statInProgress) el.statInProgress.textContent = stats.inProgress;
    if (el.statDone) el.statDone.textContent = stats.done;
    if (el.statDeclined) el.statDeclined.textContent = stats.declined;

    if (el.statDuplicate) el.statDuplicate.textContent = stats.duplicate;
    if (el.statUnclassified) el.statUnclassified.textContent = stats.unclassified;
    if (el.statManga) el.statManga.textContent = stats.manga;
    if (el.statAnime) el.statAnime.textContent = stats.anime;

    // Update counts on quick segmented control buttons
    const qTotal = document.querySelector('[data-quick-count="total"]');
    const qOpen = document.querySelector('[data-quick-count="open"]');
    const qClosed = document.querySelector('[data-quick-count="closed"]');
    if (qTotal) qTotal.textContent = stats.total;
    if (qOpen) qOpen.textContent = stats.open;
    if (qClosed) qClosed.textContent = stats.closed;
  }

  // Filter and Sort Issues
  function filterIssues() {
    const searchRaw = filters.search.trim();
    const searchNorm = normalizeText(searchRaw);
    const isNumberSearch = searchRaw.startsWith("#") ? parseInt(searchRaw.slice(1), 10) : parseInt(searchRaw, 10);

    return allIssues.filter(issue => {
      // 1. Search text filter (title, author, or issue number)
      if (searchNorm) {
        const matchTitle = normalizeText(issue.title).includes(searchNorm);
        const matchAuthor = normalizeText(issue.author).includes(searchNorm);
        const matchNumber = !isNaN(isNumberSearch) && issue.number === isNumberSearch;
        if (!matchTitle && !matchAuthor && !matchNumber) return false;
      }

      // 2. Type filter (manga / anime)
      if (filters.type !== "all" && issue.type !== filters.type) return false;

      // 3. State filter (open / closed)
      if (filters.state !== "all" && issue.state !== filters.state) return false;

      // 4. Category / Kind filter
      if (filters.category !== "all") {
        const catMap = {
          "new-extension": "new-extension",
          "bug": "bug",
          "domain": "domain",
          "dead-source": "dead-source",
          "enhancement": "enhancement"
        };
        const target = catMap[filters.category] || filters.category;
        if (issue.kind !== target) return false;
      }

      // 5. Status filter (for open tickets)
      if (filters.status !== "all" && issue.status !== filters.status) return false;

      // 6. Resolution filter (for closed tickets)
      if (filters.resolution !== "all" && issue.resolution !== filters.resolution) return false;

      return true;
    }).sort((a, b) => {
      // 1. Mais novos (Número da Issue decrescente)
      if (filters.sort === "newest") {
        return Number(b.number) - Number(a.number);
      }

      // 2. Mais antigos (Número da Issue crescente)
      if (filters.sort === "oldest") {
        return Number(a.number) - Number(b.number);
      }

      // 3. Mais votados (Curtidos com desempate por updated_at e number)
      if (filters.sort === "demand") {
        const diff = Number(b.upvotes) - Number(a.upvotes);
        if (diff !== 0) return diff;
        const diffTime = (new Date(b.updated_at || 0).getTime()) - (new Date(a.updated_at || 0).getTime());
        if (diffTime !== 0 && !isNaN(diffTime)) return diffTime;
        return Number(b.number) - Number(a.number);
      }

      // 4. PADRÃO GLOBAL: "recent" (Mais recentes: updated_at DESC, com desempate rigoroso por number DESC)
      const diffTime = (new Date(b.updated_at || 0).getTime()) - (new Date(a.updated_at || 0).getTime());
      if (diffTime !== 0 && !isNaN(diffTime)) return diffTime;
      return Number(b.number) - Number(a.number);
    });
  }

  // Create Ticket Card DOM (Strict 4-Level Visual Hierarchy)
  function createTicketCard(issue) {
    const card = document.createElement("article");
    card.className = `ticket-card card-state-${issue.state}`;
    card.setAttribute("data-number", issue.number);

    // Level 2: Native State Badge (ABERTO or FECHADO) + Resolution/Status Badge
    let nativeStateBadgeHtml = "";
    let workflowBadgeHtml = "";

    if (issue.isOpen) {
      nativeStateBadgeHtml = `<span class="badge-state state-open"><span class="state-dot open-dot"></span>ABERTO</span>`;
      if (issue.status === "in-progress") {
        workflowBadgeHtml = `<span class="badge-workflow status-in-progress"><span class="badge-dot pulse"></span>Em desenvolvimento</span>`;
      } else if (issue.status === "accepted") {
        workflowBadgeHtml = `<span class="badge-workflow status-accepted">Aceito</span>`;
      } else if (issue.status === "needs-info") {
        workflowBadgeHtml = `<span class="badge-workflow status-needs-info">Aguardando info</span>`;
      } else if (issue.status === "triage") {
        workflowBadgeHtml = `<span class="badge-workflow status-triage">Em análise</span>`;
      } else {
        workflowBadgeHtml = `<span class="badge-workflow status-open">Novo pedido</span>`;
      }
    } else {
      nativeStateBadgeHtml = `<span class="badge-state state-closed"><span class="state-dot closed-dot"></span>FECHADO</span>`;
      if (issue.resolution === "done") {
        workflowBadgeHtml = `<span class="badge-workflow res-done">✓ Concluído</span>`;
      } else if (issue.resolution === "declined") {
        workflowBadgeHtml = `<span class="badge-workflow res-declined">✕ Recusado</span>`;
      } else if (issue.resolution === "duplicate") {
        workflowBadgeHtml = `<span class="badge-workflow res-duplicate">⧉ Duplicado</span>`;
      } else if (issue.resolution === "cancelled") {
        workflowBadgeHtml = `<span class="badge-workflow res-cancelled">Cancelado</span>`;
      } else {
        workflowBadgeHtml = `<span class="badge-workflow res-unclassified">Sem classificação</span>`;
      }
    }

    // Level 3: Type & Category Badges
    let typeBadgeHtml = "";
    if (issue.type === "manga") {
      typeBadgeHtml = `<span class="badge-tag tag-manga"><svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M19 2H6c-1.2 0-2 .8-2 2v16c0 1.2.8 2 2 2h13a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zm-1 18H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h12v16zM8 7h8v2H8zm0 4h8v2H8zm0 4h5v2H8z"/></svg>Mangá</span>`;
    } else if (issue.type === "anime") {
      typeBadgeHtml = `<span class="badge-tag tag-anime"><svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>Anime</span>`;
    }

    const kindBadgeHtml = `<span class="badge-tag tag-kind">${issue.kindIcon} ${issue.kindLabel}</span>`;
    const adultBadgeHtml = issue.isAdult ? `<span class="badge-tag tag-adult">+18</span>` : "";
    const priorityBadgeHtml = issue.isPriority ? `<span class="badge-tag tag-priority">★ Prioridade</span>` : "";

    // Reactions & Votes highlight
    const hasVotes = issue.upvotes > 0;
    const voteClass = hasVotes ? "has-votes" : "";

    // Assemble Card with Clear 4-Level Visual Structure
    card.innerHTML = `
      <a class="ticket-main" href="${issue.html_url}" target="_blank" rel="noopener noreferrer" aria-label="Ticket #${issue.number}: ${issue.title}">
        <!-- Level 1: Ticket Subject / Title -->
        <h3 class="ticket-title" title="${issue.title}">${issue.title}</h3>

        <!-- Level 2: Native State (ABERTO / FECHADO) & Resolution / Status -->
        <div class="ticket-status-row">
          ${nativeStateBadgeHtml}
          <span class="status-divider" aria-hidden="true">•</span>
          ${workflowBadgeHtml}
        </div>

        <!-- Level 3: Type & Category -->
        <div class="ticket-tags-row">
          ${typeBadgeHtml}
          ${kindBadgeHtml}
          ${adultBadgeHtml}
          ${priorityBadgeHtml}
        </div>

        <!-- Level 4: Meta Information (Number, Votes, Author, Date) -->
        <div class="ticket-meta-row">
          <span class="meta-item meta-number">#${issue.number}</span>
          <span class="meta-item meta-votes ${voteClass}">
            <span class="meta-vote-icon" aria-hidden="true">👍</span>
            <span>${issue.upvotes} ${issue.upvotes === 1 ? "voto" : "votos"}</span>
          </span>
          <span class="meta-item meta-author">
            <svg class="meta-icon" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            @${issue.author}
          </span>
          <span class="meta-item meta-date">
            <svg class="meta-icon" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
            ${formatRelativeDate(issue.updated_at)}
          </span>
          ${issue.comments > 0 ? `<span class="meta-item meta-comments"><svg class="meta-icon" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>${issue.comments}</span>` : ""}
        </div>
      </a>

      <!-- Quick Action Buttons -->
      <div class="ticket-actions">
        <a class="ticket-action-vote ${voteClass}" href="${issue.html_url}" target="_blank" rel="noopener noreferrer" title="Votar no Issue #${issue.number} com 👍">
          <span>👍 Votar</span>
        </a>
        <a class="ticket-action-view" href="${issue.html_url}" target="_blank" rel="noopener noreferrer" title="Ver no GitHub">
          <span>Ver no GitHub</span>
          <svg class="action-arrow" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 6v2h8.59L3.29 19.29l1.42 1.42L16 9.41V18h2V6z"/></svg>
        </a>
      </div>
    `;

    return card;
  }

  // Render Filter Chips
  function renderFilterChips() {
    if (!el.activeFiltersContainer || !el.filterChips) return;

    const chips = [];

    if (filters.search) {
      chips.push({ label: `Busca: "${filters.search}"`, key: "search" });
    }

    if (filters.type !== "all") {
      const typeLabels = { manga: "Mangá", anime: "Anime" };
      chips.push({ label: `Tipo: ${typeLabels[filters.type] || filters.type}`, key: "type" });
    }

    if (filters.state !== "all") {
      const stateLabels = { open: "🟢 Abertos", closed: "⚪ Fechados" };
      chips.push({ label: `Estado: ${stateLabels[filters.state] || filters.state}`, key: "state" });
    }

    if (filters.category !== "all") {
      const catLabels = {
        "new-extension": "Nova extensão",
        "bug": "Bug",
        "domain": "Mudança de domínio",
        "dead-source": "Fonte morta",
        "enhancement": "Sugestão"
      };
      chips.push({ label: `Categoria: ${catLabels[filters.category] || filters.category}`, key: "category" });
    }

    if (filters.status !== "all") {
      const statusLabels = {
        "triage": "Em análise",
        "accepted": "Aceito",
        "in-progress": "Em desenvolvimento",
        "needs-info": "Aguardando informações"
      };
      chips.push({ label: `Status: ${statusLabels[filters.status] || filters.status}`, key: "status" });
    }

    if (filters.resolution !== "all") {
      const resLabels = {
        "done": "Concluído",
        "declined": "Recusado",
        "duplicate": "Duplicado",
        "cancelled": "Cancelado",
        "unclassified": "Sem classificação"
      };
      chips.push({ label: `Resolução: ${resLabels[filters.resolution] || filters.resolution}`, key: "resolution" });
    }

    if (filters.sort !== "recent") {
      const sortLabels = {
        "newest": "Mais novos (#)",
        "oldest": "Mais antigos (#)",
        "demand": "Mais votados (👍)"
      };
      chips.push({ label: `Ordem: ${sortLabels[filters.sort] || filters.sort}`, key: "sort" });
    }

    if (chips.length > 0) {
      el.activeFiltersContainer.hidden = false;
      el.filterChips.innerHTML = chips.map(chip => `
        <button class="chip" type="button" data-clear-filter="${chip.key}" aria-label="Remover filtro ${chip.label}">
          <span>${chip.label}</span>
          <span class="chip-remove" aria-hidden="true">×</span>
        </button>
      `).join("");
    } else {
      el.activeFiltersContainer.hidden = true;
      el.filterChips.innerHTML = "";
    }
  }

  // Render Tickets List
  function renderTickets() {
    // Reconcile select element with active sort filter if sort is not explicit in URL
    const params = new URLSearchParams(location.search);
    if (!params.has("sort")) {
      filters.sort = "recent";
      if (el.sort && el.sort.value !== "recent") {
        el.sort.value = "recent";
      }
    }

    const filtered = filterIssues();
    const count = filtered.length;

    if (el.ticketCount) {
      el.ticketCount.textContent = `${count} ${count === 1 ? "ticket exibido" : "tickets exibidos"} (de ${allIssues.length})`;
    }

    renderFilterChips();

    // Update Quick Segmented State Buttons active state
    if (el.quickStateButtons) {
      el.quickStateButtons.forEach(btn => {
        const targetState = btn.getAttribute("data-quick-state");
        if (targetState === filters.state) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    }

    if (count === 0) {
      el.tickets.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>Nenhum ticket encontrado</h3>
          <p>Tente ajustar os termos de pesquisa ou remover os filtros aplicados.</p>
          <button class="button secondary" type="button" id="empty-clear-filters">Limpar todos os filtros</button>
        </div>
      `;
      const btn = document.querySelector("#empty-clear-filters");
      if (btn) btn.addEventListener("click", resetAllFilters);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const issue of filtered) {
      fragment.appendChild(createTicketCard(issue));
    }

    el.tickets.innerHTML = "";
    el.tickets.appendChild(fragment);
  }

  // URL Synchronization
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

    if (["manga", "anime", "all"].includes(params.get("type"))) {
      filters.type = params.get("type");
    }
    if (["open", "closed", "all"].includes(params.get("state"))) {
      filters.state = params.get("state");
    }
    if (params.has("category")) {
      const c = params.get("category");
      if (["new-extension", "bug", "domain", "dead-source", "enhancement", "all"].includes(c)) {
        filters.category = c;
      }
    }
    if (params.has("status")) {
      const s = params.get("status");
      if (["triage", "accepted", "in-progress", "needs-info", "all"].includes(s)) {
        filters.status = s;
      }
    }
    if (params.has("resolution")) {
      const r = params.get("resolution");
      if (["done", "declined", "duplicate", "cancelled", "unclassified", "all"].includes(r)) {
        filters.resolution = r;
      }
    }
    if (["newest", "oldest", "recent", "demand"].includes(params.get("sort"))) {
      filters.sort = params.get("sort");
    }
    if (params.has("search")) {
      filters.search = params.get("search");
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
    if (el.type) el.type.value = filters.type;
    if (el.state) el.state.value = filters.state;
    if (el.category) el.category.value = filters.category;
    if (el.status) el.status.value = filters.status;
    if (el.resolution) el.resolution.value = filters.resolution;
  }

  function resetAllFilters() {
    Object.assign(filters, defaults);
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
    if (el.dialog) el.dialog.focus();
  }

  function closeModal() {
    if (!el.modal || el.modal.hidden) return;
    el.modal.hidden = true;
    document.body.classList.remove("modal-open");
    if (lastFocus && typeof lastFocus.focus === "function") {
      lastFocus.focus();
    }
  }

  // Focus trap in modal
  function handleModalKeyDown(e) {
    if (el.modal.hidden) return;
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

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Setup Event Listeners
  function setupListeners() {
    // Quick Segmented State buttons
    if (el.quickStateButtons) {
      el.quickStateButtons.forEach(btn => {
        btn.addEventListener("click", () => {
          const target = btn.getAttribute("data-quick-state");
          filters.state = target;
          if (el.state) el.state.value = target;
          syncToUrl();
          renderTickets();
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
        syncToUrl();
        renderTickets();
        el.search.focus();
      });
    }

    // Filter selectors
    ["sort", "type", "state", "category", "status", "resolution"].forEach(key => {
      if (el[key]) {
        el[key].addEventListener("change", e => {
          filters[key] = e.target.value;
          syncToUrl();
          renderTickets();
        });
      }
    });

    // Clear filters button
    if (el.clearFilters) {
      el.clearFilters.addEventListener("click", resetAllFilters);
    }

    // Filter chips container delegation
    if (el.filterChips) {
      el.filterChips.addEventListener("click", e => {
        const chipBtn = e.target.closest("[data-clear-filter]");
        if (chipBtn) {
          const filterKey = chipBtn.getAttribute("data-clear-filter");
          if (filterKey && filterKey in filters) {
            filters[filterKey] = defaults[filterKey];
            applyInputsFromFilters();
            syncToUrl();
            renderTickets();
          }
        }
      });
    }

    // Interactive Stat Cards Clicks
    const statCards = document.querySelectorAll("[data-filter-stat]");
    statCards.forEach(card => {
      card.addEventListener("click", () => {
        const statType = card.getAttribute("data-filter-stat");
        if (statType === "total") {
          resetAllFilters();
        } else if (statType === "open") {
          filters.state = "open";
          filters.resolution = "all";
        } else if (statType === "closed") {
          filters.state = "closed";
          filters.resolution = "all";
        } else if (statType === "in-progress") {
          filters.state = "open";
          filters.status = "in-progress";
          filters.resolution = "all";
        } else if (statType === "done") {
          filters.state = "closed";
          filters.resolution = "done";
          filters.status = "all";
        } else if (statType === "declined") {
          filters.state = "closed";
          filters.resolution = "declined";
          filters.status = "all";
        } else if (statType === "duplicate") {
          filters.state = "closed";
          filters.resolution = "duplicate";
          filters.status = "all";
        } else if (statType === "unclassified") {
          filters.state = "closed";
          filters.resolution = "unclassified";
          filters.status = "all";
        } else if (statType === "manga") {
          filters.type = filters.type === "manga" ? "all" : "manga";
        } else if (statType === "anime") {
          filters.type = filters.type === "anime" ? "all" : "anime";
        }
        applyInputsFromFilters();
        syncToUrl();
        renderTickets();
      });
    });

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

    // Refresh button
    if (el.refresh) {
      el.refresh.addEventListener("click", async () => {
        el.refresh.disabled = true;
        el.refresh.classList.add("spinning");
        try {
          await loadData(true);
        } finally {
          setTimeout(() => {
            el.refresh.disabled = false;
            el.refresh.classList.remove("spinning");
          }, 600);
        }
      });
    }

    // Global keyboard shortcuts
    window.addEventListener("keydown", e => {
      // Shortcut '/' to search
      if (e.key === "/" && document.activeElement !== el.search && el.modal.hidden) {
        e.preventDefault();
        el.search?.focus();
        el.search?.select();
      }
    });

    // Popstate
    window.addEventListener("popstate", () => {
      syncFromUrl();
      renderTickets();
    });
  }

  // Load Issues Data
  async function loadData(forceLive = false) {
    let rawIssues = null;

    try {
      const res = await fetch(`${DATA_URL}?v=${Date.now()}`);
      if (res.ok) {
        const json = await res.json();
        rawIssues = json.issues || [];
        generatedAt = json.generated_at;
      }
    } catch (err) {
      console.warn("Could not load local issues.json:", err);
    }

    if (!rawIssues || rawIssues.length === 0) {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) rawIssues = JSON.parse(cached);
      } catch {
        // ignore
      }
    }

    if (rawIssues && rawIssues.length > 0) {
      allIssues = rawIssues.map(normalizeIssue);
      const stats = calculateStats(allIssues);
      renderStats(stats);
      renderTickets();

      if (el.updated && generatedAt) {
        el.updated.textContent = `Última sincronização: ${formatDate(generatedAt)} às ${new Date(generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
      }
    }
  }

  // Load Config
  async function loadConfig() {
    try {
      const res = await fetch(`${CONFIG_URL}?v=${Date.now()}`);
      if (res.ok) {
        trackerConfig = await res.json();
      }
    } catch (err) {
      console.warn("Config load skipped or not found:", err);
    }
  }

  function enforceDefaultSortState() {
    const params = new URLSearchParams(location.search);
    if (!params.has("sort")) {
      filters.sort = "recent";
      if (el.sort && el.sort.value !== "recent") {
        el.sort.value = "recent";
      }
    }
  }

  // Initialization
  async function init() {
    initElements();
    setupListeners();
    syncFromUrl();
    enforceDefaultSortState();
    await Promise.all([loadConfig(), loadData()]);
    enforceDefaultSortState();
  }

  // Handle pageshow (including Firefox bfcache and form restorations)
  window.addEventListener("pageshow", () => {
    enforceDefaultSortState();
    renderTickets();
  });

  // Handle window load event
  window.addEventListener("load", () => {
    enforceDefaultSortState();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
