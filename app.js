'use strict';

const STORAGE_KEY = 'fantasta.auction.v1';
const FILTER_KEY = 'fantasta.filters.v1';
const ROLE_LABELS = { P: 'Portieri', D: 'Difensori', C: 'Centrocampisti', A: 'Attaccanti' };
const ROLE_SHORT = { P: 'POR', D: 'DIF', C: 'CC', A: 'ATT' };
const TEAM_CODES = {
  Atalanta:'ATA', Bologna:'BOL', Cagliari:'CAG', Como:'COM', Cremonese:'CRE', Fiorentina:'FIO',
  Genoa:'GEN', Inter:'INT', Juventus:'JUV', Lazio:'LAZ', Lecce:'LEC', Milan:'MIL', Monza:'MON',
  Napoli:'NAP', Parma:'PAR', Pisa:'PIS', Roma:'ROM', Sassuolo:'SAS', Torino:'TOR', Udinese:'UDI',
  Venezia:'VEN', Verona:'VER', Frosinone:'FRO'
};

const app = {
  players: [], config: null, state: null, filters: null, route: { view:'home', role:null, query:'' },
  undo: null, installPrompt: null
};

function emptyState() {
  return {
    version: 1,
    dataVersion: null,
    budgetStart: 550,
    playerStates: {},
    updatedAt: new Date().toISOString()
  };
}

function defaultFilters() {
  return {
    status: 'available',
    starter: 'ALL',
    sort: 'our',
    injuredOnly: false,
    penaltyOnly: false,
    pairOnly: false
  };
}

async function init() {
  try {
    const [playersData, config] = await Promise.all([
      fetch('./data/players.json').then(r => { if (!r.ok) throw new Error('players.json'); return r.json(); }),
      fetch('./data/config.json').then(r => { if (!r.ok) throw new Error('config.json'); return r.json(); })
    ]);
    app.players = playersData.players || [];
    app.config = config;
    app.state = loadJSON(STORAGE_KEY) || emptyState();
    app.filters = { ...defaultFilters(), ...(loadJSON(FILTER_KEY) || {}) };
    app.state.budgetStart = app.config?.league?.budget || app.state.budgetStart || 550;
    app.state.dataVersion = playersData.data_version || config.data_version || null;
    normalizeState();
    parseRoute();
    bindGlobalEvents();
    render();
    registerSW();
  } catch (error) {
    document.getElementById('app').innerHTML = `<div class="container"><div class="empty"><h2>Errore caricamento dati</h2><p>${escapeHtml(String(error))}</p></div></div>`;
  }
}

function normalizeState() {
  for (const p of app.players) {
    if (!app.state.playerStates[p.id]) {
      app.state.playerStates[p.id] = { status:'available', price:null, assignedSlot:null };
    }
  }
  saveState();
}

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function saveState() {
  app.state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(app.state));
}
function saveFilters() { localStorage.setItem(FILTER_KEY, JSON.stringify(app.filters)); }

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (!hash) { app.route = {view:'home',role:null,query:''}; return; }
  const params = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
  const path = hash.split('?')[0].split('/');
  if (path[0] === 'role' && ROLE_LABELS[path[1]]) app.route = {view:'role',role:path[1],query:params.get('q') || ''};
  else app.route = {view:'home',role:null,query:''};
}

function bindGlobalEvents() {
  window.addEventListener('hashchange', () => { parseRoute(); render(); });
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  document.querySelectorAll('[data-close-drawer]').forEach(el => el.addEventListener('click', closeDrawer));
  document.getElementById('importFileInput').addEventListener('change', handleImportFile);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); app.installPrompt = e; });
}

function handleClick(e) {
  const el = e.target.closest('[data-action], [data-player-link], [data-nav-role], [data-close-modal], [data-close-drawer]');
  if (!el) return;
  if (el.dataset.closeDrawer !== undefined) { closeDrawer(); return; }
  if (el.dataset.closeModal !== undefined) { closeModal(); return; }
  if (el.dataset.navRole) { location.hash = `#/role/${el.dataset.navRole}`; return; }
  if (el.dataset.playerLink) { jumpToPlayer(el.dataset.playerLink); return; }
  const action = el.dataset.action;
  if (!action) return;
  const id = el.dataset.id;
  if (action === 'home') location.hash = '#/';
  if (action === 'filters') openDrawer();
  if (action === 'roster') openRoster();
  if (action === 'slots') openSlots(app.route.role);
  if (action === 'settings') openSettings();
  if (action === 'mark-other') markOther(id);
  if (action === 'reset-other') resetOther(id);
  if (action === 'clear-role-search') clearRoleSearch();
  if (action === 'buy-start') toggleBuyPanel(id);
  if (action === 'buy-confirm') confirmBuy(id);
  if (action === 'undo') undoLast();
  if (action === 'remove-mine') removeMine(id);
  if (action === 'filter-status') { app.filters.status = el.dataset.value; saveFilters(); render(); openDrawer(); }
  if (action === 'filter-starter') { app.filters.starter = el.dataset.value; saveFilters(); render(); openDrawer(); }
  if (action === 'confirm-export-backup') confirmDialog('Esportare il backup completo?', 'Verrà creato un file JSON con lo stato attuale dell’asta.', () => exportBackup());
  if (action === 'confirm-export-team') confirmDialog('Esportare la rosa per ChatGPT?', 'Verrà creato un file TXT leggibile con rosa, prezzi, slot e budget.', () => exportTeamText());
  if (action === 'import') document.getElementById('importFileInput').click();
  if (action === 'reset') confirmDialog('Reset completo asta?', 'Questa operazione cancella rosa, prezzi e giocatori depennati. È irreversibile salvo backup.', resetAuction, true);
  if (action === 'install') installApp();
}

