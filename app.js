const LIVE_ISSUES_URL = "https://api.github.com/repos/Awerkori/project-nox-requests/issues";
const CACHE_KEY = "project-nox-live-issues";
const CACHE_TIME_KEY = "project-nox-live-issues-time";
const CACHE_TTL = 2 * 60 * 1000;

const defaults = { type: "all", state: "open", category: "all", status: "all", adult: false, priority: false, sort: "demand", search: "" };
const filters = { ...defaults };
let allIssues = [];
let generatedAt = null;
let lastFocus = null;

const elements = {
  search: document.querySelector("#search"), sort: document.querySelector("#sort"), type: document.querySelector("#type"),
  state: document.querySelector("#state"), category: document.querySelector("#category"), status: document.querySelector("#status"),
  adult: document.querySelector("#adult"), priority: document.querySelector("#priority"), tickets: document.querySelector("#tickets"),
  updated: document.querySelector("#updated"), refresh: document.querySelector("#refresh-data"), modal: document.querySelector("#ticket-modal"),
  openTicket: document.querySelector("#open-ticket"), closeTicket: document.querySelector("#close-ticket"), dialog: document.querySelector(".modal-dialog"),
};

function labelNames(issue) {
  return (issue.labels || []).map((label) => typeof label === "string" ? label : label.name).filter(Boolean);
}

function issueType(issue) {
  const labels = labelNames(issue);
  if (labels.includes("Manga")) return "manga";
  if (labels.includes("Anime")) return "anime";
  return "";
}

function normalizeIssue(issue) {
  return {
    number: issue.number, title: issue.title, html_url: issue.html_url, state: issue.state, state_reason: issue.state_reason,
    created_at: issue.created_at, updated_at: issue.updated_at, closed_at: issue.closed_at,
    author: { login: issue.author?.login || issue.user?.login || "" }, labels: labelNames(issue), comments: issue.comments || 0,
    reactions: { total_count: issue.reactions?.total_count || 0, "+1": issue.reactions?.["+1"] || 0 },
  };
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value)) : "—";
}

function updateUrl() {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== defaults[key] && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}`);
}

function applyFields() {
  elements.search.value = filters.search;
  ["sort", "type", "state", "category", "status"].forEach((key) => { elements[key].value = filters[key]; });
  elements.adult.checked = filters.adult === true;
  elements.priority.checked = filters.priority === true;
}

function loadFromUrl() {
  Object.assign(filters, defaults);
  const params = new URLSearchParams(location.search);
  ["type", "state", "category", "status", "sort", "search"].forEach((key) => {
    if (params.has(key)) filters[key] = params.get(key);
  });
  filters.adult = params.get("adult") === "true";
  filters.priority = params.get("priority") === "true";
  applyFields();
}

function filteredIssues() {
  const search = filters.search.trim().toLocaleLowerCase("pt-BR");
  return allIssues.filter((issue) => {
    const labels = labelNames(issue);
    return (!search || issue.title.toLocaleLowerCase("pt-BR").includes(search)) &&
      (filters.type === "all" || issueType(issue) === filters.type) &&
      (filters.state === "all" || issue.state === filters.state) &&
      (filters.category === "all" || labels.includes(filters.category)) &&
      (filters.status === "all" || labels.includes(filters.status)) &&
      (!filters.adult || labels.includes("+18")) && (!filters.priority || labels.includes("Prioridade"));
  }).sort((a, b) => {
    if (filters.sort === "demand") return (b.reactions?.["+1"] || 0) - (a.reactions?.["+1"] || 0) || new Date(b.updated_at) - new Date(a.updated_at);
    if (filters.sort === "recent") return new Date(b.created_at) - new Date(a.created_at);
    if (filters.sort === "updated") return new Date(b.updated_at) - new Date(a.updated_at);
    return new Date(a.created_at) - new Date(b.created_at);
  });
}

function renderStats() {
  const has = (issue, label) => labelNames(issue).includes(label);
  document.querySelector("#stat-open").textContent = allIssues.filter((issue) => issue.state === "open").length;
  document.querySelector("#stat-new").textContent = allIssues.filter((issue) => has(issue, "Nova extensão")).length;
  document.querySelector("#stat-bugs").textContent = allIssues.filter((issue) => has(issue, "Bug")).length;
  document.querySelector("#stat-development").textContent = allIssues.filter((issue) => has(issue, "Em desenvolvimento")).length;
}

function renderTickets() {
  const visible = filteredIssues();
  elements.tickets.replaceChildren();
  if (!visible.length) {
    elements.tickets.innerHTML = '<p class="empty">Nenhum ticket encontrado com esses filtros.</p>';
    return;
  }
  visible.forEach((issue) => {
    const template = document.querySelector("#ticket-template").content.cloneNode(true);
    const labels = labelNames(issue);
    const votes = issue.reactions?.["+1"] || 0;
    const type = issueType(issue) === "manga" ? "Mangá" : "Anime";
    const category = ["Nova extensão", "Bug", "Mudança de domínio", "Fonte morta", "Sugestão"].find((name) => labels.includes(name));
    const status = ["Em análise", "Aceito", "Em desenvolvimento", "Aguardando informações", "Concluído", "Recusado"].find((name) => labels.includes(name));
    const main = template.querySelector(".ticket-main");
    main.href = issue.html_url;
    template.querySelector(".vote").href = issue.html_url;
    template.querySelector("h2").textContent = `#${issue.number} ${issue.title}`;
    template.querySelector(".demand").textContent = `${votes >= 10 ? "🔥 " : ""}${votes} 👍`;
    template.querySelector(".state").textContent = issue.state === "open" ? "Aberto" : "Fechado";
    template.querySelector(".date").textContent = `Atualizado em ${formatDate(issue.updated_at)}`;
    const badges = [type, category, status].filter(Boolean);
    template.querySelector(".badges").innerHTML = badges.map((name) => `<span class="badge">${name}</span>`).join("");
    elements.tickets.append(template);
  });
}

