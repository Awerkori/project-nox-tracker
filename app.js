const LIVE_ISSUES_URL = "https://api.github.com/repos/Awerkori/project-nox-requests/issues";
const CACHE_KEY = "project-nox-live-issues";
const CACHE_TIME_KEY = "project-nox-live-issues-time";
const CACHE_TTL = 30 * 1000;
const FAST_PHASE_DURATION = 5 * 60 * 1000;
const FAST_INTERVAL = 30 * 1000;
const NORMAL_INTERVAL = 120 * 1000;

const defaults = { type: "all", state: "all", category: "all", status: "all", adult: false, sort: "recent", search: "" };
const validSorts = new Set(["recent", "oldest", "demand"]);
const categoryLabels = ["Nova extensão", "Bug", "Mudança de domínio", "Fonte morta", "Sugestão"];
const statusLabels = ["Em análise", "Aceito", "Em desenvolvimento", "Aguardando informações", "Concluído", "Recusado"];
const filters = { ...defaults };
let allIssues = [];
let generatedAt = null;
let lastFocus = null;
let currentSignature = "";
let isFetching = false;
let pollTimer = null;
let rateLimitUntil = 0;
const openedAt = Date.now();

const elements = {
  search: document.querySelector("#search"), sort: document.querySelector("#sort"), type: document.querySelector("#type"),
  state: document.querySelector("#state"), category: document.querySelector("#category"), status: document.querySelector("#status"),
  adult: document.querySelector("#adult"), tickets: document.querySelector("#tickets"),
  updated: document.querySelector("#updated"), refresh: document.querySelector("#refresh-data"), modal: document.querySelector("#ticket-modal"),
  openTicket: document.querySelector("#open-ticket"), closeTicket: document.querySelector("#close-ticket"), dialog: document.querySelector(".modal-dialog"),
};