function handleInput(e) {
  if (e.target.id === 'roleSearch') { app.route.query = e.target.value; const clearBtn=document.querySelector('.search-clear'); if(clearBtn) clearBtn.hidden=!e.target.value; renderRoleListOnly(); }
  if (e.target.id === 'globalSearch') renderGlobalResults(e.target.value);
  if (e.target.dataset.buyInput) {
    // no-op: lettura al click conferma
  }
  if (e.target.dataset.rosterPrice) {
    const id = e.target.dataset.rosterPrice;
    const val = Number(e.target.value);
    if (Number.isFinite(val) && val >= 0) { app.state.playerStates[id].price = val; saveState(); updateRosterSummary(); }
  }
}

function handleChange(e) {
  if (e.target.id === 'sortSelect') { app.filters.sort = e.target.value; saveFilters(); render(); openDrawer(); }
  if (e.target.dataset.toggleFilter) { app.filters[e.target.dataset.toggleFilter] = e.target.checked; saveFilters(); render(); openDrawer(); }
  if (e.target.dataset.slotSelect) {
    const id = e.target.dataset.slotSelect;
    app.state.playerStates[id].assignedSlot = e.target.value || null;
    saveState(); updateRosterSummary();
  }
}

function render() {
  if (app.route.view === 'role') renderRolePage(app.route.role);
  else renderHome();
}

function headerBase({role=null, toolbar=false}={}) {
  const spent = totalSpent();
  const residual = app.state.budgetStart - spent;
  const roleCount = role ? mineByRole(role).length : null;
  const roleMax = role ? app.config.league.roster[role] : null;
  const attackClass = residual >= 280 ? 'good' : residual >= 250 ? 'warn' : 'bad';
  return `<header class="topbar">
    <div class="topbar__main">
      <button class="icon-btn" data-action="home" aria-label="Home">⌂</button>
      <div class="brand"><div class="brand__mark">FA</div><div class="brand__text"><strong>FantAsta 26/27</strong><span>${escapeHtml(app.state.dataVersion || '')}</span></div></div>
      <div class="topbar__spacer"></div>
      <div class="kpi-inline">
        <span class="kpi-pill">💰 ${residual}</span>
        ${role ? `<span class="kpi-pill">${ROLE_SHORT[role]} ${roleCount}/${roleMax}</span>` : ''}
        ${role && role !== 'A' ? `<span class="kpi-pill ${attackClass} hide-mobile">ATT residuo ${residual}</span>` : ''}
      </div>
      <button class="icon-btn" data-action="settings" aria-label="Impostazioni e backup">⚙️</button>
    </div>
    ${toolbar ? `<div class="role-toolbar">
      <div class="searchbox"><span>🔍</span><input id="roleSearch" value="${escapeAttr(app.route.query || '')}" autocomplete="off" placeholder="Cerca ${ROLE_LABELS[role].toLowerCase()}..." aria-label="Cerca giocatore" /><button class="search-clear" data-action="clear-role-search" aria-label="Cancella ricerca" ${app.route.query ? '' : 'hidden'}>×</button></div>
      <button class="toolbar-btn" data-action="slots" aria-label="Composizione ideale per slot">🧩 <span class="label">Slot</span></button>
      <button class="toolbar-btn" data-action="roster" aria-label="Rosa in composizione">👕 <span class="label">Rosa</span></button>
      <button class="toolbar-btn" data-action="filters" aria-label="Filtri e ordinamento">☰ <span class="label">Filtri</span></button>
    </div>` : ''}
  </header>`;
}

function renderHome() {
  const residual = app.state.budgetStart - totalSpent();
  const counts = Object.fromEntries(Object.keys(ROLE_LABELS).map(r => [r,mineByRole(r).length]));
  const totalMine = Object.values(counts).reduce((a,b)=>a+b,0);
  document.getElementById('app').innerHTML = `<div class="page">
    ${headerBase()}
    <main class="container">
      <section class="hero">
        <div class="eyebrow" style="color:rgba(255,255,255,.68)">Assistente d'asta offline</div>
        <h1>FantAsta 2026/27</h1>
        <p>Ricerca, filtra, assegna e controlla slot e budget senza dipendere dalla connessione.</p>
        <div class="home-kpis">
          <div class="home-kpi"><span>Budget residuo</span><strong>${residual}</strong></div>
          <div class="home-kpi"><span>Rosa</span><strong>${totalMine}/30</strong></div>
          <div class="home-kpi wide"><span>Attacco potenziale</span><strong>${residual}</strong></div>
        </div>
      </section>
      <div class="global-search"><input id="globalSearch" autocomplete="off" placeholder="🔍 Cerca qualsiasi calciatore..." aria-label="Ricerca globale" /></div>
      <div id="globalResults"></div>
      <section class="role-grid">
        ${Object.entries(ROLE_LABELS).map(([r,label]) => `<button class="role-tile" data-nav-role="${r}">
          <div class="role-letter">${r}</div><div class="role-name">${label}</div>
          <div class="role-count">${counts[r]}/${app.config.league.roster[r]} acquistati · ${availableByRole(r).length} disponibili</div>
        </button>`).join('')}
      </section>
    </main>
  </div>`;
}

