'use strict';

/*
 * Live lobby / Agent Select / roster / rank / stats pipeline adapted from
 * Valorant Scout (https://github.com/kryotrades/valorant-scout)
 * backend/live_match.py
 * Copyright (C) 2026 kryotrades
 * Licensed under the GNU General Public License v3.0. See LICENSE and NOTICE.
 *
 * Pregame vs in-game roster selection was also informed by Fast Pick
 * (https://github.com/Imu-D-sama/Fast-Pick), GPL-3.0. Read-only only.
 */

const crypto = require('node:crypto');
const { resolveAgent, agentArt } = require('./agents');
const { LocalAuth, ClientNotReady, lockfileAvailable, decodePrivate, chatPresences } = require('./local-auth');
const { STATES, rankFromTier, mapNameFromPath, modeLabel } = require('./vconstants');
const { requestJson } = require('./http');
const { getMapAsset, getRankIcon, getPlayerCardAsset } = require('./valorant-assets');

// Gun-skin socket, same constant lib/party.js's sibling (server.js) uses for
// the personal loadout page. Match-loadout responses key equipped skins the
// same way: a fixed socket UUID inside each weapon's Sockets map.
const SKIN_SOCKET_UUID = 'bcef87d6-209b-46c6-8b19-fbe40bd95abc';
const skinIconCache = new Map();
let skinDefsPromise = null;

async function skinIconDefs() {
  if (skinDefsPromise) return skinDefsPromise;
  skinDefsPromise = (async () => {
    const byUuid = {};
    try {
      const res = await requestJson('GET', 'https://valorant-api.com/v1/weapons/skins', { timeout: 8000 });
      for (const skin of (res.json && res.json.data) || []) {
        for (const level of skin.levels || []) {
          if (level && level.uuid) byUuid[level.uuid.toLowerCase()] = level.displayIcon || skin.displayIcon || null;
        }
        for (const chroma of skin.chromas || []) {
          if (chroma && chroma.uuid) byUuid[chroma.uuid.toLowerCase()] = chroma.displayIcon || chroma.fullRender || skin.displayIcon || null;
        }
      }
    } catch { /* skin icons stay unavailable */ }
    return byUuid;
  })();
  return skinDefsPromise;
}

async function matchLoadoutIcons(auth, state, matchId) {
  const cacheKey = `${state}:${matchId}`;
  const hit = skinIconCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 5000) return hit.value;
  const out = {};
  try {
    const endpoint = state === 'INGAME'
      ? `/core-game/v1/matches/${matchId}/loadouts`
      : `/pregame/v1/matches/${matchId}/loadouts`;
    const res = await auth.glzGet(endpoint);
    const entries = Array.isArray(res && res.Loadouts) ? res.Loadouts : [];
    const defs = await skinIconDefs();
    for (const entry of entries) {
      const subject = entry.Subject;
      if (!subject) continue;
      const items = (entry.Loadout && entry.Loadout.Items) || entry.Items || {};
      let icon = null;
      for (const item of Object.values(items || {})) {
        const socket = item && item.Sockets && item.Sockets[SKIN_SOCKET_UUID];
        const id = socket && socket.Item && socket.Item.ID;
        if (id && defs[String(id).toLowerCase()]) { icon = defs[String(id).toLowerCase()]; break; }
      }
      out[subject] = { skinIcon: icon };
    }
  } catch { /* live loadout art is best-effort; leave players without it */ }
  skinIconCache.set(cacheKey, { at: Date.now(), value: out });
  return out;
}

const FRESH_MS = 3500;
const HOLD_MS = 90000;
const LOBBY_TTL_MS = 20000;

const playerCache = new Map();
const rankCache = new Map();
const kdCache = new Map();
const playerIdentityCache = new Map();
const playerCardCache = new Map();
const filling = new Set();
let contentCache = { seasons: null, at: 0 };
let lastGood = { board: null, at: 0 };
let buildLock = Promise.resolve();