function labelNames(issue) { return (issue.labels || []).map((label) => typeof label === "string" ? label : label.name).filter(Boolean); }
function issueType(issue) { const labels = labelNames(issue); return labels.includes("Manga") ? "manga" : labels.includes("Anime") ? "anime" : ""; }
function formatDate(value) { return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value)) : "—"; }
function normalized(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function labelFromParam(value, labels) {
  const aliases = { new: "Nova extensão", extension: "Nova extensão", bug: "Bug", domain: "Mudança de domínio", dead: "Fonte morta", feature: "Sugestão", suggestion: "Sugestão" };
  return aliases[normalized(value)] || labels.find((label) => normalized(label) === normalized(value)) || labels.find((label) => normalized(label).includes(normalized(value))) || "all";
}

function normalizeIssue(issue) {
  return {
    number: issue.number, title: issue.title, html_url: issue.html_url, state: issue.state, state_reason: issue.state_reason,
    created_at: issue.created_at, updated_at: issue.updated_at, closed_at: issue.closed_at,
    author: { login: issue.author?.login || issue.user?.login || "" }, labels: labelNames(issue), comments: issue.comments || 0,
    reactions: { total_count: issue.reactions?.total_count || 0, "+1": issue.reactions?.["+1"] || 0 },
  };
}

function dataSignature(issues) {
  return issues.map((issue) => [issue.number, issue.title, issue.state, issue.state_reason, issue.updated_at, labelNames(issue).sort().join(","), issue.reactions?.["+1"] || 0, issue.comments || 0].join("|")).sort().join("\n");
}

function updateUrl() {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== defaults[key] && value !== "") params.set(key, String(value)); });
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}`);
}

function applyFields() {
  elements.search.value = filters.search;
  ["sort", "type", "state", "category", "status"].forEach((key) => { elements[key].value = filters[key]; });
  elements.adult.checked = filters.adult === true;
}

function loadFromUrl() {
  Object.assign(filters, defaults);
  const params = new URLSearchParams(location.search);
  if (["manga", "anime", "all"].includes(params.get("type"))) filters.type = params.get("type");
  if (["open", "closed", "all"].includes(params.get("state"))) filters.state = params.get("state");
  if (params.has("category")) filters.category = labelFromParam(params.get("category"), categoryLabels);
  if (params.has("status")) filters.status = labelFromParam(params.get("status"), statusLabels);
  if (validSorts.has(params.get("sort"))) filters.sort = params.get("sort");
  if (params.has("search")) filters.search = params.get("search");
  filters.adult = params.get("adult") === "true";
  applyFields();
  renderTickets();
}

function filteredIssues() {
  const search = filters.search.trim().toLocaleLowerCase("pt-BR");
  return allIssues.filter((issue) => {
    const labels = labelNames(issue);
    return (!search || issue.title.toLocaleLowerCase("pt-BR").includes(search)) &&
      (filters.type === "all" || issueType(issue) === filters.type) && (filters.state === "all" || issue.state === filters.state) &&
      (filters.category === "all" || labels.includes(filters.category)) && (filters.status === "all" || labels.includes(filters.status)) &&
      (!filters.adult || labels.includes("+18"));
  }).sort((a, b) => {
    if (filters.sort === "demand") return (b.reactions?.["+1"] || 0) - (a.reactions?.["+1"] || 0) || new Date(b.updated_at) - new Date(a.updated_at);
    if (filters.sort === "recent") return new Date(b.updated_at) - new Date(a.updated_at);
    return new Date(a.updated_at) - new Date(b.updated_at);
  });
}

function renderStats() {
  const has = (issue, label) => labelNames(issue).includes(label);
  const counters = {
    total: allIssues.length, manga: allIssues.filter((issue) => has(issue, "Manga")).length, anime: allIssues.filter((issue) => has(issue, "Anime")).length,
    open: allIssues.filter((issue) => issue.state === "open").length, closed: allIssues.filter((issue) => issue.state === "closed").length,
    completed: allIssues.filter((issue) => has(issue, "Concluído")).length,
  };
  Object.entries(counters).forEach(([name, value]) => { document.querySelector(`[data-stat="${name}"]`).textContent = value; });
}

function renderTickets() {
  const visible = filteredIssues();
  elements.tickets.replaceChildren();
  if (!visible.length) { elements.tickets.innerHTML = '<p class="empty">Nenhum ticket encontrado com esses filtros.</p>'; return; }
  visible.forEach((issue) => {
    const template = document.querySelector("#ticket-template").content.cloneNode(true);
    const labels = labelNames(issue);
    const votes = issue.reactions?.["+1"] || 0;
    const type = issueType(issue) === "manga" ? "Mangá" : "Anime";
    const category = categoryLabels.find((name) => labels.includes(name));
    const status = statusLabels.find((name) => labels.includes(name));
    const main = template.querySelector(".ticket-main");
    main.href = issue.html_url;
    template.querySelector(".vote").href = issue.html_url;
    template.querySelector("h2").textContent = `#${issue.number} ${issue.title}`;
    template.querySelector(".demand").textContent = `${votes >= 10 ? "🔥 " : ""}${votes} 👍`;
    template.querySelector(".state").textContent = issue.state === "open" ? "Aberto" : "Fechado";
    template.querySelector(".date").textContent = `Atualizado em ${formatDate(issue.updated_at)}`;
    const markers = ["+18", "Prioridade"].filter((name) => labels.includes(name));
    template.querySelector(".badges").innerHTML = [type, category, status, ...markers].filter(Boolean).map((name) => `<span class="badge">${name}</span>`).join("");
    elements.tickets.append(template);
  });
}

function render() { renderStats(); renderTickets(); }
function setStatus(message) { elements.updated.textContent = message; }

function applyData(data, message) {
  const nextIssues = (data?.issues || []).filter((issue) => !issue.pull_request).map(normalizeIssue);
  const nextSignature = dataSignature(nextIssues);
  const changed = nextSignature !== currentSignature;
  generatedAt = data?.generated_at || generatedAt;
  if (changed) { allIssues = nextIssues; currentSignature = nextSignature; render(); }
  setStatus(message);
  return changed;
}

function readCache() {
  try {
    const savedAt = Number(localStorage.getItem(CACHE_TIME_KEY));
    const data = JSON.parse(localStorage.getItem(CACHE_KEY));
    return data && savedAt && Date.now() - savedAt < CACHE_TTL ? data : null;
  } catch { return null; }
}

function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); localStorage.setItem(CACHE_TIME_KEY, String(Date.now())); } catch { /* cache indisponível */ }
}