function renderGlobalResults(query) {
  const root = document.getElementById('globalResults');
  if (!root) return;
  const q = normalize(query);
  if (q.length < 2) { root.innerHTML=''; return; }
  const matches = app.players.filter(p => searchable(p).includes(q)).slice(0,12);
  root.innerHTML = `<div class="section-title"><h2>Risultati</h2><span class="subtle">${matches.length}</span></div>
  <div class="cards">${matches.map(p => {
    const st=getPlayerState(p.id);
    const label=st.status==='mine' ? `MIO ${st.price ?? ''}` : st.status==='other' ? 'PRESO' : 'DISPONIBILE';
    return `<article class="player-card ${st.status}"><div class="player-card__body"><div class="player-card__head"><div class="role-badge">${p.role}</div><div class="player-ident"><div class="player-name">${escapeHtml(p.name)}</div><div class="player-team">${teamCode(p.team)} · ${escapeHtml(p.priority_band||'')} · ${escapeHtml(p.slot||'')}</div></div><span class="status-mini ${st.status==='mine'?'mine':'other'}">${label}</span></div><div class="meta-line"><button class="player-link" data-player-link="${escapeAttr(p.name)}">Apri scheda →</button></div></div></article>`;
  }).join('')}</div>`;
}

function renderRolePage(role) {
  document.getElementById('app').innerHTML = `<div class="page">${headerBase({role,toolbar:true})}<main class="container">
    <div class="section-title"><div><h2>${ROLE_LABELS[role]}</h2><div class="subtle" id="listSummary"></div></div></div>
    <div id="roleList" class="cards"></div>
  </main></div>`;
  renderRoleListOnly();
}

function renderRoleListOnly() {
  const root = document.getElementById('roleList');
  if (!root || !app.route.role) return;
  const players = getFilteredPlayers(app.route.role, app.route.query);
  const summary = document.getElementById('listSummary');
  if (summary) summary.textContent = `${players.length} giocatori · vista ${statusLabel(app.filters.status)} · ordine ${sortLabel(app.filters.sort)}`;
  root.innerHTML = players.length ? players.map(playerCard).join('') : `<div class="empty"><strong>Nessun giocatore trovato.</strong><div>Modifica ricerca o filtri.</div></div>`;
  refreshDrawerContent();
}

function getFilteredPlayers(role, query='') {
  const q = normalize(query);
  let list = app.players.filter(p => p.role === role);
  list = list.filter(p => {
    const st = getPlayerState(p.id).status;
    if (app.filters.status !== 'all' && st !== app.filters.status) return false;
    if (q && !searchable(p).includes(q)) return false;
    if (app.filters.starter !== 'ALL' && starterBucket(p.starter_status) !== app.filters.starter) return false;
    if (app.filters.injuredOnly && !isInjured(p)) return false;
    if (app.filters.penaltyOnly && !hasPenaltyDuty(p)) return false;
    if (app.filters.pairOnly && !p.pair_recommendation) return false;
    return true;
  });
  return list.sort(sorter(app.filters.sort));
}

function sorter(type) {
  if (type === 'sos') return (a,b) => sosScore(a.sos_tier)-sosScore(b.sos_tier) || a.rank-b.rank;
  if (type === 'apps') return (a,b) => (b.stats?.appearances ?? -1)-(a.stats?.appearances ?? -1) || a.rank-b.rank;
  if (type === 'mv') return (a,b) => (b.stats?.average_rating ?? -1)-(a.stats?.average_rating ?? -1) || a.rank-b.rank;
  if (type === 'fm') return (a,b) => (b.stats?.fantasy_average ?? -1)-(a.stats?.fantasy_average ?? -1) || a.rank-b.rank;
  if (type === 'max') return (a,b) => maxValue(b)-maxValue(a) || a.rank-b.rank;
  if (type === 'name') return (a,b) => a.name.localeCompare(b.name,'it');
  return (a,b) => priorityScore(a.priority_band)-priorityScore(b.priority_band) || (a.rank ?? 9999)-(b.rank ?? 9999);
}