function opaqueId(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function fallbackName(puuid) {
  return `Player-${String(puuid || '????').slice(0, 4).toUpperCase()}`;
}

function isThrottled(body) {
  return body && body.status === 429;
}

function publicPlayer(player) {
  return {
    id: opaqueId(player.puuid),
    name: player.name,
    nameHidden: Boolean(player.nameHidden),
    team: player.team,
    isSelf: Boolean(player.isSelf),
    agent: player.agent,
    agentIcon: player.agentIcon || null,
    agentPortrait: player.agentPortrait || null,
    role: player.role || null,
    selection: player.selection || null,
    rank: player.rank,
    rankColor: player.rankColor,
    rankIcon: player.rankIcon || null,
    skinIcon: player.skinIcon || null,
    profilePfp: player.profilePfp || null,
    profileBanner: player.profileBanner || null,
    profileLevel: player.profileLevel,
    profileActEnds: player.profileActEnds || null,
        rr: player.rr,
    peakRank: player.peakRank,
    peakRankIcon: player.peakRankIcon || null,
    winRate: player.winRate,
    games: player.games,
    kd: player.kd,
    hsPct: player.hsPct,
    acs: player.acs,
    rankPending: Boolean(player.rankPending),
    statsPending: Boolean(player.statsPending),
  };
}

function publicBoard(board) {
  if (!board) return null;
  return {
    running: Boolean(board.running),
    state: board.state,
    stateLabel: board.stateLabel,
    source: board.source,
    map: board.map || null,
    mode: board.mode || null,
    side: board.side || null,
    selfTeam: board.selfTeam || null,
    allyOnly: Boolean(board.allyOnly),
    stale: Boolean(board.stale),
    reconnecting: Boolean(board.reconnecting),
    notice: board.notice || null,
    lockProgress: board.lockProgress || null,
    matchKey: board.matchKey || null,
    mapSplash: board.mapSplash || null,
    players: (board.players || []).map(publicPlayer),
    party: (board.party || []).map(publicPlayer),
    updatedAt: board.updatedAt || Date.now(),
  };
}

async function assemblePlayer({
  puuid, name, nameHidden, team, isSelf, agentId, rankInfo, kd, hs, acs, selection, rankPending, statsPending, skinIcon, profilePfp, profileBanner, profileLevel, profileActEnds,
}) {
  const agent = resolveAgent(agentId || '') || {};
  const art = agent.uuid ? agentArt(agent.uuid) : null;
  const rank = rankFromTier(rankInfo.tier);
  const peak = rankFromTier(rankInfo.peak);
  let rankIcon = null;
  try { rankIcon = rank.name ? (await getRankIcon(rank.name) || {}).small || null : null; } catch { /* icon stays null */ }
  // Peak rank icon uses the same authoritative competitive-tier asset resolver as
  // the current rank icon (separate field: peak may differ from current rank).
  let peakRankIcon = null;
  try { peakRankIcon = peak.name ? (await getRankIcon(peak.name) || {}).small || null : null; } catch { /* icon stays null */ }
  return {
    puuid,
    name,
    nameHidden: Boolean(nameHidden),
    team,
    isSelf: Boolean(isSelf),
    agent: agent.name || null,
    agentIcon: art && art.icon,
    agentPortrait: art && art.portrait,
    role: agent.role || null,
    selection: selection || null,
    rank: rank.name,
    rankColor: rank.color,
    rankTier: rank.tier,
    rankIcon,
    peakRankIcon,
    rr: rankInfo.rr || 0,
    peakRank: peak.name,
    winRate: rankInfo.wr || 0,
    games: rankInfo.games || 0,
    kd: kd ?? null,
    hsPct: hs ?? null,
    acs: acs ?? null,
    skinIcon: skinIcon || null,
    profilePfp: profilePfp || null,
    profileBanner: profileBanner || null,
    profileLevel: profileLevel != null ? profileLevel : null,
    profileActEnds: profileActEnds || null,
    rankPending: Boolean(rankPending),
    statsPending: Boolean(statsPending),
  };
}

async function finalize(players, extras) {
  const selfTeam = extras.selfTeam || 'Blue';
  const sorted = [...players].sort((a, b) => {
    if ((a.team === selfTeam) !== (b.team === selfTeam)) return a.team === selfTeam ? -1 : 1;
    return (b.rankTier || 0) - (a.rankTier || 0);
  });
  const locked = sorted.filter((p) => p.selection === 'locked').length;
  let mapSplash = null;
  try { mapSplash = extras.mapName ? (await getMapAsset(extras.mapName) || {}).splash || null : null; } catch { /* splash stays null */ }
  return {
    running: true,
    state: extras.state,
    stateLabel: STATES[extras.state] || extras.state,
    source: 'local',
    map: extras.mapName || null,
    mapSplash,
    mode: extras.mode || null,
    side: extras.state === 'MENUS' ? null : ({ Red: 'Attacker', Blue: 'Defender' }[selfTeam] || null),
    selfTeam,
    allyOnly: extras.state === 'PREGAME',
    stale: false,
    reconnecting: false,
    notice: extras.notice || null,
    lockProgress: extras.state === 'PREGAME' ? { locked, total: sorted.length } : null,
    matchKey: opaqueId(extras.matchId || extras.state),
    players: sorted,
    party: extras.party || [],
    updatedAt: Date.now(),
  };
}

async function currentProfileAssets(auth, profileActEnds) {
  // Profile card assets must remain independent of the loadout subsystem. The
  // playerloadout endpoint can temporarily return 404 while authenticated
  // profile/presence data is still valid, so retain the cached self card ID as
  // a fallback instead of erasing the PFP/banner.
  let loadout = null;
  let accountXp = null;
  try { loadout = await auth.pdGet(`/personalization/v3/players/${auth.puuid}/playerloadout`, { retries: 1 }); } catch { /* card cache remains usable */ }
  try { accountXp = await auth.pdGet(`/account-xp/v1/players/${auth.puuid}`, { retries: 1 }); } catch { /* level remains unavailable */ }
  const identity = loadout && loadout.Identity || {};
  const cached = playerIdentityCache.get(auth.puuid) || {};
  const cardId = identity.PlayerCardID || cached.cardId || null;
  const card = await getPlayerCardAsset(cardId);
  return {
    profilePfp: card ? card.smallArt || null : null,
    profileBanner: card ? card.wideArt || card.largeArt || null : null,
    profileLevel: accountXp && accountXp.Progress && Number(accountXp.Progress.Level) > 0
      ? Number(accountXp.Progress.Level) : null,
    profileActEnds: profileActEnds || null,
  };
}

async function knownPlayerAssets(cardId) {
  const id = String(cardId || '').trim().toLowerCase();
  if (!id) return {};
  const cached = playerCardCache.get(id);
  if (cached) return cached;
  const card = await getPlayerCardAsset(id);
  const value = card ? {
    profilePfp: card.smallArt || null,
    profileBanner: card.wideArt || card.largeArt || null,
  } : {};
  playerCardCache.set(id, value);
  return value;
}

function noticeFor(error) {
  if (!lockfileAvailable()) {
    return { level: 'info', message: 'Open VALORANT to see live ranks and lobby players.' };
  }
  return {
    level: 'warn',
    message: error instanceof ClientNotReady
      ? 'Riot Client is running, but VALORANT is not signed in yet.'
      : 'Could not read VALORANT. Restart the game, then return here.',
  };
}

class LiveMatch {
  constructor(auth) {
    this.auth = auth;
    this.selfPuuid = auth.puuid;
  }

  async gameState(presences) {
    for (const presence of presences) {
      if (presence.puuid !== this.selfPuuid || presence.product === 'league_of_legends') continue;
      const priv = decodePrivate(presence.private);
      if (priv.matchPresenceData) return priv.matchPresenceData.sessionLoopState || 'MENUS';
      return priv.sessionLoopState || 'MENUS';
    }
    return 'MENUS';
  }

  partyMembers(presences) {
    let myParty = null;
    for (const presence of presences) {
      if (presence.puuid !== this.selfPuuid) continue;
      const priv = decodePrivate(presence.private);
      const data = priv.partyPresenceData || priv;
      myParty = data.partyId || null;
      break;
    }
    if (!myParty) return [{ puuid: this.selfPuuid, level: 0 }];
    const members = [];
    for (const presence of presences) {
      const priv = decodePrivate(presence.private);
      const data = priv.partyPresenceData || priv;
      const player = priv.playerPresenceData || priv;
      const gameName = presence.game_name || player.gameName || player.game_name || null;
      const gameTag = presence.game_tag || player.gameTag || player.game_tag || null;
      const cardId = player.playerCardId || player.PlayerCardID || null;
      if (presence.puuid && (gameName || gameTag || cardId)) {
        playerIdentityCache.set(presence.puuid, {
          name: gameName && gameTag ? `${gameName}#${gameTag}` : gameName,
          cardId,
        });
      }
      if (data.partyId === myParty) {
        members.push({ puuid: presence.puuid, level: player.accountLevel || 0 });
      }
    }
    return members.length ? members : [{ puuid: this.selfPuuid, level: 0 }];
  }

  async cachePartyIdentities() {
    try {
      const player = await this.auth.glzGet(`/parties/v1/players/${this.selfPuuid}`);
      const partyId = player && player.CurrentPartyID;
      if (!partyId) return;
      const current = await this.auth.glzGet(`/parties/v1/parties/${partyId}`);
      for (const member of (current && current.Members) || []) {
        const identity = member.PlayerIdentity || {};
        const subject = member.Subject || identity.Subject;
        if (!subject) continue;
        const known = playerIdentityCache.get(subject) || {};
        playerIdentityCache.set(subject, {
          ...known,
          cardId: identity.PlayerCardID || known.cardId || null,
        });
      }
    } catch { /* presence/name-service data remains the fallback */ }
  }

  async authoritativePartyMembers() {
    try {
      const player = await this.auth.glzGet(`/parties/v1/players/${this.selfPuuid}`);
      const partyId = player && player.CurrentPartyID;
      if (!partyId) return [];
      const current = await this.auth.glzGet(`/parties/v1/parties/${partyId}`);
      const members = [];
      for (const member of (current && current.Members) || []) {
        const identity = member.PlayerIdentity || {};
        const subject = member.Subject || identity.Subject;
        if (!subject) continue;
        const known = playerIdentityCache.get(subject) || {};
        playerIdentityCache.set(subject, {
          ...known,
          cardId: identity.PlayerCardID || known.cardId || null,
        });
        const level = identity.AccountLevel != null ? identity.AccountLevel : 0;
        members.push({ puuid: subject, level });
      }
      return members.length ? members : [];
    } catch {
      return [];
    }
  }

  async revealNames(puuids) {
    const names = {};
    if (!puuids.length) return names;
    try {
      let rows = await this.auth.pdPut('/name-service/v2/players', puuids);
      if (rows && rows.errorCode) rows = await this.auth.pdPut('/name-service/v2/players', puuids, { refresh: true });
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (row && row.Subject && row.GameName) {
            names[row.Subject] = row.TagLine ? `${row.GameName}#${row.TagLine}` : row.GameName;
          }
        }
      }
    } catch { /* names stay fallback */ }
    return names;
  }

  async seasons() {
    const now = Date.now();
    if (contentCache.seasons && now - contentCache.at < 3600000) return contentCache.seasons;
    try {
      const headers = await this.auth.headers();
      const res = await requestJson('GET', `https://shared.${this.auth.shard}.a.pvp.net/content-service/v3/content`, {
        headers,
        timeout: 8000,
      });
      const seasons = (res.json && res.json.Seasons) || [];
      if (seasons.length) contentCache = { seasons, at: now };
      return seasons.length ? seasons : (contentCache.seasons || []);
    } catch {
      return contentCache.seasons || [];
    }
  }

  async seasonId() {
    const seasons = await this.seasons();
    const current = seasons.find((s) => s.IsActive && s.Type === 'act');
    return current ? current.ID : null;
  }

  async prevSeasonId() {
    const seasons = await this.seasons();
    const current = seasons.find((s) => s.IsActive && s.Type === 'act');
    if (!current) return null;
    const prev = seasons.find((s) => s.Type === 'act' && s.EndTime === current.StartTime);
    return prev ? prev.ID : null;
  }

  async rankInfo(puuid, season, prevSeason) {
    const cached = rankCache.get(puuid);
    if (cached && Date.now() - cached.at < 60000) return cached.value;
    const out = { tier: 0, rr: 0, peak: 0, wr: 0, games: 0, prev: 0, ok: false };
    try {
      const body = await this.auth.pdGet(`/mmr/v1/players/${puuid}`);
      if (!body || !body.QueueSkills) return out;
      const seasons = (((body.QueueSkills || {}).competitive || {}).SeasonalInfoBySeasonID) || {};
      const current = (season && seasons[season]) || {};
      out.ok = true;
      out.tier = current.CompetitiveTier || 0;
      out.rr = current.RankedRating || 0;
      if (prevSeason) out.prev = (seasons[prevSeason] || {}).CompetitiveTier || 0;
      let peak = out.tier;
      for (const info of Object.values(seasons)) {
        for (const tier of Object.keys(info.WinsByTier || {})) {
          const value = Number(tier) || 0;
          if (value > peak) peak = value;
        }
      }
      out.peak = peak;
      const wins = current.NumberOfWinsWithPlacements || 0;
      const games = current.NumberOfGames || 0;
      out.games = games;
      out.wr = games ? Math.round((wins / games) * 100) : 0;
      rankCache.set(puuid, { at: Date.now(), value: out });
    } catch { /* keep empty rank */ }
    return out;
  }

  async kdHs(puuid, count = 3) {
    const hit = kdCache.get(puuid);
    if (hit && Date.now() - hit.at < 120000) return hit.value;
    try {
      const hist = await this.auth.pdGet(`/match-history/v1/history/${puuid}?startIndex=0&endIndex=${count}&queue=competitive`, { retries: 1 });
      if (isThrottled(hist)) return { kd: null, hs: null, pending: true };
      let entries = (hist && hist.History) || [];
      if (!entries.length) {
        const any = await this.auth.pdGet(`/match-history/v1/history/${puuid}?startIndex=0&endIndex=${count}`, { retries: 1 });
        if (isThrottled(any)) return { kd: null, hs: null, pending: true };
        entries = (any && any.History) || [];
      }
      const mids = entries.map((row) => row.MatchID).filter(Boolean).slice(0, count);
      if (!mids.length) {
        const empty = { kd: null, hs: null, pending: false };
        kdCache.set(puuid, { at: Date.now(), value: empty });
        return empty;
      }
      let kills = 0;
      let deaths = 0;
      let hits = 0;
      let heads = 0;
      let combatScore = 0;
      let roundsPlayed = 0;
      let used = 0;
      for (const mid of mids) {
        const detail = await this.auth.pdGet(`/match-details/v1/matches/${mid}`, { retries: 1 });
        if (!detail || !detail.players) continue;
        for (const round of detail.roundResults || []) {
          for (const stats of round.playerStats || []) {
            if (stats.subject !== puuid) continue;
            for (const dmg of stats.damage || []) {
              hits += (dmg.legshots || 0) + (dmg.bodyshots || 0) + (dmg.headshots || 0);
              heads += dmg.headshots || 0;
            }
          }
        }
        const me = (detail.players || []).find((row) => row.subject === puuid);
        if (me && me.stats) {
          kills += me.stats.kills || 0;
          deaths += me.stats.deaths || 0;
          combatScore += Number(me.stats.score || 0);
          roundsPlayed += Number(me.stats.roundsPlayed || 0);
          used += 1;
        }
      }
      if (!used) return { kd: null, hs: null, pending: true };
      const value = {
        kd: deaths ? Math.round((kills / deaths) * 100) / 100 : kills,
        hs: hits ? Math.round((heads / hits) * 100) : null,
        acs: roundsPlayed ? Math.round(combatScore / roundsPlayed) : null,
        pending: false,
      };
      kdCache.set(puuid, { at: Date.now(), value });
      return value;
    } catch {
      return { kd: null, hs: null, pending: true };
    }
  }

  fillStats(matchId, puuids) {
    const key = matchId || 'lobby';
    if (filling.has(key)) return;
    filling.add(key);
    Promise.resolve().then(async () => {
      try {
        for (const puuid of puuids) {
          const cacheKey = `${key}:${puuid}`;
          const entry = playerCache.get(cacheKey);
          if (!entry || entry.kdDone) continue;
          const stats = await this.kdHs(puuid, 3);
          if (stats.kd != null || stats.hs != null) {
            entry.kd = stats.kd;
            entry.hs = stats.hs;
            entry.acs = stats.acs;
            entry.kdDone = !stats.pending;
          } else if (!stats.pending) {
            entry.kdDone = true;
          }
        }
      } finally {
        filling.delete(key);
      }
    }).catch(() => filling.delete(key));
  }

  async currentPlayers(state) {
    if (state === 'INGAME') {
      const player = await this.auth.glzGet(`/core-game/v1/players/${this.selfPuuid}`);
      const matchId = player && player.MatchID;
      if (!matchId) return null;
      const match = await this.auth.glzGet(`/core-game/v1/matches/${matchId}`);
      return {
        players: match.Players || [],
        matchId,
        mapId: match.MapID || '',
        // Core-game (in-match) responses put the queue at the top level as
        // `QueueID`; `MatchmakingData` is not populated once the match begins.
        queue: match.QueueID || '',
      };
    }
    if (state === 'PREGAME') {
      const player = await this.auth.glzGet(`/pregame/v1/players/${this.selfPuuid}`);
      const matchId = player && player.MatchID;
      if (!matchId) return null;
      const match = await this.auth.glzGet(`/pregame/v1/matches/${matchId}`);
      const ally = match.AllyTeam || {};
      const players = (ally.Players || []).map((row) => ({ ...row, TeamID: ally.TeamID || 'Blue' }));
      return { players, matchId, mapId: match.MapID || '', queue: (match.MatchmakingData || {}).QueueID || '' };
    }
    return null;
  }

  async authoritativePartyPlayers() {
    await this.cachePartyIdentities();
    // Only the real Riot party payload decides membership — never the presence
    // /friend list. Presence data is used later only to enrich each member's name/card.
    let members = await this.authoritativePartyMembers();
    // When connected to the game but not in a party (MENUS), still surface the
    // signed-in self player so the lobby board carries the real profile
    // (PFP/banner from currentProfileAssets) instead of showing empty.
    if (!members.length) members = [{ puuid: this.selfPuuid, level: 0 }];
    if (!members.length) return [];
    const puuids = members.map((m) => m.puuid);
    const names = await this.revealNames(puuids);
    const season = await this.seasonId();
    const prev = await this.prevSeasonId();
    const acts = await this.seasons();
    const currentAct = acts.find((s) => s.IsActive && s.Type === 'act');
    const profileAssets = await currentProfileAssets(this.auth, currentAct && currentAct.EndTime);
    const players = [];
    for (const member of members) {
      const rank = await this.rankInfo(member.puuid, season, prev);
      const cacheKey = `lobby:${member.puuid}`;
          const cached = playerCache.get(cacheKey) || { kd: null, hs: null, acs: null, kdDone: false };
      playerCache.set(cacheKey, cached);
      const name = names[member.puuid] || fallbackName(member.puuid);
      const known = playerIdentityCache.get(member.puuid) || {};
      let displayName = known.name || names[member.puuid] || fallbackName(member.puuid);
      if (typeof displayName !== 'string') displayName = fallbackName(member.puuid);
      const knownAssets = member.puuid === this.selfPuuid
        ? profileAssets
        : await knownPlayerAssets(known.cardId);
      const memberLevel = member.puuid === this.selfPuuid
        ? profileAssets.profileLevel
        : (member.level != null ? member.level : null);
      players.push(await assemblePlayer({
        puuid: member.puuid,
        name: displayName,
        nameHidden: false,
        team: 'Blue',
        isSelf: member.puuid === this.selfPuuid,
        agentId: '',
        rankInfo: rank,
        kd: cached.kd,
        hs: cached.hs,
        acs: cached.acs,
        rankPending: !rank.ok,
        statsPending: !cached.kdDone,
        profilePfp: knownAssets.profilePfp || null,
        profileBanner: knownAssets.profileBanner || null,
        profileLevel: memberLevel != null ? memberLevel : null,
        profileActEnds: member.puuid === this.selfPuuid ? profileAssets.profileActEnds : null,
      }));
    }
    this.fillStats('lobby', puuids);
    return players;
  }

  async buildLobby() {
    const party = await this.authoritativePartyPlayers();
    return await finalize(party, {
      state: 'MENUS',
      selfTeam: 'Blue',
      mapName: null,
      mode: 'Lobby',
      matchId: `lobby:${party.map((p) => p.puuid).sort().join(',')}`,
      party,
    });
  }

  async buildScoreboard() {
    const presences = await chatPresences(this.auth);
    // Preserve known party/presence identities for players who transition
    // from the lobby into the opposing team of a custom/Skirmish match.
    this.partyMembers(presences);
    await this.cachePartyIdentities();
    const state = await this.gameState(presences);
    if (state === 'MENUS') return this.buildLobby();
    if (state !== 'INGAME' && state !== 'PREGAME') {
      const party = await this.authoritativePartyPlayers();
      return await finalize([], { state, selfTeam: 'Blue', mapName: null, mode: null, matchId: state, party });
    }
    const current = await this.currentPlayers(state);
    if (!current) {
      return await finalize([], { state: 'MENUS', selfTeam: 'Blue', mapName: null, mode: 'Lobby', matchId: 'empty' });
    }
    const names = await this.revealNames(current.players.map((p) => p.Subject));
    const season = await this.seasonId();
    const prev = await this.prevSeasonId();
    const selfTeam = (current.players.find((p) => p.Subject === this.selfPuuid) || {}).TeamID || 'Blue';
    // Gun skins currently equipped, keyed by puuid. Best-effort: the same
    // loadout data the client itself uses to render weapon art in Agent
    // Select / in-match, not anything hidden from the player.
    const skinByPuuid = await matchLoadoutIcons(this.auth, state, current.matchId);
    const acts = await this.seasons();
    const currentAct = acts.find((s) => s.IsActive && s.Type === 'act');
    const profileAssets = await currentProfileAssets(this.auth, currentAct && currentAct.EndTime);
    const players = [];
    for (const row of current.players) {
      const ident = row.PlayerIdentity || {};
      const cacheKey = `${current.matchId}:${row.Subject}`;
      const cached = playerCache.get(cacheKey) || { kd: null, hs: null, acs: null, kdDone: false };
      if (!cached.rank) cached.rank = await this.rankInfo(row.Subject, season, prev);
      playerCache.set(cacheKey, cached);
      const known = playerIdentityCache.get(row.Subject) || {};
      // Resolve each player's equipped player card from the authoritative match
      // roster identity when present (covers enemies not in the party/presence
      // cache). smallArt becomes the profile PFP, wideArt/largeArt the banner.
      const cardId = ident.PlayerCardID || known.cardId || null;
      if (cardId) playerIdentityCache.set(row.Subject, { ...known, cardId });
      // Prefer the already-known party Riot ID over corrupted/placeholder
      // name-service text when this PUUID was in the lobby before the match.
      let name = known.name || names[row.Subject];
      if (!name) {
        const agent = resolveAgent(row.CharacterID || '');
        name = state !== 'PREGAME' && agent ? agent.name : fallbackName(row.Subject);
      }
      const knownAssets = row.Subject === this.selfPuuid
        ? profileAssets
        : await knownPlayerAssets(cardId);
      players.push(await assemblePlayer({
        puuid: row.Subject,
        name,
        nameHidden: Boolean(ident.Incognito),
        team: row.TeamID || 'Blue',
        isSelf: row.Subject === this.selfPuuid,
        agentId: row.CharacterID || '',
        rankInfo: cached.rank,
        kd: cached.kd,
        hs: cached.hs,
        acs: cached.acs,
        selection: state === 'PREGAME' ? row.CharacterSelectionState : null,
        rankPending: !cached.rank.ok,
        statsPending: !cached.kdDone,
        skinIcon: (skinByPuuid[row.Subject] || {}).skinIcon || null,
        profilePfp: knownAssets.profilePfp || null,
        profileBanner: knownAssets.profileBanner || null,
        profileLevel: row.Subject === this.selfPuuid ? profileAssets.profileLevel : null,
        profileActEnds: row.Subject === this.selfPuuid ? profileAssets.profileActEnds : null,
      }));
    }
    const party = await this.authoritativePartyPlayers();
    this.fillStats(current.matchId, current.players.map((p) => p.Subject));
    return await finalize(players, {
      state,
      selfTeam,
      mapName: mapNameFromPath(current.mapId),
      mode: modeLabel(current.queue),
      matchId: current.matchId,
      party,
    });
  }
}

