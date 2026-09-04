const REQUESTS_URL = 'https://github.com/Awerkori/project-nox-requests/issues';
const categories = ['Nova extensão', 'Bug', 'Mudança de domínio', 'Fonte morta', 'Sugestão'];
const statuses = ['Em análise', 'Aceito', 'Em desenvolvimento', 'Aguardando informações', 'Concluído', 'Recusado'];
const defaults = { type: 'all', state: 'open', category: 'all', status: 'all', adult: false, priority: false, sort: 'demand', q: '' };
const state = { ...defaults };
const fields = Object.fromEntries(['type','state','category','status','adult','priority','sort','search'].map(id => [id, document.getElementById(id)]));
let allIssues = [];

function normalize(value = '') { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function labelNames(issue) { return issue.labels.map(label => typeof label === 'string' ? label : label.name); }
function issueType(issue) { const labels = labelNames(issue); return labels.includes('Manga') ? 'manga' : labels.includes('Anime') ? 'anime' : ''; }
function category(issue) { return categories.find(value => labelNames(issue).includes(value)); }
function status(issue) { return statuses.find(value => labelNames(issue).includes(value)); }
function votes(issue) { return issue.reactions?.['+1'] || 0; }
function relativeDate(date) { const days = Math.max(0, Math.floor((Date.now() - new Date(date)) / 86400000)); return days === 0 ? 'Atualizado hoje' : days === 1 ? 'Atualizado há 1 dia' : `Atualizado há ${days} dias`; }
function dateValue(issue, property) { return new Date(issue[property] || 0).getTime(); }

function loadFromUrl() {
  const params = new URLSearchParams(location.search);
  for (const key of Object.keys(defaults)) {
    if (!params.has(key)) continue;
    state[key] = ['adult','priority'].includes(key) ? params.get(key) === 'true' : params.get(key);
  }
  fields.type.value = state.type; fields.state.value = state.state; fields.category.value = state.category; fields.status.value = state.status;
  fields.sort.value = state.sort; fields.adult.checked = state.adult; fields.priority.checked = state.priority; fields.search.value = state.q;
}
function updateUrl() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) if (value !== defaults[key]) params.set(key, value);
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
}
function filteredIssues() {
  return allIssues.filter(issue => {
    const labels = labelNames(issue);
    return (state.type === 'all' || issueType(issue) === state.type)
      && (state.state === 'all' || issue.state === state.state)
      && (state.category === 'all' || category(issue) === state.category)
      && (state.status === 'all' || status(issue) === state.status)
      && (!state.adult || labels.includes('+18'))
      && (!state.priority || labels.includes('Prioridade'))
      && (!state.q || normalize(issue.title).includes(normalize(state.q)));
  }).sort((a, b) => {
    if (state.sort === 'demand') return votes(b) - votes(a) || dateValue(b, 'updated_at') - dateValue(a, 'updated_at');
    if (state.sort === 'recent') return dateValue(b, 'created_at') - dateValue(a, 'created_at');
    if (state.sort === 'updated') return dateValue(b, 'updated_at') - dateValue(a, 'updated_at');
    return dateValue(a, 'created_at') - dateValue(b, 'created_at');
  });
}
function badge(text, className = '') { const item = document.createElement('span'); item.className = `badge ${className}`; item.textContent = text; return item; }
function render() {
  updateUrl();
  const list = document.getElementById('tickets'); list.replaceChildren();
  const issues = filteredIssues();
  if (!issues.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = allIssues.length ? 'Nenhum ticket encontrado com esses filtros.' : 'Nenhum ticket aberto ainda.'; list.append(empty); return; }
  const template = document.getElementById('ticket-template');
  for (const issue of issues) {
    const card = template.content.cloneNode(true); const main = card.querySelector('.ticket-main'); const vote = card.querySelector('.vote');
    main.href = issue.html_url; vote.href = issue.html_url; card.querySelector('.demand').textContent = `${votes(issue) >= 10 ? '🔥 ' : ''}${votes(issue)} 👍`;
    card.querySelector('.state').textContent = issue.state === 'open' ? 'Aberto' : 'Fechado'; card.querySelector('h2').textContent = `#${issue.number} ${issue.title}`;
    const badges = card.querySelector('.badges'); const type = issueType(issue); if (type) badges.append(badge(type === 'manga' ? 'Mangá' : 'Anime', 'type'));
    if (category(issue)) badges.append(badge(category(issue), 'category')); if (status(issue)) badges.append(badge(status(issue))); if (labelNames(issue).includes('+18')) badges.append(badge('+18')); if (labelNames(issue).includes('Prioridade')) badges.append(badge('Prioridade'));
    card.querySelector('.date').textContent = relativeDate(issue.updated_at); list.append(card);
  }
}
function updateStats() {
  const open = allIssues.filter(issue => issue.state === 'open');
  document.getElementById('stat-open').textContent = open.length;
  document.getElementById('stat-new').textContent = allIssues.filter(issue => category(issue) === 'Nova extensão').length;
  document.getElementById('stat-bugs').textContent = allIssues.filter(issue => category(issue) === 'Bug').length;
  document.getElementById('stat-development').textContent = allIssues.filter(issue => status(issue) === 'Em desenvolvimento').length;
}
for (const [name, element] of Object.entries(fields)) element.addEventListener(name === 'search' ? 'input' : 'change', () => { state[name === 'search' ? 'q' : name] = element.type === 'checkbox' ? element.checked : element.value; render(); });
loadFromUrl();
fetch('data/issues.json').then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(data => { allIssues = data.issues || []; updateStats(); document.getElementById('updated').textContent = data.generated_at ? `Dados atualizados em ${new Date(data.generated_at).toLocaleString('pt-BR')}.` : 'Dados ainda não foram atualizados.'; render(); }).catch(() => { document.getElementById('updated').textContent = 'Os dados ainda não estão disponíveis. Tente novamente em alguns minutos.'; render(); });