function playerCard(p) {
  const st = getPlayerState(p.id);
  const starter = starterVisual(p.starter_status);
  const price = priceMarkup(p);
  const profile = profileMarkup(p);
  const injury = injuryMarkup(p);
  const links = linkMarkup(p);
  const note = (p.notes || []).filter(Boolean).join(' · ');
  const statusMini = st.status === 'mine' ? `<span class="status-mini mine">MIO ${st.price ?? ''}</span>` : st.status === 'other' ? `<span class="status-mini other">PRESO</span>` : '';
  const buyPanel = st.status === 'available' && window.__buyPanel === p.id ? `<div class="buy-panel"><input inputmode="numeric" pattern="[0-9]*" min="0" data-buy-input="${p.id}" placeholder="Crediti" aria-label="Crediti acquisto ${escapeAttr(p.name)}"><button data-action="buy-confirm" data-id="${p.id}">Assegna</button></div>` : '';
  return `<article class="player-card ${st.status}">
    <div class="player-card__body">
      <div class="player-card__head">
        <div class="role-badge">${p.role}</div>
        <div class="player-ident"><div class="player-name">${escapeHtml(p.name)}</div><div class="player-team">${teamCode(p.team)} · ${escapeHtml(p.team || '')}</div></div>
        ${statusMini}
      </div>
      <div class="meta-line">
        ${priorityMarkup(p)}
        ${p.slot ? `<span class="chip slot">${escapeHtml(p.slot)}</span>` : ''}
        <span class="chip">SOS ${escapeHtml(p.sos_tier || '—')}</span>
        <span class="chip starter">${starter.icon}${starter.text ? ' '+escapeHtml(starter.text) : ''}</span>
        ${profile}
        ${price}
      </div>
      ${injury}
      ${links}
      ${note ? `<div class="note">${escapeHtml(note)}</div>` : ''}
      ${statsMarkup(p)}
    </div>
    ${st.status === 'available' ? `<div class="card-actions"><button class="action-btn mine" data-action="buy-start" data-id="${p.id}">✅ MIO</button><button class="action-btn other" data-action="mark-other" data-id="${p.id}">✕ PRESO</button></div>${buyPanel}` : st.status === 'other' ? `<div class="card-actions"><button class="action-btn reset" data-action="reset-other" data-id="${p.id}">↩ DISPONIBILE</button></div>` : ''}
  </article>`;
}

function priceMarkup(p) {
  if (p.target_bid != null || p.stop_bid != null) {
    return `${p.target_bid != null ? `<span class="chip target">🎯 ${fmtBid(p.target_bid)}</span>` : ''}${p.stop_bid != null ? `<span class="chip stop">🛑 ${fmtBid(p.stop_bid)}</span>` : ''}`;
  }
  const mv = p.max_bid;
  if (mv == null) return '';
  let txt = '—';
  if (typeof mv === 'number') txt = mv;
  else if (typeof mv === 'object') txt = mv.min === mv.max ? mv.max : `${mv.min ?? ''}-${mv.max ?? ''}`;
  return `<span class="chip money">💰 ${escapeHtml(String(txt))}</span>`;
}

function priorityMarkup(p) {
  const band = (p.priority_band || '—').toUpperCase();
  const icons = { TARGET:'🎯', VALUE:'💎', ALTERNATIVE:'🧭', JOLLY:'🎲', LOW_COST:'🪙', SCOMMESSA:'🧪' };
  return `<span class="chip primary">${icons[band] || '🏷️'} ${escapeHtml(band)}</span>`;
}

function priorityScore(band='') {
  return ({TARGET:0,VALUE:1,ALTERNATIVE:2,JOLLY:3,LOW_COST:4,SCOMMESSA:5})[String(band).toUpperCase()] ?? 9;
}

function profileMarkup(p) {
  const raw = (p.profile || '').trim();
  if (!raw) return '';
  let icon='💠', text=raw;
  const u = raw.toUpperCase();
  if (u.includes('GK')) icon='🧤';
  else if (u.includes('IBRIDO')) icon='🔀';
  else if (u.includes('BONUS')) icon='⚡';
  else if (/M\+|M\+\+|\bM\b/.test(u)) icon='🛡️';
  else if (u.includes('VALUE')) icon='💰';
  else if (u.includes('SCOMMESSA') || u.includes('JOLLY') || u.includes('UPSIDE')) icon='🎲';
  return `<span class="chip">${icon} ${escapeHtml(text)}</span>`;
}

function starterVisual(status='') {
  const b = starterBucket(status);
  if (b === 'LOCK') return {icon:'🔒',text:'LOCK'};
  if (b === 'FAV') return {icon:'<span class="dot green"></span>',text:'FAV'};
  if (b === 'ROT') return {icon:'<span class="dot orange"></span>',text:'ROT'};
  if (b === 'BAL') return {icon:'<span class="dot red"></span>',text:'BAL'};
  return {icon:'◦',text:status || '—'};
}
function starterBucket(s='') {
  const x = normalize(s);
  if (x.includes('lock') || x.includes('blindata') || x.includes('titolare') || x.includes('molto solida')) return 'LOCK';
  if (x.includes('fav')) return 'FAV';
  if (x.includes('ballott') || x.includes('bal') || x.includes('rischio alternanza')) return 'BAL';
  if (x.includes('rot') || x.includes('ris')) return 'ROT';
  return 'OTHER';
}