function render() { renderStats(); renderTickets(); }

function setStatus(message) {
  const date = generatedAt ? ` Última atualização: ${formatDate(generatedAt)}.` : "";
  elements.updated.textContent = `${message}${date}`;
}

function applyData(data, message) {
  allIssues = (data?.issues || []).filter((issue) => !issue.pull_request).map(normalizeIssue);
  generatedAt = data?.generated_at || null;
  render();
  setStatus(message);
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

async function fetchLiveIssues() {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(`${LIVE_ISSUES_URL}?state=all&per_page=100&page=${page}`);
    if (!response.ok) throw new Error(`GitHub API respondeu ${response.status}`);
    const batch = await response.json();
    issues.push(...batch.filter((issue) => !issue.pull_request).map(normalizeIssue));
    if (batch.length < 100) break;
  }
  return { generated_at: new Date().toISOString(), repository: "Awerkori/project-nox-requests", issues };
}

async function refreshLive(force = false) {
  const cached = !force && readCache();
  if (cached) { applyData(cached, "Dados ao vivo carregados do cache local."); return; }
  elements.refresh.disabled = true;
  try {
    const data = await fetchLiveIssues();
    writeCache(data);
    applyData(data, "Dados sincronizados com o GitHub agora.");
  } catch {
    setStatus(allIssues.length ? "Não foi possível sincronizar agora; exibindo dados disponíveis." : "Dados ainda não estão disponíveis. Tente atualizar novamente em instantes.");
  } finally { elements.refresh.disabled = false; }
}

function openModal() {
  lastFocus = document.activeElement;
  elements.modal.hidden = false;
  document.body.classList.add("modal-open");
  elements.dialog.focus();
}

function closeModal() {
  elements.modal.hidden = true;
  document.body.classList.remove("modal-open");
  lastFocus?.focus();
}

function trapFocus(event) {
  if (event.key === "Escape") { closeModal(); return; }
  if (event.key !== "Tab" || elements.modal.hidden) return;
  const focusable = [...elements.dialog.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
  const first = focusable[0]; const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function bindFilters() {
  ["search", "sort", "type", "state", "category", "status"].forEach((key) => elements[key].addEventListener("input", () => {
    filters[key] = elements[key].value; updateUrl(); renderTickets();
  }));
  ["adult", "priority"].forEach((key) => elements[key].addEventListener("change", () => {
    filters[key] = elements[key].checked; updateUrl(); renderTickets();
  }));
}

async function init() {
  loadFromUrl();
  window.addEventListener("pageshow", loadFromUrl);
  bindFilters();
  elements.refresh.addEventListener("click", () => refreshLive(true));
  elements.openTicket.addEventListener("click", openModal);
  elements.closeTicket.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (event) => { if (event.target.matches("[data-close-modal]")) closeModal(); });
  document.addEventListener("keydown", trapFocus);
  try {
    const response = await fetch("data/issues.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Dados estáticos indisponíveis");
    applyData(await response.json(), "Dados estáticos carregados.");
  } catch { applyData({ issues: [] }, "Dados estáticos ainda não estão disponíveis."); }
  refreshLive();
}

init();
