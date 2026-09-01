// Match History - loaded from real server data; no demo matches.
let allMatches = [];
let filteredMatches = [];
const matchListEl = document.querySelector('#match-list');
const matchPreviewEl = document.querySelector('#match-preview');

function escapeHtml(v) { return String(v ?? '').replace(/[&<>\"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;' }[c])); }

function renderHistoryRows(items) {
  return items.map((m, index) => {
    const mapImage = m.mapSplash ? '/api/img?url=' + encodeURIComponent(m.mapSplash) : '';
    const agentImage = m.agentIcon ? '/api/img?url=' + encodeURIComponent(m.agentIcon) : '';
    const duration = m.duration != null ? Math.floor(Number(m.duration)) + 'm' : '—';
    const rr = m.rr != null ? m.rr : null;
    const acs = m.acs != null ? m.acs : null;
    return '<article class="history-card ' + (m.result === 'VICTORY' ? 'history-win' : 'history-loss') + '"' +
      (mapImage ? ' style="--history-map:url(\'' + escapeAttr(mapImage) + '\')"' : '') + '>' +
      '<div class="history-card-main">' +
        '<div class="history-card-top"><b class="outcome ' + (m.result === 'VICTORY' ? 'win' : 'loss') + '">' + escapeHtml(m.result) + '</b><span>' + escapeHtml(m.mode) + '</span><time>' + escapeHtml(m.date) + '</time></div>' +
        '<div class="history-card-info">' +
          (agentImage ? '<img class="history-agent" src="' + escapeAttr(agentImage) + '" alt="' + escapeAttr(m.agent || 'Agent') + '" loading="lazy" onerror="this.remove();this.parentElement.classList.add(\'agent-missing\');" />' : '<span class="history-agent placeholder">—</span>') +
          '<div><h2>' + escapeHtml(m.map) + '</h2><p>' + escapeHtml(m.agent || '—') + ' · ' + escapeHtml(duration) + '</p><span class="history-rank">' + (m.rank ? escapeHtml(m.rank) : 'Rank unavailable') + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="history-stats">' +
        '<div><small>SCORE</small><b>' + escapeHtml(m.score || '—') + '</b></div>' +
        '<div><small>KDA</small><b>' + escapeHtml(m.kda || '—') + '</b></div>' +
        '<div><small>ACS</small><b>' + escapeHtml(acs != null ? acs : '—') + '</b></div>' +
        (rr != null ? '<div><small>RR</small><b>' + escapeHtml(rr) + '</b></div>' : '') +
      '</div>' +
      '<button type="button" class="history-teams" data-history-index="' + index + '">⌄ &nbsp; View Teams</button>' +
      '<div class="history-teams-panel" data-teams-index="' + index + '" hidden></div>' +
      '</article>';
  }).join('');
}
// Overview latest-matches preview: waiting state. profile-ui.js renders real data.
if (matchPreviewEl) matchPreviewEl.innerHTML = '<div class="empty-state"><b>&#9676;</b><h2>Waiting for data</h2><p>Connect an account source to see your recent matches here.</p></div>';

function renderMatchHistory() {
  if (!matchListEl) return;
  if (!allMatches.length) {
    matchListEl.innerHTML = '<div class="empty-state"><b>&#9676;</b><h2>Waiting for data</h2><p>Connect an account source to see your match history here.</p></div>';
    return;
  }
  matchListEl.innerHTML = renderHistoryRows(filteredMatches);
}

// Build the per-match teams panel from the real match-detail payload.
function rosterRowHTML(p) {
  const name = escapeHtml(p.name || 'Unknown');
  const agent = p.agentIcon
    ? '<img class="ht-agent" src="' + escapeAttr(p.agentIcon) + '" alt="" loading="lazy" />'
    : '<span class="ht-agent placeholder"></span>';
  return '<div class="ht-row">' +
    '<span class="ht-name">' + agent + '<b>' + name + '</b>' + (p.puuid === '' ? '' : '') + '</span>' +
    '<span>' + escapeHtml(p.agent || '—') + '</span>' +
    '<span>' + (Number(p.kills) || 0) + ' / ' + (Number(p.deaths) || 0) + ' / ' + (Number(p.assists) || 0) + '</span>' +
    '<span>' + (p.acs != null ? escapeHtml(p.acs) : '—') + '</span>' +
    '<span>' + (p.adr != null ? escapeHtml(p.adr) : '—') + '</span>' +
    '</div>';
}
function rosterHeadHTML() {
  return '<div class="ht-row ht-row-head">' +
    '<span>PLAYER</span><span>AGENT</span><span>K/D/A</span><span>ACS</span><span>ADR</span>' +
    '</div>';
}
function historyTeamHTML(team) {
  const t = team || {};
  const tag = (t.roundsWon != null)
    ? (escapeHtml(t.roundsWon) + ' rounds' + (t.won ? ' · WIN' : ''))
    : '';
  const rows = (t.players || []);
  return '<div class="ht-team-block">' +
    '<p class="eyebrow ht-team-label">' + escapeHtml(t.label || 'TEAM') + (tag ? ' &nbsp;·&nbsp; ' + tag : '') + '</p>' +
    rosterHeadHTML() +
    (rows.length ? rows.map(rosterRowHTML).join('') : '<p class="dim">No players available.</p>') +
    '</div>';
}
function historyStandingsHTML(detail) {
  const rows = (detail.players || []);
  return '<div class="ht-team-block">' +
    '<p class="eyebrow ht-team-label">STANDINGS &nbsp;·&nbsp; DEATHMATCH</p>' +
    rosterHeadHTML() +
    (rows.length ? rows.map(rosterRowHTML).join('') : '<p class="dim">No players available.</p>') +
    '</div>';
}
function historyTeamsHTML(m, d) {
  if (!d) return '<p class="dim">Team data unavailable.</p>';
  if (d.source === 'none') return '<p class="dim">' + escapeHtml(d.error || 'Team data unavailable.') + '</p>';
  const meta = '<p class="dim ht-meta">' + escapeHtml(m.map || d.map || '') + ' · ' + escapeHtml(d.mode || m.mode || '') + ' · ' + escapeHtml(m.score || '') + '</p>';
  const body = d.deathmatch
    ? historyStandingsHTML(d)
    : ((Array.isArray(d.teams) && d.teams.length) ? d.teams.map(historyTeamHTML).join('') : '');
  if (!body) return '<p class="dim">' + escapeHtml((d && d.error) || 'Team data unavailable.') + '</p>';
  return meta + body;
}

// Wire up the existing View Teams buttons (delegated so re-renders keep working).
if (matchListEl) {
  matchListEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.history-teams');
    if (!btn) return;
    const idx = Number(btn.getAttribute('data-history-index'));
    const match = filteredMatches[idx];
    if (match == null) return;
    const panel = matchListEl.querySelector('.history-teams-panel[data-teams-index="' + idx + '"]');
    if (!panel) return;
    const closed = panel.hidden;
    matchListEl.querySelectorAll('.history-teams-panel').forEach((p) => { p.hidden = true; });
    matchListEl.querySelectorAll('.history-teams').forEach((b) => { b.innerHTML = '⌄ &nbsp; View Teams'; });
    if (!closed) return;
    panel.innerHTML = '<p class="dim">Loading team data…</p>';
    panel.hidden = false;
    btn.innerHTML = '⌃ &nbsp; Hide Teams';
    let d = null;
    if (match.matchId) {
      try {
        const r = await fetch('/api/match-detail?matchId=' + encodeURIComponent(match.matchId));
        d = await r.json();
      } catch (err) { d = null; }
    }
    panel.innerHTML = historyTeamsHTML(match, d);
  });
}

async function loadMatchHistory() {
  try {
    const data = await fetch('/api/match-history').then((r) => r.json());
    if (!data || data.source === 'none' || !Array.isArray(data.matches) || !data.matches.length) {
      allMatches = [];
      filteredMatches = [];
      renderMatchHistory();
      return;
    }
    allMatches = data.matches;
    filteredMatches = allMatches;
    renderMatchHistory();
  } catch {
    allMatches = [];
    filteredMatches = [];
    renderMatchHistory();
  }
}

// Overview recent-form chart: waiting state until real competitive data exists.
const formChart = document.querySelector('#form-chart');
if (formChart) formChart.innerHTML = '<span class="dim" style="align-self:end;padding-bottom:10px">Waiting for data</span>';

const labels={overview:'OVERVIEW',live:'LIVE MATCH',party:'PARTY',matches:'MATCH HISTORY',players:'PLAYER LOOKUP',settings:'SETTINGS'};
function showPage(id){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.page===id));document.querySelector('#page-label').textContent=labels[id];window.scrollTo({top:0,behavior:'smooth'});}
document.querySelectorAll('.nav-link').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.go)));