function injuryMarkup(p) {
  const av = p.availability || {};
  if (!isInjured(p)) return '';
  const months = /mes|month|nov|dic|gen|round 1[0-9]|giornata 1[0-9]/i.test(`${av.return_info || ''} ${av.note || ''}`);
  const icon = months || av.long_term ? '🚑' : '🩹';
  const text = av.return_info || av.note || (av.long_term ? 'stop lungo' : 'indisponibile');
  return `<div class="meta-line"><span class="injury">${icon} ${escapeHtml(text)}</span></div>`;
}
function isInjured(p) {
  const av = p.availability || {};
  return Boolean(av.long_term || (av.status && av.status !== 'available') || av.note || av.return_info);
}

function linkMarkup(p) {
  const names = resolveRelatedNames(p);
  const pair = p.pair_recommendation;
  if (!names.length && !pair) return '';
  const cls = pair ? String(pair).toLowerCase().startsWith('si') ? 'yes' : pair === 'VAL' ? 'val' : 'no' : '';
  return `<div class="links-row">${names.length ? `<span>🔗</span>${names.map(n => `<button class="player-link" data-player-link="${escapeAttr(n)}">${escapeHtml(n)}</button>`).join('')}` : ''}${pair ? `<span class="pair-label ${cls}">${escapeHtml(pair)}</span>` : ''}</div>`;
}

function resolveRelatedNames(p) {
  const found = new Set();
  if (p.alternative) splitAlternatives(p.alternative).forEach(n => found.add(n));
  if (p.role === 'P') {
    const hay = `${(p.notes||[]).join(' ')} ${p.alternative||''}`.toLowerCase();
    for (const q of app.players.filter(x => x.role === 'P' && x.id !== p.id)) {
      const token = q.name.replace(/^\w\.\s*/,'').toLowerCase();
      if (token.length >= 4 && hay.includes(token)) found.add(q.name);
    }
  }
  return [...found].slice(0,5);
}
function splitAlternatives(v) { return String(v).split(/[\/;,]|\s+\+\s+/).map(x=>x.trim()).filter(Boolean); }

function statsMarkup(p) {
  const s = p.stats || {};
  const parts = [`P${s.appearances ?? '—'}`, `MV ${fmtStat(s.average_rating)}`, `FM ${fmtStat(s.fantasy_average)}`];
  if (p.role === 'P') {
    parts.push(`⭐ ${s.clean_sheets ?? '—'}`, `⚽ ${s.goals_conceded ?? '—'}`, `🧤 ${s.penalties_saved ?? '—'}`);
  } else {
    parts.push(`⚽ ${s.goals ?? '—'}`, `👟 ${s.assists ?? '—'}`, `🟨 ${s.yellow_cards ?? '—'}`, `🟥 ${s.red_cards ?? '—'}`);
  }
  return `<div class="stats-line">${parts.map(x=>`<span>${escapeHtml(String(x))}</span>`).join('')}</div>`;
}
function fmtStat(v) { return v == null ? '—' : Number(v).toFixed(2).replace('.',','); }
function fmtBid(v) { if (typeof v === 'object' && v) return v.min === v.max ? v.max : `${v.min}-${v.max}`; return v; }

function toggleBuyPanel(id) { window.__buyPanel = window.__buyPanel === id ? null : id; renderRoleListOnly(); setTimeout(()=>document.querySelector(`[data-buy-input="${CSS.escape(id)}"]`)?.focus(),0); }
function confirmBuy(id) {
  const input = document.querySelector(`[data-buy-input="${CSS.escape(id)}"]`);
  const price = Number(input?.value);
  if (!Number.isFinite(price) || price < 0) { input?.focus(); return; }
  const prev = clone(getPlayerState(id));
  const p = findPlayer(id);
  app.state.playerStates[id] = { status:'mine', price, assignedSlot: chooseBestSlot(p) };
  saveState(); window.__buyPanel=null;
  setUndo(`Assegnato ${p.name} a ${price}`, () => { app.state.playerStates[id]=prev; saveState(); render(); });
  render();
}
function markOther(id) {
  const prev = clone(getPlayerState(id)); const p=findPlayer(id);
  app.state.playerStates[id] = { status:'other', price:null, assignedSlot:null };
  saveState();
  setUndo(`${p.name} segnato come preso`, () => { app.state.playerStates[id]=prev; saveState(); render(); });
  render();
}
function resetOther(id) {
  const prev = clone(getPlayerState(id)); const p=findPlayer(id);
  app.state.playerStates[id] = { status:'available', price:null, assignedSlot:null };
  saveState();
  setUndo(`${p.name} di nuovo disponibile`, () => { app.state.playerStates[id]=prev; saveState(); render(); });
  render();
}

function clearRoleSearch() {
  app.route.query='';
  const input=document.getElementById('roleSearch');
  if(input) input.value='';
  const clearBtn=document.querySelector('.search-clear');
  if(clearBtn) clearBtn.hidden=true;
  renderRoleListOnly();
  setTimeout(()=>document.getElementById('roleSearch')?.focus(),0);
}

function removeMine(id) {
  const prev = clone(getPlayerState(id)); const p=findPlayer(id);
  app.state.playerStates[id] = { status:'available', price:null, assignedSlot:null };
  saveState();
  setUndo(`${p.name} rimosso dalla rosa`, () => { app.state.playerStates[id]=prev; saveState(); openRoster(); });
  openRoster();
}