async function snapshotClient() {
  if (!lockfileAvailable()) {
    return {
      running: false,
      state: 'OFFLINE',
      stateLabel: STATES.OFFLINE,
      source: 'local',
      notice: noticeFor(null),
    };
  }
  try {
    const auth = new LocalAuth();
    await auth.headers();
    const live = new LiveMatch(auth);
    const presences = await chatPresences(auth);
    const state = await live.gameState(presences);
    return {
      running: true,
      state,
      stateLabel: STATES[state] || state,
      source: 'local',
      notice: null,
    };
  } catch (error) {
    return {
      running: lockfileAvailable(),
      state: 'OFFLINE',
      stateLabel: STATES.OFFLINE,
      source: 'local',
      notice: noticeFor(error),
    };
  }
}

async function buildLive() {
  const run = async () => {
    if (lastGood.board && Date.now() - lastGood.at < FRESH_MS) {
      return publicBoard(lastGood.board);
    }
    if (!lockfileAvailable()) {
      return publicBoard({
        running: false,
        state: 'OFFLINE',
        stateLabel: STATES.OFFLINE,
        source: 'none',
        players: [],
        notice: noticeFor(null),
        updatedAt: Date.now(),
      });
    }
    try {
      const auth = new LocalAuth();
      await auth.headers();
      const live = new LiveMatch(auth);
      const board = await live.buildScoreboard();
      lastGood = { board, at: Date.now() };
      return publicBoard(board);
    } catch (error) {
      if (lastGood.board && Date.now() - lastGood.at < HOLD_MS) {
        return publicBoard({ ...lastGood.board, stale: true, reconnecting: true, notice: noticeFor(error) });
      }
      return publicBoard({
        running: lockfileAvailable(),
        state: 'OFFLINE',
        stateLabel: STATES.OFFLINE,
        source: 'local',
        players: [],
        notice: noticeFor(error),
        updatedAt: Date.now(),
      });
    }
  };
  const pending = buildLock.then(run, run);
  buildLock = pending.then(() => undefined, () => undefined);
  return pending;
}

function invalidateLive() {
  lastGood = { board: null, at: 0 };
}

module.exports = { snapshotClient, buildLive, ClientNotReady, publicBoard, invalidateLive, LiveMatch };