let activeMode = 'All modes';
let searchQuery = '';
function applyMatchFilters() {
  const q = searchQuery;
  filteredMatches = allMatches.filter((m) => {
    const modeOK = activeMode === 'All modes' || String(m.mode || '').toLowerCase() === activeMode.toLowerCase();
    if (!modeOK) return false;
    if (!q) return true;
    return [m.result, m.map, m.mode, m.agent, m.score, m.kills, m.deaths, m.assists]
      .join(' ').toLowerCase().includes(q);
  });
  renderMatchHistory();
}
document.querySelector('#match-query').addEventListener('input',(e)=>{
  searchQuery = e.target.value.toLowerCase().trim();
  applyMatchFilters();
});
document.querySelectorAll('.filter').forEach((b)=>b.addEventListener('click',()=>{
  document.querySelectorAll('.filter').forEach((x)=>x.classList.remove('selected'));
  b.classList.add('selected');
  activeMode = b.textContent;
  applyMatchFilters();
}));

loadMatchHistory();
// Loadouts — loaded from real Riot Client data; no demo weapons.
const weaponGridEl = document.querySelector('#weapon-grid');
const mostUsedGridEl = document.querySelector('#most-used-grid');
const sprayGridEl = document.querySelector('#spray-grid');
function weaponArtwork(item) {
  if (!item) return '';
  const skin = String(item.skin || '').trim().toLowerCase();
  const isStandard = !skin || skin === 'standard' || skin.startsWith('standard ');
  return (isStandard ? item.weaponIcon : (item.skinIcon || item.weaponIcon)) || '';
}
function loadoutImageUrl(url) {
  const value = String(url || '').trim();
  if (!/^https:\/\/media\.valorant-api\.com\//i.test(value)) return '';
  return '/api/img?url=' + encodeURIComponent(value);
}
function weaponImage(artwork, alt, fallback) {
  const src = loadoutImageUrl(artwork);
  const fallbackSrc = loadoutImageUrl(fallback);
  if (!src) return '';
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt || '')}" loading="lazy" data-fallback="${escapeHtml(fallbackSrc)}" onerror="if(this.dataset.fallback && this.dataset.fallback !== this.src){var next=this.dataset.fallback;this.dataset.fallback='';this.src=next}else{var box=this.closest('.weapon-thumb,.most-used-art');if(box){box.classList.add('image-failed')}this.remove()}" />`;
}
function renderMostUsed(items) {
  if (!mostUsedGridEl) return;
  const preferred = ['Vandal', 'Phantom', 'Melee'];
  const cards = preferred.map((name) => items.find((item) => String(item.weapon || '').toLowerCase() === name.toLowerCase())).filter(Boolean);
  const fallback = items.filter((item) => !cards.includes(item));
  const shown = cards.concat(fallback).slice(0, 3);
  mostUsedGridEl.innerHTML = shown.length ? shown.map((item) => {
    const art = weaponArtwork(item);
    return `<article class="most-used-card"><span class="most-used-art">${weaponImage(art, item.skin || item.weapon, item.weaponIcon)}</span><span class="most-used-meta"><small>${escapeHtml(item.weapon || 'Weapon')}</small><b>${escapeHtml(item.skin || item.weapon || 'Unknown')}</b></span></article>`;
  }).join('') : '<p class="dim">No equipped weapons available.</p>';
}
function renderLoadouts(items) {
  if (!weaponGridEl) return;
  if (!items || !items.length) {
    weaponGridEl.innerHTML = '<div class="empty-state"><b>&#9676;</b><h2>Waiting for data</h2><p>Connect the Riot Client to see your current loadout here.</p></div>';
    return;
  }
  renderMostUsed(items);
  weaponGridEl.innerHTML = items.map((item) => {
    const artwork = weaponArtwork(item);
    const thumb = `<span class="weapon-thumb${artwork ? '' : ' placeholder'}">${weaponImage(artwork, item.skin || item.weapon, item.weaponIcon)}</span>`;
    const buddy = item.buddy && item.buddy.icon
      ? `<img class="buddy-icon" src="${escapeHtml(loadoutImageUrl(item.buddy.icon))}" alt="" title="${escapeHtml(item.buddy.name || 'Gun buddy')}" loading="lazy" onerror="this.remove();" />`
      : '';
    return `<span>${buddy}${thumb}<span class="weapon-text"><span>${escapeHtml(item.weapon || 'Unknown')}</span><b>${escapeHtml(item.skin || '')}</b></span></span>`;
  }).join('');
}
function renderSprays(sprays) {
  if (!sprayGridEl) return;
  if (!Array.isArray(sprays) || !sprays.length) {
    sprayGridEl.innerHTML = '<p class="dim">Connect the Riot Client to see your equipped sprays here.</p>';
    return;
  }
  sprayGridEl.innerHTML = sprays.map((spray) => {
    const name = (spray.equipped === false || !spray.id) ? 'Empty' : (spray.name || 'Spray');
    const img = spray.image
      ? (loadoutImageUrl(spray.image) ? `<img src="${escapeHtml(loadoutImageUrl(spray.image))}" alt="${escapeHtml(name)}" loading="lazy" onerror="var c=this.closest('.spray-card');if(c){c.classList.add('image-failed')}this.remove();" />` : '')
      : '';
    return `<span class="spray-card">${img}<b>${escapeHtml(name)}</b></span>`;
  }).join('');
}
async function loadLoadouts() {
  try {
    const data = await fetch('/api/loadouts').then((r) => r.json());
    if (!data || data.source === 'none' || !Array.isArray(data.items) || !data.items.length) {
      renderLoadouts([]);
    } else {
      renderLoadouts(data.items);
    }
    renderSprays(data && data.sprays);
  } catch {
    renderLoadouts([]);
    renderSprays([]);
  }
}
loadLoadouts();