function chooseBestSlot(p) {
  const defs = slotDefs(p.role);
  const candidates = String(p.slot || '').split('/').map(s=>s.trim()).filter(s=>defs.some(d=>d.slot===s));
  const pool = candidates.length ? candidates : defs.map(d=>d.slot);
  const counts = assignedSlotCounts(p.role);
  const scored = pool.map(code => {
    const def = defs.find(d=>d.slot===code); const target = quantityMax(def?.quantity); const count=counts[code]||0;
    return {code, deficit: target-count, ratio: target ? count/target : count};
  });
  scored.sort((a,b)=> b.deficit-a.deficit || a.ratio-b.ratio);
  return scored[0]?.code || null;
}

function openDrawer() {
  refreshDrawerContent();
  const d=document.getElementById('filterDrawer'); d.classList.add('open'); d.setAttribute('aria-hidden','false');
}
function closeDrawer() { const d=document.getElementById('filterDrawer'); d.classList.remove('open'); d.setAttribute('aria-hidden','true'); }
function refreshDrawerContent() {
  const root=document.getElementById('drawerContent'); if(!root || !app.route.role) return;
  root.innerHTML = `<div class="filter-block"><h3>Stato</h3><div class="segment">
    ${[['available','Disponibili'],['mine','Miei'],['other','Presi'],['all','Tutti']].map(([v,l])=>`<button data-action="filter-status" data-value="${v}" class="${app.filters.status===v?'active':''}">${l}</button>`).join('')}
  </div></div>
  <div class="filter-block"><h3>Titolarità</h3><div class="segment">
    ${[['ALL','Tutti'],['LOCK','🔒 Lock'],['FAV','● Favorito'],['ROT','● Rotazione'],['BAL','● Ballottaggio']].map(([v,l])=>`<button data-action="filter-starter" data-value="${v}" class="${app.filters.starter===v?'active':''}">${l}</button>`).join('')}
  </div></div>
  <div class="filter-block"><h3>Ordina per</h3><select id="sortSelect">
    ${[['our','Priorità nostra'],['sos','Tier SOS Fanta'],['apps','Presenze prime 4'],['mv','Media voto'],['fm','Fantamedia'],['max','MAX / STOP'],['name','Nome']].map(([v,l])=>`<option value="${v}" ${app.filters.sort===v?'selected':''}>${l}</option>`).join('')}
  </select></div>
  <div class="filter-block"><h3>Filtri aggiuntivi</h3>
    <label class="check-row"><input type="checkbox" data-toggle-filter="injuredOnly" ${app.filters.injuredOnly?'checked':''}> Solo indisponibili/infortunati</label>
    ${app.route.role==='A' || app.route.role==='C' ? `<label class="check-row"><input type="checkbox" data-toggle-filter="penaltyOnly" ${app.filters.penaltyOnly?'checked':''}> 🎯 Solo rigoristi / possibili rigoristi</label>`:''}
    ${app.route.role==='A' ? `<label class="check-row"><input type="checkbox" data-toggle-filter="pairOnly" ${app.filters.pairOnly?'checked':''}> 🔗 Solo profili con coppia/ballottaggio</label>`:''}
  </div>`;
}

function openRoster() {
  const mine = app.players.filter(p => getPlayerState(p.id).status==='mine');
  const residual=app.state.budgetStart-totalSpent();
  openModal('Rosa in composizione', `<div id="rosterSummary">${rosterSummaryMarkup()}</div>
    ${Object.keys(ROLE_LABELS).map(role => {
      const rows=mine.filter(p=>p.role===role);
      return `<section class="roster-role"><h3>${ROLE_SHORT[role]} ${rows.length}/${app.config.league.roster[role]}</h3>
      ${rows.length ? rows.map(rosterRow).join('') : `<div class="subtle">Nessun acquisto.</div>`}</section>`;
    }).join('')}
    <div style="height:4px"></div>`, {wide:true});
}
function rosterRow(p) {
  const st=getPlayerState(p.id); const defs=slotDefs(p.role);
  return `<div class="roster-row">
    <div><strong>${escapeHtml(p.name)}</strong><div class="subtle">${teamCode(p.team)} · ${escapeHtml(p.priority_band||'')}</div></div>
    <input type="number" min="0" inputmode="numeric" value="${st.price ?? 0}" data-roster-price="${p.id}" aria-label="Costo ${escapeAttr(p.name)}">
    <select data-slot-select="${p.id}" aria-label="Slot ${escapeAttr(p.name)}"><option value="">— slot —</option>${defs.map(d=>`<option value="${d.slot}" ${st.assignedSlot===d.slot?'selected':''}>${d.slot}</option>`).join('')}</select>
    <button class="remove-btn" data-action="remove-mine" data-id="${p.id}" aria-label="Rimuovi ${escapeAttr(p.name)}">✕</button>
  </div>`;
}
function rosterSummaryMarkup() {
  const spent=totalSpent(), residual=app.state.budgetStart-spent;
  return `<div class="roster-summary"><div class="summary-box"><span>Budget</span><strong>${residual}</strong></div><div class="summary-box"><span>Speso</span><strong>${spent}</strong></div><div class="summary-box"><span>Rosa</span><strong>${allMine().length}/30</strong></div></div>`;
}
function updateRosterSummary(){ const r=document.getElementById('rosterSummary'); if(r) r.innerHTML=rosterSummaryMarkup(); }

