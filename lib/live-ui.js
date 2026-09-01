'use strict';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function formatStat(value, suffix) {
  if (value === null || value === undefined || value === '') return '—';
  return suffix ? `${value}${suffix}` : String(value);
}

// Full player row for the match-intelligence board. Same data as before.
function playerRow(player) {
  const side = player.team === 'Red' ? 'atk' : 'def';
  const you = player.isSelf ? ' you' : '';
  const pending = player.statsPending ? '<i class="dim">updating</i>' : '';
  const agent = player.agent || (player.selection ? player.selection : '—');
  const profileOnly = Boolean(player.isSelf && player.profilePfp && !player.agent && !player.selection);
  const portrait = (player.agentPortrait || player.agentIcon)
    ? `<img class="agent-portrait" src="${escapeHtml(player.agentPortrait || player.agentIcon)}" alt="" loading="lazy" />`
    : (profileOnly ? '' : '<span class="agent-portrait placeholder"></span>');
    const rankIcon = player.rankIcon
    ? `<img class="rank-icon" src="${escapeHtml(player.rankIcon)}" alt="" loading="lazy" />`
    : '';
  const peakRankIconUrl = proxyImage(player.peakRankIcon);
  const peakRankIcon = peakRankIconUrl
    ? `<img class="rank-icon" src="${escapeHtml(peakRankIconUrl)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
    : '';
  const skinIcon = player.skinIcon
    ? `<img class="skin-icon" src="${escapeHtml(player.skinIcon)}" alt="Equipped weapon skin" loading="lazy" />`
    : '';
  const invite = player.isSelf
    ? ''
    : `<button type="button" class="invite-btn" data-riotid="${escapeHtml(player.name)}" title="Invite ${escapeHtml(player.name)} to your party">+ Party</button>`;
  // Single right-side stat set (no duplicates on the left).
  const stats = `<span class="live-stats">
    <i class="live-stat kd"><b>${formatStat(player.kd)}${pending ? ` ${pending}` : ''}</b><small>K/D</small></i>
    <i class="live-stat acs"><b>${formatStat(player.acs)}</b><small>ACS</small></i>
    <i class="live-stat hs"><b>${formatStat(player.hsPct, '%')}</b><small>HS</small></i>
    <i class="live-stat wr"><b>${player.winRate != null && player.games ? formatStat(player.winRate, '%') : '—'}</b><small>WR</small></i>
  </span>`;
  const bannerUrl = proxyImage(player.profileBanner);
  const profileStyle = bannerUrl
    ? ` style="background-image:linear-gradient(90deg, rgba(13,7,24,.9), rgba(13,7,24,.66)), url('${escapeHtml(bannerUrl)}')"`
    : '';
  const bannerClass = bannerUrl ? ' has-banner' : '';
  const pfpUrl = proxyImage(player.profilePfp);
  const pfp = pfpUrl
    ? `<img class="live-profile-pfp" src="${escapeHtml(pfpUrl)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
    : '';
  const profilePfpInAgent = profileOnly ? pfp : '';
  const profilePfpInName = profileOnly ? '' : pfp;
  return `<article class="live-player ${side}${bannerClass}${you}"${profileStyle}>
    <span class="live-agent">${profilePfpInAgent}${portrait}${profileOnly ? '' : escapeHtml(agent)}${skinIcon}</span>
    <span class="live-name">${profilePfpInName}${escapeHtml(player.name)}${player.nameHidden ? ' <i class="dim">hidden</i>' : ''}${player.isSelf ? ' <i class="dim">you</i>' : ''}${invite}</span>
    <span class="live-rank" style="color:${escapeHtml(player.rankColor || '#95a3bc')}">${rankIcon}${escapeHtml(player.rank || 'Unranked')}${player.rr ? ` <i class="dim">${player.rr} RR</i>` : ''}</span>
    <span class="live-peak dim">${peakRankIcon}${escapeHtml(player.peakRank || '—')}</span>
    ${stats}
  </article>`;
}
// Same-origin proxy so the browser never hotlinks media.valorant-api.com
// directly (hotlink/CORS/CDN rules would otherwise show a broken image).
// Mirrors the trusted /api/img route in server.js.
function proxyImage(url) {
  const value = String(url || '').trim();
  if (!/^https:\/\/(media\.)?valorant-api\.com\//i.test(value)) return '';
  return '/api/img?url=' + encodeURIComponent(value);
}

// Compact lobby/party card. Every real party member is rendered with their own
// player-card banner as the row background plus the card PFP avatar — not just
// the current player. Artwork is proxied same-origin with safe fallbacks.
function partyRow(player) {
  const you = player.isSelf ? '<i class="dim">you</i>' : '<i class="dim">friend</i>';
  const portrait = (player.agentPortrait || player.agentIcon)
    ? `<img class="agent-portrait" src="${escapeHtml(player.agentPortrait || player.agentIcon)}" alt="" loading="lazy" />`
    : '<span class="agent-portrait placeholder"></span>';
  const rankIcon = player.rankIcon ? `<img class="rank-icon" src="${escapeHtml(player.rankIcon)}" alt="" loading="lazy" />` : '';
  const ready = player.ready != null
    ? `<i class="dim party-ready">${player.ready ? 'ready' : 'not ready'}</i>`
    : '';

  // Real player-card artwork for EVERY member (banner = row background, PFP =
  // avatar). A dark translucent overlay keeps text readable; a broken banner
  // image falls back to the styled base background without a broken-image icon.
  const banner = proxyImage(player.profileBanner);
  const pfpUrl = proxyImage(player.profilePfp);
  const profileStyle = banner
    ? ` style="background-image:linear-gradient(90deg, rgba(13,7,24,.92), rgba(13,7,24,.6)), url('${escapeHtml(banner)}')"`
    : '';
  const pfp = pfpUrl
    ? `<img class="party-pfp" src="${escapeHtml(pfpUrl)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
    : '';
  const rr = player.rr ? `<i class="dim party-rr">${escapeHtml(String(player.rr))} RR</i>` : '';

  return `<article class="party-row${player.isSelf ? ' you' : ''}${banner ? ' has-banner' : ''}"${profileStyle}>
    <span class="party-agent">${portrait}</span>
    ${pfp}<span class="party-name">${escapeHtml(player.name)} ${you}${ready}</span>
    <span class="party-rank">${rankIcon}<span>${escapeHtml(player.rank || 'Unranked')}</span>${rr}</span>
  </article>`;
}

// Supported VALORANT modes already known to Nightfall (lib/vconstants GAMEMODES).
const LIVE_MODES = [
  { key: 'competitive', label: 'Competitive' },
  { key: 'unrated', label: 'Unrated' },
  { key: 'swiftplay', label: 'Swiftplay' },
  { key: 'spikerush', label: 'Spike Rush' },
  { key: 'hurm', label: 'Team Deathmatch' },
  { key: 'deathmatch', label: 'Deathmatch' },
  { key: 'ggteam', label: 'Escalation' },
  { key: 'skirmish2v2', label: 'Skirmish 2v2' },
];

let liveActivePanel = 'lobby';
let lastPanelState = null;

function liveBadge(label, kind) {
  return `<span class="pill live-badge${kind ? ' live-badge-' + kind : ''}">${escapeHtml(label)}</span>`;
}
function renderLiveBoard(root, board, { compact = false } = {}) {
  if (!root) return;
  if (!board || board.state === 'OFFLINE') {
    root.innerHTML = `<div class="empty-state live-empty"><b>N</b><h2>NO ACTIVE MATCH</h2><p>${escapeHtml((board && board.notice && board.notice.message) || 'Open VALORANT to show your live lobby, Agent Select, or current game.')}</p></div>`;
    return;
  }

  const state = board.state;
  const title = board.stateLabel || board.state;
  const meta = [board.map, board.mode, board.side, board.allyOnly ? 'Allies only' : null, board.stale ? 'Reconnecting' : null]
    .filter(Boolean).join(' \u00B7 ');
  const splashStyle = board.mapSplash
    ? ` style="background-image:linear-gradient(180deg, rgba(13,7,24,.5), rgba(13,7,24,.9)), url('${board.mapSplash.replace(/'/g, '%27')}')"`
    : '';

  const allies = (board.players || []).filter((p) => p.team === board.selfTeam || state === 'MENUS');
  const enemies = (board.players || []).filter((p) => p.team !== board.selfTeam && state !== 'MENUS');
  // Authoritative Riot party members power the Lobby & Party tab. Only the real
  // party payload populates this list/count — never presences, friends, or the
  // match roster. `allies` above is still used only by Match Intelligence.
  const partyMembers = (board.party && board.party.length ? board.party : (state === 'MENUS' ? (board.players || []) : []));

  // Lobby workspace is only meaningful before the match locks in.
  // Keep both presentation tabs available through lobby, agent select, and
  // active-match states. Preserve the user's selected tab across transitions.
  const showLobby = true;
  if (lastPanelState === null) liveActivePanel = state === 'MENUS' ? 'lobby' : 'intel';
  lastPanelState = state;

  const hero = `
    <div class="live-hero map-splash"${splashStyle}>
      <div class="live-hero-left">
        <p class="eyebrow">NIGHTFALL LIVE</p>
        <h2>${escapeHtml(title)}</h2>
        <p class="dim">${escapeHtml(meta || '\u2014')}</p>
      </div>
      <div class="live-hero-right">
        <div class="live-hero-badges">
          ${liveBadge(title, 'state')}
          ${board.mode ? liveBadge(board.mode, 'mode') : ''}
          ${board.map ? liveBadge(board.map, 'map') : ''}
          ${board.lockProgress ? liveBadge(`${board.lockProgress.locked}/${board.lockProgress.total} locked`, 'lock') : ''}
        </div>
        <div class="live-hero-agent" id="live-hero-agent"></div>
      </div>
    </div>`;

  let lobbyPanel = '';
  if (showLobby) {
    const partyCount = partyMembers.length;
    const openSlots = Math.max(0, 5 - partyCount);
    const partyLabel = state === 'PREGAME' ? 'PARTY · AGENT SELECT' : 'PARTY';
    const queueAction = state === 'PREGAME'
      ? '<span class="state-chip state-live">In Agent Select</span>'
      : '<span class="state-chip state-ok">In Lobby · Ready to queue</span>';
    lobbyPanel = `
      <div class="live-workspace">
        <section class="live-party panel-inner">
          <div class="live-sec-head">
            <p class="eyebrow">${partyLabel}</p>
            <span class="pill">${partyCount}/5</span>
          </div>
          ${partyMembers.map(partyRow).join('') || '<p class="dim">No party members yet.</p>'}
          ${openSlots > 0 ? `<div class="party-slot">+ OPEN SLOT${openSlots > 1 ? 'S' : ''} · ${openSlots} available</div>` : ''}
          <p class="dim" style="margin-top:12px;font-size:12px;line-height:1.5">Invite friends and manage the party code from the Overview → Party panel.</p>
          <div class="queue-action">${queueAction}</div>
          <p class="dim mode-note" id="queue-status">${escapeHtml(board.mode ? `Party ready · Current queue: ${board.mode}` : 'Party ready.')}</p>
        </section>
      </div>`;
  }

  const single = state === 'MENUS';
  const intelPanel = `
    <div class="live-intel${single ? ' single' : ''}">
      <section class="panel-inner">
        <div class="live-sec-head">
          <p class="eyebrow">${state === 'MENUS' ? 'PARTY' : 'YOUR TEAM'}</p>
          ${state === 'PREGAME' ? '<span class="pill state-live">AGENT SELECT</span>' : ''}
        </div>
        ${allies.map(playerRow).join('') || '<p class="dim">No players yet.</p>'}
      </section>
      ${single ? '' : `<section class="panel-inner">
        <div class="live-sec-head"><p class="eyebrow">ENEMY TEAM</p></div>
        ${enemies.map(playerRow).join('') || '<p class="dim">Waiting for enemy data.</p>'}
      </section>`}
    </div>`;

  const tabs = showLobby ? `
    <div class="live-tabs" role="tablist" aria-label="Live match views">
      <button type="button" class="live-tab${liveActivePanel === 'lobby' ? ' active' : ''}" data-live-panel="lobby">Lobby &amp; Party</button>
      <button type="button" class="live-tab${liveActivePanel === 'intel' ? ' active' : ''}" data-live-panel="intel">Match Intelligence</button>
    </div>` : '';

  root.innerHTML = `
    ${hero}
    ${tabs}
    <div class="live-tabpanels">
      ${showLobby ? `<div class="live-tabpanel live-panel-lobby${liveActivePanel === 'lobby' ? ' active' : ''}" data-live-panel="lobby">${lobbyPanel}</div>` : ''}
      <div class="live-tabpanel live-panel-intel${showLobby && liveActivePanel !== 'intel' ? '' : ' active'}" data-live-panel="intel">${intelPanel}</div>
    </div>`;

  bindLiveTabs(root);
}

function bindLiveTabs(root) {
  const tabs = root.querySelectorAll('.live-tab');
  if (!tabs.length) return;
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.getAttribute('data-live-panel');
      if (panel !== 'lobby' && panel !== 'intel') return;
      liveActivePanel = panel;
      root.querySelectorAll('.live-tabpanel').forEach((el) => {
        el.classList.toggle('active', el.getAttribute('data-live-panel') === panel);
      });
      root.querySelectorAll('.live-tab').forEach((el) => {
        el.classList.toggle('active', el.getAttribute('data-live-panel') === panel);
      });
    });
  });
}
function headerLabel(board) {
  if (!board) return { text: 'GAME CLIENT NOT DETECTED', kind: 'off' };
  if (!board.running && board.state === 'OFFLINE') return { text: 'GAME CLIENT NOT DETECTED', kind: 'off' };
  if (board.reconnecting) return { text: `RECONNECTING · ${board.stateLabel || 'LIVE'}`, kind: 'warn' };
  if (board.state === 'PREGAME') return { text: 'AGENT SELECT', kind: 'live' };
  if (board.state === 'INGAME') return { text: `IN GAME${board.map ? ` · ${board.map}` : ''}`, kind: 'live' };
  if (board.state === 'MENUS') return { text: 'IN LOBBY', kind: 'ok' };
  return { text: (board.stateLabel || 'LIVE').toUpperCase(), kind: 'ok' };
}

window.NightfallLive = { renderLiveBoard, headerLabel, escapeHtml };