function pauseFromResponse(response) {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const retryAfter = Number(response.headers.get("retry-after"));
  if (remaining === 0 || response.status === 403 || response.status === 429) {
    const resetAt = Number.isFinite(reset) && reset > 0 ? reset * 1000 : 0;
    const retryAt = Number.isFinite(retryAfter) && retryAfter > 0 ? Date.now() + retryAfter * 1000 : 0;
    rateLimitUntil = Math.max(rateLimitUntil, resetAt, retryAt, Date.now() + 30 * 1000);
    return true;
  }
  return false;
}

async function fetchLiveIssues() {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(`${LIVE_ISSUES_URL}?state=all&per_page=100&page=${page}`);
    const paused = pauseFromResponse(response);
    if (!response.ok) { const error = new Error(`GitHub API respondeu ${response.status}`); error.rateLimited = paused; throw error; }
    const batch = await response.json();
    issues.push(...batch.filter((issue) => !issue.pull_request).map(normalizeIssue));
    if (batch.length < 100) break;
  }
  return { generated_at: new Date().toISOString(), repository: "Awerkori/project-nox-requests", issues };
}

function nextPollDelay() {
  if (rateLimitUntil > Date.now()) return rateLimitUntil - Date.now() + 1000;
  const elapsed = Date.now() - openedAt;
  if (elapsed < FAST_PHASE_DURATION) return Math.min(FAST_INTERVAL, FAST_PHASE_DURATION - elapsed);
  return NORMAL_INTERVAL;
}

function scheduleNextPoll() {
  clearTimeout(pollTimer);
  pollTimer = null;
  if (document.visibilityState !== "visible") return;
  pollTimer = setTimeout(() => refreshLive(), nextPollDelay());
}

async function refreshLive({ manual = false } = {}) {
  if ((!manual && document.visibilityState !== "visible") || isFetching) return;
  if (rateLimitUntil > Date.now()) { setStatus("Atualização automática pausada temporariamente."); scheduleNextPoll(); return; }
  isFetching = true;
  elements.refresh.disabled = true;
  setStatus("Sincronizando...");
  try {
    const data = await fetchLiveIssues();
    writeCache(data);
    const changed = applyData(data, "");
    setStatus(changed ? "Sincronizado com o GitHub agora." : "Atualizado há poucos segundos.");
  } catch (error) {
    setStatus(error.rateLimited ? "Atualização automática pausada temporariamente." : allIssues.length ? "Usando dados em cache." : "Dados ainda não estão disponíveis. Tente novamente em instantes.");
  } finally {
    isFetching = false;
    elements.refresh.disabled = false;
    scheduleNextPoll();
  }
}

function openModal() { lastFocus = document.activeElement; elements.modal.hidden = false; document.body.classList.add("modal-open"); elements.dialog.focus(); }
function closeModal() { elements.modal.hidden = true; document.body.classList.remove("modal-open"); lastFocus?.focus(); }
function trapFocus(event) {
  if (event.key === "Escape") { closeModal(); return; }
  if (event.key !== "Tab" || elements.modal.hidden) return;
  const focusable = [...elements.dialog.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
  const first = focusable[0]; const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function bindFilters() {
  ["search", "sort", "type", "state", "category", "status"].forEach((key) => elements[key].addEventListener("input", () => { filters[key] = elements[key].value; updateUrl(); renderTickets(); }));
  elements.adult.addEventListener("change", () => { filters.adult = elements.adult.checked; updateUrl(); renderTickets(); });
}

async function init() {
  loadFromUrl();
  window.addEventListener("pageshow", loadFromUrl);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { clearTimeout(pollTimer); pollTimer = null; return; }
    refreshLive();
  });
  bindFilters();
  elements.refresh.addEventListener("click", () => refreshLive({ manual: true }));
  elements.openTicket.addEventListener("click", openModal);
  elements.closeTicket.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (event) => { if (event.target.matches("[data-close-modal]")) closeModal(); });
  document.addEventListener("keydown", trapFocus);
  const staticData = fetch("data/issues.json", { cache: "no-cache" })
    .then((response) => { if (!response.ok) throw new Error("Dados estáticos indisponíveis"); return response.json(); })
    .then((data) => { if (!currentSignature) applyData(data, "Dados estáticos carregados."); })
    .catch(() => { if (!currentSignature) applyData({ issues: [] }, "Dados estáticos ainda não estão disponíveis."); });
  const cached = readCache();
  if (cached) applyData(cached, "Usando dados em cache.");
  refreshLive();
  await staticData;
}

init();