// ── Change Skins drawer (Valshy-style, real loadout data) ─────────────────────
// Built from the existing /api/loadouts payload (real equipped weapons/skins/
// buddies). Artwork always goes through the same-origin /api/img proxy. Only
// presentation is added here; Nightfall has NO Riot loadout-mutation endpoint,
// so equipping is reported honestly instead of faked.
const SKIN_CATEGORIES = [
  ['SIDEARMS', ['Classic', 'Shorty', 'Frenzy', 'Ghost', 'Sheriff']],
  ['SMGS', ['Stinger', 'Spectre']],
  ['SHOTGUNS', ['Bucky', 'Judge']],
  ['RIFLES', ['Bulldog', 'Guardian', 'Phantom', 'Vandal']],
  ['SNIPERS', ['Marshal', 'Outlaw', 'Operator']],
  ['HEAVY', ['Ares', 'Odin']],
  ['MELEE', ['Melee']],
];
function skinCategoryOf(weapon) {
  const w = String(weapon || '').toLowerCase();
  for (const section of SKIN_CATEGORIES) {
    if (section[1].some((x) => x.toLowerCase() === w)) return section[0];
  }
  return 'OTHER';
}
// SKIN_MODULE_1
let skinsState = { tab: 'skins', view: 'main', selectedWeaponId: null, q: '', items: [], inventory: [], loading: false, lastFocus: null };
let skinsDrawerEl = null;
function ensureSkinsDrawer() {
  if (skinsDrawerEl && document.getElementById('skins-drawer')) return skinsDrawerEl;
  const wrap = document.createElement('div');
  wrap.className = 'sk-wrap';
  wrap.id = 'skins-drawer';
  wrap.innerHTML =
    '<div class="sk-backdrop" data-skins-close></div>' +
    '<aside class="sk-drawer" role="dialog" aria-modal="true" aria-label="Change weapon skins">' +
      '<header class="sk-head">' +
        '<button type="button" class="sk-back" data-skins-back aria-label="Back">\u2190</button>' +
        '<h2 id="skins-title">CHANGE WEAPON SKINS</h2>' +
        '<button type="button" class="sk-x" data-skins-close aria-label="Close">\u2715</button>' +
      '</header>' +
      '<div class="sk-tabs" role="tablist">' +
        '<button type="button" class="sk-tab active" data-skins-tab="skins" role="tab">SKINS</button>' +
        '<button type="button" class="sk-tab" data-skins-tab="buddies" role="tab">BUDDIES</button>' +
      '</div>' +
      '<div class="sk-search">' +
        '<input id="skins-search" type="text" placeholder="Search skins..." autocomplete="off" />' +
        '<button type="button" class="sk-tool" data-skins-random title="Randomize view">\u2928</button>' +
        '<button type="button" class="sk-tool" data-skins-refresh title="Refresh from Riot Client">\u21bb</button>' +
      '</div>' +
      '<div class="sk-body" id="skins-body" tabindex="-1"></div>' +
      '<footer class="sk-status" id="skins-status"></footer>' +
    '</aside>';
  document.body.appendChild(wrap);
  skinsDrawerEl = wrap;

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-skins-close]')) { e.preventDefault(); closeSkinsPanel(); return; }
    if (e.target.closest('[data-skins-back]')) { e.preventDefault(); skinsBack(); return; }
    const tab = e.target.closest('[data-skins-tab]');
    if (tab) { setSkinsTab(tab.getAttribute('data-skins-tab')); return; }
    if (e.target.closest('[data-skins-refresh]')) { skinsLoad(true); return; }
    if (e.target.closest('[data-skins-random]')) { skinsRandomView(); return; }
    const equip = e.target.closest('[data-skin-equip]');
    if (equip) { skinsEquip(equip.getAttribute('data-skin-equip')); return; }
    const weapon = e.target.closest('[data-skins-weapon]');
    if (weapon) { openSkinCollection(weapon.getAttribute('data-skins-weapon')); return; }
  });

  const search = wrap.querySelector('#skins-search');
  if (search) search.addEventListener('input', () => { skinsState.q = search.value.trim().toLowerCase(); skinsRender(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !wrap.hidden) closeSkinsPanel(); });
  return wrap;
}
function openSkinsPanel() {
  const wrap = ensureSkinsDrawer();
  skinsState.view = 'main';
  skinsState.selectedWeaponId = null;
  skinsState.q = '';
  wrap.hidden = false;
  requestAnimationFrame(() => wrap.classList.add('open'));
  document.body.classList.add('sk-open');
  skinsLoad();
  const close = wrap.querySelector('.sk-x');
  if (close) close.focus();
}
function closeSkinsPanel() {
  const wrap = ensureSkinsDrawer();
  wrap.classList.remove('open');
  wrap.hidden = true;
  document.body.classList.remove('sk-open');
}
function setSkinsTab(tab) {
  if (tab !== 'skins' && tab !== 'buddies') return;
  skinsState.tab = tab;
  const wrap = ensureSkinsDrawer();
  wrap.querySelectorAll('.sk-tab').forEach((el) => el.classList.toggle('active', el.dataset.skinsTab === tab));
  skinsRender();
}
function skinsBack() {
  if (skinsState.view !== 'collection') { closeSkinsPanel(); return; }
  skinsState.view = 'main';
  skinsState.selectedWeaponId = null;
  skinsState.q = '';
  const wrap = ensureSkinsDrawer();
  const search = wrap.querySelector('#skins-search');
  if (search) search.value = '';
  skinsRender();
}
function openSkinCollection(weaponId) {
  const group = (skinsState.inventory || []).find((item) => item.weaponId === weaponId);
  if (!group) return;
  skinsState.view = 'collection';
  skinsState.selectedWeaponId = weaponId;
  skinsState.q = '';
  const wrap = ensureSkinsDrawer();
  const search = wrap.querySelector('#skins-search');
  const title = wrap.querySelector('#skins-title');
  if (search) search.value = '';
  if (title) title.textContent = `${String(group.weaponName || 'WEAPON').toUpperCase()} COLLECTION`;
  skinsRender();
}
async function skinsLoad() {
  const wrap = ensureSkinsDrawer();
  const body = wrap.querySelector('#skins-body');
  const status = wrap.querySelector('#skins-status');
  if (body) body.innerHTML = '<div class="sk-empty">Loading loadout…</div>';
  try {
    const [data, inventory] = await Promise.all([
      fetch('/api/loadouts').then((r) => r.json()),
      fetch('/api/loadout-skins').then((r) => r.json()),
    ]);
    skinsState.items = Array.isArray(data && data.items) ? data.items : [];
    skinsState.inventory = Array.isArray(inventory && inventory.weapons) ? inventory.weapons : [];
    if (status) status.textContent = skinsState.inventory.length ? 'Showing your owned Riot Client skins.' : 'No owned skin inventory available.';
    skinsRender();
  } catch {
    if (status) status.textContent = 'Could not reach the local server.';
    if (body) body.innerHTML = '<div class="sk-empty">Loadout unavailable.</div>';
  }
}
function skinsRender() {
  const wrap = ensureSkinsDrawer();
  const body = wrap.querySelector('#skins-body');
  if (!body) return;
  const q = skinsState.q;
  const items = skinsState.items || [];
  if (skinsState.tab === 'buddies') {
    const buddies = items.filter((it) => it.buddy && (!q || String(it.buddy.name || '').toLowerCase().includes(q)));
    body.innerHTML = buddies.length
      ? `<section class="sk-section"><h3 class="sk-cat">EQUIPPED BUDDIES</h3><div class="sk-grid">${buddies.map((it) => `<article class="sk-card"><span class="sk-art">${it.buddy.icon ? `<img src="${escapeHtml(loadoutImageUrl(it.buddy.icon))}" alt="" loading="lazy" onerror="this.remove()" />` : ''}</span><span class="sk-meta"><small>${escapeHtml(it.weapon || 'Weapon')}</small><b>${escapeHtml(it.buddy.name || 'Gun buddy')}</b></span><span class="sk-equipped">✓ EQUIPPED</span></article>`).join('')}</div></section>`
      : '<div class="sk-empty">No matching gun buddies.</div>';
    return;
  }
  const inventory = skinsState.inventory || [];
  if (skinsState.view === 'collection') {
    const selected = inventory.find((group) => group.weaponId === skinsState.selectedWeaponId);
    const skins = selected ? (selected.skins || []).filter((skin) => !q || String(skin.name || '').toLowerCase().includes(q)) : [];
    body.innerHTML = skins.length
      ? `<section class="sk-section"><h3 class="sk-cat">OWNED SKINS</h3><div class="sk-grid">${skins.map((skin) => skinsWeaponCard({ ...skin, weaponId: selected.weaponId, weapon: selected.weaponName })).join('')}</div></section>`
      : '<div class="sk-empty">No matching owned skins.</div>';
    return;
  }
  const currentByWeapon = new Map((items || []).map((item) => [String(item.weaponId || '').toLowerCase(), item]));
  const groups = inventory
    .map((group) => {
      const current = currentByWeapon.get(String(group.weaponId || '').toLowerCase());
      const equipped = (group.skins || []).find((skin) => skin.equipped) || (current ? { name: current.skin, icon: current.skinIcon, skinId: current.skinId, equipped: true } : null);
      return { ...group, equipped };
    })
    .filter((group) => group.equipped && (!q || `${group.weaponName || ''} ${group.equipped.name || ''}`.toLowerCase().includes(q)));
  let html = '';
  const most = ['Vandal', 'Phantom', 'Melee'].map((name) => groups.find((group) => String(group.weaponName || '').toLowerCase() === name.toLowerCase())).filter(Boolean);
  if (most.length) html += `<section class="sk-section"><h3 class="sk-cat">MOST USED</h3><div class="sk-grid">${most.map((group) => skinsWeaponMainCard(group)).join('')}</div></section>`;
  for (const [label, names] of SKIN_CATEGORIES) {
    const group = groups.filter((it) => names.some((name) => name.toLowerCase() === String(it.weaponName || '').toLowerCase()));
    if (group.length) html += `<section class="sk-section"><h3 class="sk-cat">${escapeHtml(label)}</h3><div class="sk-grid">${group.map(skinsWeaponMainCard).join('')}</div></section>`;
  }
  body.innerHTML = html || '<div class="sk-empty">No matching equipped weapons.</div>';
}
function skinsWeaponMainCard(group) {
  const skin = group.equipped || {};
  const art = skin.icon || skin.skinIcon || '';
  const image = art ? weaponImage(art, skin.name || group.weaponName, null) : '';
  const buddy = (skinsState.items || []).find((item) => String(item.weaponId || '').toLowerCase() === String(group.weaponId || '').toLowerCase());
  const buddyIcon = buddy && buddy.buddy && buddy.buddy.icon
    ? `<img class="sk-buddy" src="${escapeHtml(loadoutImageUrl(buddy.buddy.icon))}" alt="" loading="lazy" onerror="this.remove();" />`
    : '';
  return `<article class="sk-card sk-weapon-card" data-skins-weapon="${escapeAttr(group.weaponId)}"><span class="sk-art">${buddyIcon}${image}</span><span class="sk-meta"><small>${escapeHtml(group.weaponName || 'Weapon')}</small><b>${escapeHtml(skin.name || 'Standard')}</b></span><span class="sk-equipped">✓ EQUIPPED</span></article>`;
}
function skinsWeaponCard(item) {
  const art = item.icon || item.skinIcon || weaponArtwork(item);
  const image = art ? weaponImage(art, item.skin || item.weapon, item.weaponIcon) : '';
  const equipped = Boolean(item.equipped);
  const action = equipped
    ? '<span class="sk-equipped">✓ EQUIPPED</span>'
    : (item.weaponId && item.skinId
      ? `<button type="button" class="sk-equip" data-skin-equip="${escapeAttr(JSON.stringify({ weaponId: item.weaponId, skinId: item.skinId }))}">EQUIP</button>`
      : '');
  return `<article class="sk-card${equipped ? ' equipped' : ''}"><span class="sk-art">${image}</span><span class="sk-meta"><small>${escapeHtml(item.weapon || 'Weapon')}</small><b>${escapeHtml(item.name || item.skin || item.weapon || 'Unknown')}</b></span>${action}</article>`;
}
async function skinsEquip(serialized) {
  const status = document.querySelector('#skins-status');
  let target;
  try { target = JSON.parse(serialized || '{}'); } catch { target = null; }
  if (!target || !target.weaponId || !target.skinId) {
    if (status) status.textContent = 'No selectable skin ID is available in the current loadout data.';
    return;
  }
  if (status) status.textContent = 'Equipping…';
  try {
    const response = await fetch('/api/loadouts/equip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      if (status) status.textContent = (result && result.message) || 'Could not equip skin.';
      return;
    }
    if (status) status.textContent = 'Skin equipped in Riot Client. Refreshing loadout…';
    await skinsLoad();
    await loadLoadouts();
  } catch {
    if (status) status.textContent = 'Could not reach the local server.';
  }
}
function skinsRandomView() {
  const cards = document.querySelectorAll('#skins-body .sk-card');
  if (!cards.length) return;
  cards[Math.floor(Math.random() * cards.length)].scrollIntoView({ behavior: 'smooth', block: 'center' });
}
// SKIN_MODULE_2
document.querySelector('#motion-toggle').addEventListener('change',e=>document.body.classList.toggle('reduce-motion',e.target.checked));document.querySelector('#contrast-toggle').addEventListener('change',e=>document.body.classList.toggle('contrast',e.target.checked));