function openSlots(role) {
  if (!role) return;
  const defs=slotDefs(role), counts=assignedSlotCounts(role), mine=mineByRole(role);
  const rows=defs.map(def=>{
    const players=mine.filter(p=>getPlayerState(p.id).assignedSlot===def.slot);
    const target=quantityLabel(def.quantity), max=quantityMax(def.quantity), count=players.length;
    const cls = count>=max ? 'ok' : 'warn';
    return `<div class="slot-row"><div class="slot-code">${escapeHtml(def.slot)}</div><div class="slot-profile">${escapeHtml(def.profile||'')}</div><div class="slot-state ${cls}">${count}/${target}</div>
      ${players.length ? `<div class="slot-players">${players.map(p=>`<span class="slot-player">${escapeHtml(p.name)}</span>`).join('')}</div>` : ''}</div>`;
  }).join('');
  openModal(`Composizione ideale · ${ROLE_SHORT[role]}`, `<div class="subtle" style="margin-bottom:12px">Gli slot sono suggerimenti flessibili: puoi modificarli dalla schermata Rosa. Se sovracopri un profilo vedrai, ad esempio, 2/1.</div><div class="slot-list">${rows}</div>`, {wide:true});
}

function openSettings() {
  openModal('Backup e impostazioni', `<div class="settings-grid">
    <div class="settings-action"><div><strong>💾 Backup completo</strong><p>Esporta stato asta, prezzi e slot in JSON.</p></div><button class="btn" data-action="confirm-export-backup">Esporta</button></div>
    <div class="settings-action"><div><strong>📤 Export rosa per ChatGPT</strong><p>File TXT leggibile per analisi e formazioni.</p></div><button class="btn" data-action="confirm-export-team">Esporta</button></div>
    <div class="settings-action"><div><strong>📥 Import backup</strong><p>Sovrascrive lo stato locale dopo conferma.</p></div><button class="btn" data-action="import">Importa</button></div>
    ${app.installPrompt ? `<div class="settings-action"><div><strong>📲 Installa PWA</strong><p>Aggiungi l'app alla schermata Home.</p></div><button class="btn primary" data-action="install">Installa</button></div>`:''}
    <div class="settings-action"><div><strong>⚠️ Reset asta</strong><p>Ripristina tutti i calciatori come disponibili.</p></div><button class="btn danger" data-action="reset">Reset</button></div>
  </div><div class="subtle" style="margin-top:14px">Dataset: ${escapeHtml(app.state.dataVersion||'—')} · dati locali aggiornati ${escapeHtml(new Date(app.state.updatedAt).toLocaleString('it-IT'))}</div>`);
}

function openModal(title, body, options={}) {
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" role="presentation"><section class="modal ${options.wide?'':'small'}" role="dialog" aria-modal="true"><div class="modal__header"><h2>${escapeHtml(title)}</h2><button class="icon-btn dark" data-close-modal aria-label="Chiudi">✕</button></div><div class="modal__body">${body}</div></section></div>`;
}
function closeModal() { document.getElementById('modalRoot').innerHTML=''; }
function confirmDialog(title, message, onConfirm, danger=false) {
  openModal(title, `<p style="margin-top:0">${escapeHtml(message)}</p><div class="modal__footer"><button class="btn" data-close-modal>Annulla</button><button id="confirmModalBtn" class="btn ${danger?'danger':'primary'}">Conferma</button></div>`);
  document.getElementById('confirmModalBtn').onclick=()=>{ closeModal(); onConfirm(); };
}

function exportBackup() {
  const payload={ app:'FantAsta 2026/27', exportedAt:new Date().toISOString(), dataVersion:app.state.dataVersion, state:app.state };
  downloadBlob(`fantasta-backup-${dateStamp()}.json`, JSON.stringify(payload,null,2), 'application/json');
  toast('Backup esportato.');
}
function exportTeamText() {
  const lines=[];
  for (const role of Object.keys(ROLE_LABELS)) {
    lines.push(`${ROLE_SHORT[role]}`);
    for (const p of mineByRole(role)) { const st=getPlayerState(p.id); lines.push(`${p.name} - ${st.price} cr${st.assignedSlot ? ` - ${st.assignedSlot}`:''}`); }
    lines.push('');
  }
  lines.push(`Budget iniziale: ${app.state.budgetStart}`);
  lines.push(`Speso: ${totalSpent()}`);
  lines.push(`Budget residuo: ${app.state.budgetStart-totalSpent()}`);
  lines.push(`Dataset: ${app.state.dataVersion||'—'}`);
  downloadBlob(`rosa-fantasta-${dateStamp()}.txt`, lines.join('\n'), 'text/plain;charset=utf-8');
  toast('Rosa esportata.');
}
async function handleImportFile(e) {
  const file=e.target.files?.[0]; e.target.value=''; if(!file) return;
  try {
    const obj=JSON.parse(await file.text());
    const incoming=obj.state || obj;
    if (!incoming.playerStates || typeof incoming.budgetStart!=='number') throw new Error('Formato backup non valido');
    confirmDialog('Importare questo backup?', `Lo stato locale attuale verrà sostituito dal backup del ${obj.exportedAt ? new Date(obj.exportedAt).toLocaleString('it-IT') : 'file selezionato'}.`, ()=>{
      app.state=incoming; normalizeState(); saveState(); render(); toast('Backup importato.');
    }, true);
  } catch(err) { toast(`Import fallito: ${err.message}`); }
}
function resetAuction() { app.state=emptyState(); app.state.budgetStart=app.config.league.budget; app.state.dataVersion=app.config.data_version; normalizeState(); saveState(); render(); toast('Asta azzerata.'); }
function downloadBlob(name, content, type) { const url=URL.createObjectURL(new Blob([content],{type})); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }

function jumpToPlayer(name) {
  const p=findByLooseName(name);
  if (!p) { toast(`Giocatore non trovato: ${name}`); return; }
  app.filters.status='all'; saveFilters();
  location.hash=`#/role/${p.role}?q=${encodeURIComponent(p.name)}`;
  closeModal(); closeDrawer();
}

function setUndo(message, fn) { app.undo=fn; toast(message,true); }
function undoLast() { if(app.undo){ const fn=app.undo; app.undo=null; fn(); toast('Operazione annullata.'); } }
function toast(message, undo=false) {
  const root=document.getElementById('toastRoot');
  root.innerHTML=`<div class="toast"><span>${escapeHtml(message)}</span>${undo?'<button data-action="undo">ANNULLA</button>':''}</div>`;
  clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>{root.innerHTML=''; if(undo) app.undo=null;},4500);
}

function totalSpent(){ return allMine().reduce((sum,p)=>sum+(Number(getPlayerState(p.id).price)||0),0); }
function allMine(){ return app.players.filter(p=>getPlayerState(p.id).status==='mine'); }
function mineByRole(role){ return allMine().filter(p=>p.role===role); }
function availableByRole(role){ return app.players.filter(p=>p.role===role && getPlayerState(p.id).status==='available'); }
function getPlayerState(id){ return app.state.playerStates[id] || {status:'available',price:null,assignedSlot:null}; }
function findPlayer(id){ return app.players.find(p=>p.id===id); }
function findByLooseName(name){ const n=normalize(name); return app.players.find(p=>normalize(p.name)===n) || app.players.find(p=>normalize(p.name).includes(n) || n.includes(normalize(p.name))); }
function slotDefs(role){ return app.config?.auction_strategy?.role_slots?.[role] || []; }
function assignedSlotCounts(role){ const out={}; for(const p of mineByRole(role)){const s=getPlayerState(p.id).assignedSlot;if(s)out[s]=(out[s]||0)+1;} return out; }
function quantityMax(q){ if(typeof q==='number') return q; const nums=String(q||'1').match(/\d+/g)?.map(Number)||[1]; return Math.max(...nums); }
function quantityLabel(q){ return q ?? 1; }
function maxValue(p){ if(p.stop_bid!=null) return Number(typeof p.stop_bid==='object'?p.stop_bid.max:p.stop_bid)||0; if(p.max_bid==null)return 0; if(typeof p.max_bid==='number')return p.max_bid; return Number(p.max_bid.max ?? p.max_bid.min ?? 0); }
function hasPenaltyDuty(p){ return p.penalties != null && String(p.penalties).trim() !== '' && !/no|none/i.test(String(p.penalties)); }
function sosScore(t){ const x=String(t||'').toUpperCase(); const map=[['SUPER TOP',1],['TOP',2],['SEMITOP',3],['SOTTO SEMI',4],['FASCIA ALTA',5],['JOLLY 1',6],['SORPRESA',7],['FASCIA MEDIA',8],['SOPRA LOW',9],['LOW 1',10],['JOLLY 2',11],['LOW 2',12],['SCOMMESSA',13],['LEGHE NUM',14]]; for(const [k,v] of map)if(x.includes(k))return v; return 99; }
function statusLabel(s){ return ({available:'Disponibili',mine:'Miei',other:'Presi',all:'Tutti'})[s]||s; }
function sortLabel(s){ return ({our:'priorità nostra',sos:'tier SOS',apps:'presenze',mv:'MV',fm:'FM',max:'MAX/STOP',name:'nome'})[s]||s; }
function teamCode(team){ return TEAM_CODES[team] || String(team||'---').slice(0,3).toUpperCase(); }
function searchable(p){ return normalize([p.name,p.team,p.role,p.priority_band,p.sos_tier,p.slot,p.profile,(p.notes||[]).join(' '),p.alternative].filter(Boolean).join(' ')); }
function normalize(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function dateStamp(){ return new Date().toISOString().slice(0,10); }
function escapeHtml(v){ return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(v){ return escapeHtml(v).replace(/'/g,'&#39;'); }

async function installApp(){ if(!app.installPrompt)return; app.installPrompt.prompt(); await app.installPrompt.userChoice; app.installPrompt=null; closeModal(); }
function registerSW(){ if('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./service-worker.js').catch(()=>{}); }

init();