// Credentials never enter the browser. When the local server is configured with
// approved Riot credentials, it exposes a connection state and verified account.
fetch('/api/status').then(r=>r.json()).then(status=>{
  if (!status.configured) return;
  document.querySelector('.client-status').innerHTML='<i style="background:#92e899;box-shadow:0 0 10px #92e899"></i> RIOT DATA CONNECTED';
  return fetch('/api/summary').then(r=>r.json()).then(summary=>{
    if (summary.error) throw new Error(summary.error);
    document.querySelector('.profile b').textContent=summary.account.gameName;
    document.querySelector('.profile span').textContent='#'+summary.account.tagLine;
    console.info('Official Riot match list loaded', summary.matches);
  });
}).catch(error=>console.info('Nightfall remains in demo mode:', error.message));
// Live Riot Client overlay — read-only. The browser only talks to the local
// Nightfall server ('/api/live'), which returns a sanitized live board. The
// game client is never touched; demo data stays until a live match is seen.
const liveBoardRoot = document.getElementById('live-board');
const liveClientStatus = document.querySelector('.client-status');
function renderStateHeader(board) {
  if (!liveClientStatus) return;
  let text = 'GAME CLIENT NOT DETECTED';
  let color = '#fb5070';
  if (board && board.running && board.state && board.state !== 'OFFLINE') {
    const label = window.NightfallLive && window.NightfallLive.headerLabel ? window.NightfallLive.headerLabel(board) : null;
    text = label ? label.text : (board.stateLabel || board.state).toUpperCase();
    color = (label && label.kind === 'warn') ? '#ffb454' : '#92e899';
  }
  liveClientStatus.innerHTML = `<i style="background:${color};box-shadow:0 0 10px ${color}"></i> ${text}`;
}
function liveOffline(message) {
  return { state: 'OFFLINE', running: false, notice: { level: 'info', message: message || 'Open VALORANT to show the live overview.' } };
}
// Overview synchronization from the live board. The existing /api/live poll
// (below, every ~2.5s) drives this: it reads the signed-in local player from
// the live board and immediately updates the sidebar identity and the Current
// Rank / RR / peak card. Living data has priority for identity/rank; historical
// statistics stay with /api/profile-summary; demo remains only as a fallback.
const liveProfileState = { active: false };
function applyLiveProfile(board) {
  const self = board && board.players ? board.players.find((p) => p.isSelf) : null;
  const active = Boolean(board && board.running && self);
  window.NightfallLiveActive = active;
  const profileHero = document.getElementById('profile-hero');
  const profileBanner = document.getElementById('profile-hero-banner');
  const profilePfp = document.getElementById('profile-hero-pfp');
  const sidebarAvatar = document.querySelector('.profile .avatar');
  const setSidebarAvatar = (src) => {
    if (!sidebarAvatar) return;
    sidebarAvatar.innerHTML = src ? `<img src="${String(src).replace(/"/g, '&quot;')}" alt="" loading="lazy" />` : 'N';
  };
  const profileRiotId = document.getElementById('profile-riot-id');
  const profileGreeting = document.getElementById('profile-greeting');
  const profileDate = document.getElementById('profile-date');
  const profileState = document.getElementById('profile-state-label');
  const profileStateMeta = document.getElementById('profile-state-meta');
  const profileConnection = document.getElementById('profile-connection');
  const profileLevel = document.getElementById('profile-level');
  const profileActEnds = document.getElementById('profile-act-ends');
  if (!active) {
    // Live client dropped/disconnected. If we had applied real live values,
    // fall back cleanly to the last captured profile-summary/demo values.
    if (liveProfileState.active && window.NightfallOverviewFallback) {
      const fb = window.NightfallOverviewFallback;
      const profile = document.querySelector('.profile');
      const nameEl = profile && profile.querySelector('b');
      const tagEl = profile && profile.querySelector('span');
      const apply = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
      if (nameEl) nameEl.textContent = fb.profileName;
      if (tagEl && fb.profileTag !== undefined) tagEl.textContent = fb.profileTag;
      apply('rank-current', fb.rankCurrent);
      apply('rank-rr', fb.rankRr);
      apply('rank-peak', fb.rankPeak);
      apply('rank-peak-label', fb.rankPeakLabel);
      const gemEl = document.getElementById('rank-gem');
      if (gemEl) gemEl.innerHTML = '◇';
    }
    if (profileHero) profileHero.removeAttribute('data-live-active');
    if (profileBanner) profileBanner.style.backgroundImage = '';
    if (profilePfp) profilePfp.innerHTML = '<span>NF</span>';
    setSidebarAvatar(null);
    if (profileRiotId) profileRiotId.textContent = 'Waiting for Riot Client';
    if (profileGreeting) profileGreeting.textContent = 'Good evening';
    if (profileDate) profileDate.textContent = '—';
    if (profileState) profileState.textContent = 'Waiting';
    if (profileStateMeta) profileStateMeta.textContent = 'Open VALORANT for live status';
    if (profileConnection) profileConnection.textContent = 'CLIENT OFFLINE';
    if (profileLevel) profileLevel.textContent = '—';
    if (profileActEnds) profileActEnds.textContent = '—';
    liveProfileState.active = false;
    return;
  }
  liveProfileState.active = true;
  if (profileHero) profileHero.setAttribute('data-live-active', 'true');
  if (profileBanner && self.profileBanner) {
    profileBanner.style.backgroundImage = `linear-gradient(90deg, rgba(13,7,24,.9), rgba(13,7,24,.58)), url('${String(self.profileBanner).replace(/'/g, '%27')}')`;
  }
  if (profilePfp && self.profilePfp) {
    profilePfp.innerHTML = `<img src="${String(self.profilePfp).replace(/"/g, '&quot;')}" alt="" loading="lazy" />`;
    setSidebarAvatar(self.profilePfp);
  }
  if (profileGreeting) {
    const hour = new Date().getHours();
    profileGreeting.textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${self.name && self.name.indexOf('#') >= 0 ? self.name.slice(0, self.name.lastIndexOf('#')) : (self.name || 'player')}`;
  }
  if (profileDate) profileDate.textContent = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  if (profileRiotId && self.name && self.name.indexOf('Player-') !== 0) profileRiotId.textContent = self.name;
  if (profileState) profileState.textContent = board.stateLabel || board.state || 'Live';
  if (profileStateMeta) profileStateMeta.textContent = [board.map, board.mode].filter(Boolean).join(' · ') || 'Live Riot Client data';
  if (profileConnection) profileConnection.textContent = board.reconnecting ? 'RECONNECTING' : 'LIVE POLL';
  if (profileLevel) profileLevel.textContent = self.profileLevel != null ? String(self.profileLevel) : '—';
  if (profileActEnds) {
    profileActEnds.textContent = self.profileActEnds
      ? new Date(self.profileActEnds).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '—';
  }
  const profile = document.querySelector('.profile');
  const nameEl = profile && profile.querySelector('b');
  const tagEl = profile && profile.querySelector('span');
  // Real identity from the live client ("Name#Tag"), not the Player-XXXX fallback.
  if (self.name && self.name.indexOf('Player-') !== 0) {
    const hash = self.name.lastIndexOf('#');
    const game = hash > 0 ? self.name.slice(0, hash) : self.name;
    const tag = hash > 0 ? self.name.slice(hash + 1) : '';
    if (nameEl) nameEl.textContent = game;
    if (tagEl) tagEl.textContent = tag ? '#' + tag : '';
  }
  // Current Rank / RR / peak from the live player (skip pending/unranked placeholders).
  const rankEl = document.getElementById('rank-current');
  const rrEl = document.getElementById('rank-rr');
  const peakEl = document.getElementById('rank-peak');
  const peakLabelEl = document.getElementById('rank-peak-label');
  if (self.rank && !self.rankPending && self.rank !== 'Unranked') {
    if (rankEl) rankEl.textContent = self.rank;
    if (rrEl) rrEl.textContent = self.rr != null && self.rr > 0 ? `${self.rr} RR` : '—';
    if (peakEl && self.peakRank) peakEl.textContent = self.peakRank;
    if (peakLabelEl) peakLabelEl.textContent = 'PEAK';
    const gemEl = document.getElementById('rank-gem');
    if (gemEl) {
      gemEl.innerHTML = self.rankIcon
        ? `<img src="${self.rankIcon}" alt="${self.rank} emblem" loading="lazy" />`
        : '◇';
    }
  }
}
async function pollLive() {
  let board = null;
  try {
    const res = await fetch('/api/live');
    const data = await res.json();
    if (data && data.state) board = data;
  } catch (error) { board = null; }
  if (liveBoardRoot && window.NightfallLive) {
    window.NightfallLive.renderLiveBoard(liveBoardRoot, board || liveOffline(), { compact: true });
    if (heroAgentRefresh) heroAgentRefresh();
  }
  if (liveBoardRoot) bindQueueControls(liveBoardRoot);
  renderStateHeader(board || liveOffline());
  applyLiveProfile(board || null);
}
function bindQueueControls(root) {
  const find = root.querySelector('[data-find-match]');
  let currentQueueId = '';
  async function refreshQueueState() {
    try {
      const r = await fetch('/api/queue/status');
      const d = await r.json();
      root.querySelectorAll('[data-queue-mode]').forEach((card) => {
        card.classList.toggle('active', Boolean(d && d.queueId && card.dataset.queueMode === String(d.queueId).toLowerCase()));
      });
      currentQueueId = d && d.queueId ? String(d.queueId).toLowerCase() : '';
      if (find) {
        find.disabled = !(d && d.available);
        find.dataset.searching = d && d.searching ? 'true' : 'false';
        find.textContent = d && d.searching ? 'Cancel Search' : 'Find Match';
      }
      return d;
    } catch {
      if (find) find.disabled = true;
      return null;
    }
  }

  if (find) find.addEventListener('click', async () => {
    const status = root.querySelector('#queue-status');
    const queueState = await refreshQueueState();
    if (queueState && queueState.searching) {
      find.disabled = true;
      if (status) status.textContent = 'Cancelling matchmaking…';
      try {
        const r = await fetch('/api/queue/cancel', { method: 'POST' });
        const d = await r.json();
        if (status) status.textContent = (d && d.message) || 'Could not cancel matchmaking.';
        await pollLive();
      } catch (e) { if (status) status.textContent = 'Could not reach the local Riot Client.'; }
      return;
    }
    const queueId = currentQueueId;
    find.disabled = true;
    if (status) status.textContent = 'Starting matchmaking…';
    try {
      const r = await fetch('/api/queue/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId }) });
      const d = await r.json();
      if (!d || !d.ok) {
        if (status) status.textContent = (d && d.message) || 'Could not start matchmaking.';
        find.disabled = false;
        return;
      }
      if (status) status.textContent = 'Matchmaking requested; waiting for Riot Client confirmation…';
      await pollLive();
      await refreshQueueState();
    } catch (e) {
      if (status) status.textContent = 'Could not reach the local Riot Client.';
      find.disabled = false;
    }
  });
  root.querySelectorAll('[data-queue-mode]').forEach((card) => card.addEventListener('click', async () => {
    root.querySelectorAll('[data-queue-mode]').forEach((x) => { x.disabled = true; });
    const status = root.querySelector('#queue-status');
    if (status) status.textContent = 'Updating Riot Client queue…';
    try {
      const r = await fetch('/api/queue/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: card.dataset.queueMode }) });
      const d = await r.json();
      if (status) status.textContent = d && d.ok ? 'Queue mode updated in Riot Client.' : ((d && d.message) || 'Queue mode update failed.');
      if (d && d.ok) {
        await pollLive();
        await refreshQueueState();
      }
    } catch (e) { if (status) status.textContent = 'Could not reach the local Riot Client.'; }
    root.querySelectorAll('[data-queue-mode]').forEach((x) => { x.disabled = false; });
  }));
  refreshQueueState();
}
if (liveBoardRoot) { pollLive(); setInterval(pollLive, 2500); }
// Per-player "+ Party" buttons injected into the live board by lib/live-ui.js.
// Same endpoint and same one-invite-per-click behavior as the manual Party
// page form above — this just pre-fills the Riot ID from the live roster.
if (liveBoardRoot) {
  liveBoardRoot.addEventListener('click', async (e) => {
    const btn = e.target.closest('.invite-btn');
    if (!btn) return;
    const riotId = btn.dataset.riotid || '';
    if (!riotId || btn.disabled) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Inviting…';
    try {
      const r = await fetch('/api/party/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riotId }),
      });
      const d = await r.json();
      btn.textContent = d && d.ok ? 'Invited ✓' : 'Failed';
      btn.title = (d && d.message) || btn.title;
    } catch {
      btn.textContent = 'Failed';
      btn.title = 'Could not reach the local server.';
    } finally {
      setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 2500);
    }
  });
}
// Match Controls — instalock + dodge (Phase 3). Read-only detection above is
// unchanged. These controls are OFF by default and every write is gated
// server-side; the browser only receives/sends public status flags. The agent
// list and per-map presets are the only client-side configuration.
function escapeAttr(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch])); }
const controlsRoot = document.getElementById('match-controls');
const MAP_NAMES = ['Ascent','Bind','Haven','Split','Lotus','Sunset','Abyss','Breeze','Icebox','Fracture','Pearl','Corrode','Summit'];
// Set by the controls block below; pollLive() calls it after each hero re-render
// so the top-of-hero Set Agent control reflects the live board refresh.
let heroAgentRefresh = null;
if (controlsRoot) {
  const agentSel = document.getElementById('instalock-agent');
  const modeSel = document.getElementById('instalock-mode');
  const delayInput = document.getElementById('instalock-delay');
  const mapsRoot = document.getElementById('map-presets');
  const stateChip = document.getElementById('controls-state');
  const messageEl = document.getElementById('controls-message');
  let mapPresets = {}; try { mapPresets = JSON.parse(localStorage.getItem('nightfall-map-presets') || '{}'); } catch { mapPresets = {}; }
  let agentList = [];
  let catalog = [];
  let mapAssets = {};
  // Hero instalock/dodge state (updated by pollControls / explicit actions).
  let currentInstalockRunning = false;
  let currentCanDodge = false;

  function renderAgentOptions(select, names, selected) {
    select.innerHTML = names.map((n) => `<option value="${escapeAttr(n)}">${escapeAttr(n)}</option>`).join('');
    if (selected && names.includes(selected)) select.value = selected;
  }
  function buildMapPresets() {
    mapsRoot.innerHTML = MAP_NAMES.map((map) => {
      const cur = mapPresets[map] || '';
      const opts = '<option value="">None</option>' + agentList.map((a) => `<option value="${escapeAttr(a)}"${a === cur ? ' selected' : ''}>${escapeAttr(a)}</option>`).join('');
      return `<label class="map-preset"><span>${escapeAttr(map)}</span><select data-map="${escapeAttr(map)}">${opts}</select></label>`;
    }).join('');
    mapsRoot.querySelectorAll('select[data-map]').forEach((sel) => sel.addEventListener('change', () => {
      mapPresets[sel.dataset.map] = sel.value;
      localStorage.setItem('nightfall-map-presets', JSON.stringify(mapPresets));
      if (typeof syncAgentPicker === 'function') syncAgentPicker();
    }));
  }

  fetch('/api/agents').then((r) => r.json()).then((d) => {
    agentList = (d && Array.isArray(d.agents)) ? d.agents : [];
    catalog = (d && Array.isArray(d.catalog)) ? d.catalog : [];
    mapAssets = (d && d.maps && typeof d.maps === 'object') ? d.maps : {};
    renderAgentOptions(agentSel, agentList, agentList.includes('Omen') ? 'Omen' : agentList[0] || '');
    buildMapPresets();
    initAgentPicker();
  }).catch(() => { buildMapPresets(); initAgentPicker(); });

  async function startInstalock() {
    const perMap = {};
    if (pickerUsePerMap !== false) {
      for (const [m, a] of Object.entries(mapPresets)) if (a) perMap[m] = a;
    }
    try {
      const r = await fetch('/api/controls/instalock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', agent: agentSel.value, mode: modeSel.value, delay: Number(delayInput.value) || 0, perMap }) });
      const d = await r.json();
      if (messageEl) messageEl.textContent = (d && d.message) || 'Instalock started.';
      syncAgentPicker();
    } catch (error) { if (messageEl) messageEl.textContent = 'Could not reach the local server.'; }
  }

  async function stopInstalock(explicit = true) {
    try {
      const r = await fetch('/api/controls/instalock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) });
      const d = await r.json();
      if (explicit && messageEl) messageEl.textContent = (d && d.message) || 'Instalock stopped.';
      syncAgentPicker();
    } catch (error) { if (messageEl) messageEl.textContent = 'Could not reach the local server.'; }
  }

  async function doDodge() {
    if (!currentCanDodge) return;
    if (!confirm('Dodge this match? You will leave Agent Select and take a queue penalty.')) return;
    try {
      const r = await fetch('/api/controls/dodge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
      const d = await r.json();
      if (messageEl) messageEl.textContent = (d && d.message) || 'Done.';
    } catch (error) { if (messageEl) messageEl.textContent = 'Could not reach the local server.'; }
  }

  // Hero control wiring (delegated because the hero is re-rendered each poll).
  document.addEventListener('click', (e) => {
    const dodgeBtn = e.target.closest('[data-hero-dodge]');
    if (dodgeBtn) { doDodge(); return; }
    const toggle = e.target.closest('[data-instalock-toggle]');
    if (toggle) {
      if (currentInstalockRunning) stopInstalock();
      else startInstalock();
    }
    const skinsBtn = e.target.closest('[data-open-skins]');
    if (skinsBtn) { if (typeof openSkinsPanel === 'function') openSkinsPanel(); return; }
  });

  // Persistent INSTALOCK visibility (Settings master toggle). Default ON.
  const INSTALOCK_VIS_KEY = 'nightfall-instalock-visible';
  function instalockVisibleOn() {
    return (localStorage.getItem(INSTALOCK_VIS_KEY) || 'on') !== 'off';
  }
  const instalockVisToggle = document.getElementById('instalock-visibility-toggle');
  if (instalockVisToggle) {
    instalockVisToggle.checked = instalockVisibleOn();
    instalockVisToggle.addEventListener('change', () => {
      localStorage.setItem(INSTALOCK_VIS_KEY, instalockVisToggle.checked ? 'on' : 'off');
      renderHeroAgent();
    });
  }

  // ── Agent Picker UI ────────────────────────────────────────────────
  // Pure front-end presentation. It reads/writes the SAME existing config
  // (default agent select, per-map presets, and instalock-mode select) used by
  // the untouched backend.
  const pickerBackdrop = document.getElementById('agent-picker');
  const pickerCloseBtn = document.getElementById('agent-picker-close');
  const pickerOpenBtn = null; // primary trigger now lives in the hero (#live-hero-agent)
  const apSearch = document.getElementById('ap-search');
  const apGrid = document.getElementById('ap-grid-default');
  const apMapGrid = document.getElementById('ap-mapgrid');
  let pickerUsePerMap = true; // always use per-map when set
  let apRoleFilter = '';
  let pickerTab = 'default';

  function agentByName(name) {
    return catalog.find((a) => a && a.name && String(a.name).toLowerCase() === String(name || '').toLowerCase());
  }
  function defaultAgentName() { return agentSel.value || ''; }
  function roleColor(role) {
    return role === 'Duelist' ? '#ff6d8a' : role === 'Initiator' ? '#7fd4ff'
      : role === 'Controller' ? '#c9b6ff' : role === 'Sentinel' ? '#8ff0c4' : '#95a3bc';
  }

  function openAgentPicker() {
    if (!pickerBackdrop) return;
    pickerBackdrop.hidden = false;
    pickerBackdrop.classList.add('open');
    document.body.classList.add('picker-open');
    syncAgentPicker();
    if (apSearch) { setTimeout(() => apSearch.focus(), 40); }
  }
  function closeAgentPicker() {
    if (!pickerBackdrop) return;
    pickerBackdrop.hidden = true;
    pickerBackdrop.classList.remove('open');
    document.body.classList.remove('picker-open');
  }

  function heroAgentLabel() {
    // Controls are always enabled internally; the picker only chooses agents.
    const def = defaultAgentName();
    const hasPerMap = Object.keys(mapPresets).some((m) => mapPresets[m]);
    if (hasPerMap) return 'Agent: Per-Map';
    if (def) return 'Agent: ' + def;
    return 'Set Agent';
  }

  // Renders the primary hero controls: Dodge, Instalock ON/OFF toggle, and the
  // Set Agent trigger. These are re-created by live-ui.js on every poll, so all
  // clicks are handled via document delegation. No auto-start on load; the
  // toggle reflects the backend running state (default OFF).
  function renderHeroAgent() {
    const slot = document.getElementById('live-hero-agent');
    if (!slot) return;
    const label = heroAgentLabel();
    const lock = '🔒 ';
    const running = Boolean(currentInstalockRunning);
    const dodgeDisabled = currentCanDodge ? '' : ' disabled';
    const instalockControls = instalockVisibleOn()
      ? '<button type="button" class="hero-instalock' + (running ? ' on' : ' off') + '" data-instalock-toggle title="' + (running ? 'Stop Instalock' : 'Start Instalock') + '">Instalock: ' + (running ? 'ON' : 'OFF') + '</button>' +
        '<button type="button" class="hero-agent-trigger" data-open-picker title="Choose a default or per-map agent">' + lock + escapeAttr(label) + '</button>'
      : '';
    slot.innerHTML =
      '<div class="hero-actions">' +
      '<span class="hero-dodge-group">' +
      '<button type="button" class="hero-dodge" data-hero-dodge' + dodgeDisabled + ' title="' + (currentCanDodge ? 'Dodge Agent Select (asks first)' : 'Dodge available only in Agent Select') + '">Dodge</button>' +
      '<span class="setting-warn hero-warn"><b>⚠ Riot Penalty Warning</b>Repeated queue dodging can result in increased penalties, including restrictions or bans.</span>' +
      '</span>' +
      instalockControls +
      '</div>';
  }

  function syncAgentPicker() {
    const def = defaultAgentName();
    if (heroAgentRefresh) heroAgentRefresh();
    renderAgentGrid();
    renderMapAgents();
  }

  function filteredAgents() {
    const q = (apSearch ? apSearch.value : '').trim().toLowerCase();
    return catalog.filter((a) => {
      if (!a || !a.name) return false;
      if (q && a.name.toLowerCase().indexOf(q) < 0) return false;
      if (apRoleFilter && a.role !== apRoleFilter) return false;
      return true;
    });
  }

  function renderAgentGrid() {
    if (!apGrid) return;
    const def = defaultAgentName();
    const list = filteredAgents();
    apGrid.innerHTML = list.length
      ? list.map((a) => {
          const sel = def === a.name;
          const img = a.portrait
            ? `<img class="ap-agent-img" src="${escapeAttr(a.portrait)}" alt="${escapeAttr(a.name)}" loading="lazy" />`
            : '<span class="ap-agent-img placeholder"></span>';
          return `<button type="button" class="ap-agent${sel ? ' selected' : ''}" data-agent="${escapeAttr(a.name)}" title="${escapeAttr(a.name)} · ${escapeAttr(a.role)}">
            ${img}
            <span class="ap-agent-role" style="color:${roleColor(a.role)}">${escapeAttr(a.role)}</span>
            <b>${escapeAttr(a.name)}</b>
            ${sel ? '<i class="ap-check">✓</i>' : ''}
          </button>`;
        }).join('')
      : '<p class="dim ap-empty">No agents match.</p>';
    apGrid.querySelectorAll('.ap-agent').forEach((btn) => btn.addEventListener('click', () => {
      agentSel.value = btn.getAttribute('data-agent');
      syncAgentPicker();
      closeAgentPicker();
    }));
  }

  function renderMapAgents() {
    if (!apMapGrid) return;
    apMapGrid.innerHTML = MAP_NAMES.map((map) => {
      const cur = mapPresets[map] || '';
      const a = agentByName(cur);
      const mapAsset = mapAssets[map.toLowerCase()] || {};
      const mapImage = mapAsset.splash || mapAsset.listIcon || mapAsset.minimap || '';
      const img = (a && a.portrait)
        ? `<img class="ap-map-agent-img" src="${escapeAttr(a.portrait)}" alt="" loading="lazy" />`
        : '<span class="ap-map-agent-img placeholder"></span>';
      const useMap = (pickerUsePerMap === false) ? false : Boolean(cur);
      const bg = mapImage ? ` style="background-image:linear-gradient(180deg, rgba(20,10,34,.24), rgba(20,10,34,.92)), url('${escapeAttr(mapImage)}')"` : '';
      return `<div class="ap-map-card"${bg}>
        <div class="ap-map-head"><b>${escapeAttr(map)}</b><button type="button" class="ap-map-pick" data-map="${escapeAttr(map)}" title="Pick ${escapeAttr(map)} agent">+</button></div>
        <div class="ap-map-agent">${img}<span>${cur ? escapeAttr(cur) : '<span class="dim">Uses default</span>'}</span></div>
        <span class="ap-map-badge">${useMap ? 'Per-map' : 'Default'}</span>
      </div>`;
    }).join('');
    apMapGrid.querySelectorAll('.ap-map-pick').forEach((btn) => btn.addEventListener('click', () => {
      openMiniPicker(btn.getAttribute('data-map'));
    }));
  }

  function openMiniPicker(map) {
    const backdrop = document.createElement('div');
    backdrop.className = 'ap-mini-backdrop';
    const grid = catalog.filter((a) => a && a.name).map((a) => {
      const sel = String(mapPresets[map] || '').toLowerCase() === a.name.toLowerCase();
      const img = a.portrait
        ? `<img class="ap-agent-img" src="${escapeAttr(a.portrait)}" alt="${escapeAttr(a.name)}" loading="lazy" />`
        : '<span class="ap-agent-img placeholder"></span>';
      return `<button type="button" class="ap-agent${sel ? ' selected' : ''}" data-map="${escapeAttr(map)}" data-agent="${escapeAttr(a.name)}" title="${escapeAttr(a.name)}">
        ${img}<span class="ap-agent-role" style="color:${roleColor(a.role)}">${escapeAttr(a.role)}</span><b>${escapeAttr(a.name)}</b>
        ${sel ? '<i class="ap-check">✓</i>' : ''}
      </button>`;
    }).join('');
    backdrop.innerHTML = `<div class="ap-mini">
      <div class="ap-head"><div><p class="eyebrow">PER-MAP</p><h2>${escapeAttr(map)}</h2></div><button type="button" class="ap-close" aria-label="Close">×</button></div>
      <div class="ap-grid ap-grid-mini">${grid}</div>
      <button type="button" class="ap-mini-clear" data-map="${escapeAttr(map)}">Use default</button>
    </div>`;
    backdrop.querySelector('.ap-close').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelectorAll('.ap-agent').forEach((btn) => btn.addEventListener('click', () => {
      mapPresets[btn.getAttribute('data-map')] = btn.getAttribute('data-agent');
      localStorage.setItem('nightfall-map-presets', JSON.stringify(mapPresets));
      const mm = mapsRoot.querySelector('select[data-map="' + btn.getAttribute('data-map') + '"]');
      if (mm) mm.value = btn.getAttribute('data-agent');
      syncAgentPicker();
      backdrop.remove();
    }));
    const clearBtn = backdrop.querySelector('.ap-mini-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      mapPresets[clearBtn.getAttribute('data-map')] = '';
      localStorage.setItem('nightfall-map-presets', JSON.stringify(mapPresets));
      const mm = mapsRoot.querySelector('select[data-map="' + clearBtn.getAttribute('data-map') + '"]');
      if (mm) mm.value = '';
      syncAgentPicker();
      backdrop.remove();
    });
    document.body.appendChild(backdrop);
  }

  function initAgentPicker() {
    if (!pickerBackdrop) return;
    heroAgentRefresh = renderHeroAgent;
    if (pickerCloseBtn) pickerCloseBtn.addEventListener('click', closeAgentPicker);
    // The primary Set Agent trigger is re-created by live-ui.js inside the hero
    // on every poll. Delegate open clicks so any [data-open-picker] works.
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-picker]')) openAgentPicker();
    });
    pickerBackdrop.addEventListener('click', (e) => { if (e.target === pickerBackdrop) closeAgentPicker(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAgentPicker(); });

    const apTabs = document.querySelectorAll('.ap-tab');
    apTabs.forEach((tab) => tab.addEventListener('click', () => {
      const pane = tab.dataset.aptab;
      if (pane !== 'default' && pane !== 'permap') return;
      pickerTab = pane;
      apTabs.forEach((t) => t.classList.toggle('active', t.dataset.aptab === pane));
      document.querySelectorAll('.ap-tabpanel').forEach((el) => {
        const show = el.dataset.pane === pane;
        el.hidden = !show;
        if (el.dataset.pane === 'permap' && show) renderMapAgents();
      });
    }));

    const roles = document.querySelectorAll('.ap-role');
    roles.forEach((r) => r.addEventListener('click', () => {
      apRoleFilter = r.dataset.aprole || '';
      roles.forEach((x) => x.classList.toggle('active', x.dataset.aprole === apRoleFilter));
      renderAgentGrid();
    }));
    if (apSearch) apSearch.addEventListener('input', renderAgentGrid);

    syncAgentPicker();
  }

  async function pollControls() {
    try {
      const r = await fetch('/api/controls');
      const d = await r.json();
      if (!d) return;
      const inst = d.instalock || {};
      const running = Boolean(inst.running);
      currentInstalockRunning = running;
      currentCanDodge = Boolean(d.canDodge);
      stateChip.textContent = d.running ? (d.stateLabel || d.state || '—').toUpperCase() : 'OFFLINE';
      if (inst.message) messageEl.textContent = inst.message;
      if (typeof syncAgentPicker === 'function') syncAgentPicker();
    } catch (error) { /* keep last state */ }
  }
  pollControls();
  setInterval(pollControls, 2500);
}
