'use strict';

/*
 * Nightfall account profile summary — the SEPARATE data path for the
 * dashboard's account statistics (rank, win rate, K/D, headshot %, favorite
 * agent, recent form, latest matches). Deliberately independent of the live
 * lobby / Agent Select / in-game board in lib/live-match.js.
 *
 * Real values are computed and cached; nothing is ever faked. When a data
 * source is connected but a specific statistic cannot be computed, that
 * field is null (the UI shows N/A). When no account/source is connected the
 * server reports source 'none' so the dashboard keeps its demo fallback.
 *
 * Credentials and local-client session secrets never leave this module.
 */

const { LocalAuth, lockfileAvailable } = require('./local-auth');
const { LiveMatch } = require('./live-match');
const { rankFromTier, mapNameFromPath, modeLabel } = require('./vconstants');
const { resolveAgent, agentArt } = require('./agents');
const { agentAssets, getMapAsset } = require('./valorant-assets');

const RECENT_COUNT = 10;    // competitive matches used for stats
const DISPLAY_COUNT = 6;    // latest matches shown
const HISTORY_COUNT = 20;   // recent matches listed on Match History
const CACHE_MS = 60000;     // refresh the dashboard at most ~1/min

let cache = { at: 0, value: null };
let histCache = { at: 0, value: null };

// Shared match-detail cache so Overview and Match History reuse the same
// fetched details instead of making duplicate network requests.
const DETAIL_CACHE_MAX = 400;
const detailCache = new Map();
function getCachedDetail(mid) {
  const hit = detailCache.get(mid);
  return (hit && Date.now() - hit.at < 120000) ? hit.detail : null;
}
function setCachedDetail(mid, detail) {
  if (detailCache.size >= DETAIL_CACHE_MAX) detailCache.clear();
  detailCache.set(mid, { at: Date.now(), detail });
}

const REGION_MAP = {
  na: ['na-1', 'americas'], eu: ['eu-1', 'europe'], ap: ['ap-1', 'asia'],
  kr: ['kr-1', 'asia'], latam: ['na-1', 'americas'], br: ['na-1', 'americas'],
};
function routing() {
  const shard = process.env.RIOT_PLATFORM || 'ap';
  const region = REGION_MAP[shard] || REGION_MAP.ap;
  return { shard: region[0], regional: process.env.RIOT_REGIONAL_ROUTING || region[1] };
}
const configured = () => Boolean(process.env.RIOT_API_KEY && process.env.RIOT_RSO_ACCESS_TOKEN);

function relTime(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(ms).toLocaleDateString();
}

function reduceMatch(detail, puuid) {
  if (!detail || !Array.isArray(detail.players)) return null;
  const me = detail.players.find((p) => p.subject === puuid);
  if (!me) return null;
  const info = detail.matchInfo || {};
  const myTeamId = me.teamId;
  const teams = Array.isArray(detail.teams) ? detail.teams : [];
  const myTeam = teams.find((t) => t.teamId === myTeamId) || {};
  const oppTeam = teams.find((t) => t.teamId && t.teamId !== myTeamId) || {};
  const st = me.stats || {};
  let hits = 0; let heads = 0;
  for (const round of detail.roundResults || []) {
    for (const ps of round.playerStats || []) {
      if (ps.subject !== puuid) continue;
      for (const dmg of ps.damage || []) {
        hits += (dmg.legshots || 0) + (dmg.bodyshots || 0) + (dmg.headshots || 0);
        heads += dmg.headshots || 0;
      }
    }
  }
  const agent = resolveAgent(me.characterId || '');
  const millis = info.gameLengthMillis || 0;
  const mins = millis ? Math.floor(millis / 60000) : 0;
  return {
    id: info.matchId || me.matchId || '',
    won: Boolean(myTeam.won),
    map: mapNameFromPath(info.mapId || ''),
    // VALORANT match-details uses `matchInfo.queueID` (capital ID). Cover the
    // common casings so the mode is resolved instead of falling through to the
    // "Custom" default, which previously made the Competitive/Unrated filters
    // match nothing.
    mode: modeLabel(info.queueID || info.queueId || info.QueueID),
    agent: agent ? agent.name : null,
    kills: st.kills || 0,
    deaths: st.deaths || 0,
    assists: st.assists || 0,
    acs: st.roundsPlayed && Number.isFinite(Number(st.score))
      ? Math.round(Number(st.score) / Number(st.roundsPlayed)) : null,
    score: `${myTeam.roundsWon || 0} — ${oppTeam.roundsWon || 0}`,
    hs: hits ? Math.round((heads / hits) * 100) : null,
    start: info.gameStartMillis || info.gameStartTime || 0,
    duration: mins || null,
  };
}
function collate(rows) {
  if (!rows.length) return null;
  let wins = 0; let kills = 0; let deaths = 0; let hsSum = 0; let hsN = 0;
  const agentMap = {};
  for (const r of rows) {
    if (r.won) wins += 1;
    kills += r.kills;
    deaths += r.deaths;
    if (r.hs != null) { hsSum += r.hs; hsN += 1; }
    if (!r.agent) continue;
    agentMap[r.agent] = agentMap[r.agent] || { games: 0, wins: 0, kills: 0, deaths: 0 };
    const a = agentMap[r.agent];
    a.games += 1;
    if (r.won) a.wins += 1;
    a.kills += r.kills;
    a.deaths += r.deaths;
  }
  let favName = null; let fav = null;
  for (const [name, a] of Object.entries(agentMap)) {
    if (!favName || a.games > fav.games) { favName = name; fav = a; }
  }
  const played = rows.length;
  return {
    winRate: Math.round((wins / played) * 100),
    games: played,
    kd: deaths ? Math.round((kills / deaths) * 100) / 100 : (kills ? kills : null),
    hs: hsN ? Math.round(hsSum / hsN) : null,
    favoriteAgent: favName ? {
      name: favName,
      games: fav.games,
      winRate: fav.games ? Math.round((fav.wins / fav.games) * 100) : 0,
      kd: fav.deaths ? Math.round((fav.kills / fav.deaths) * 100) / 100 : (fav.kills ? fav.kills : null),
    } : null,
  };
}

function rowsToMatches(rows) {
  return rows.slice(0, DISPLAY_COUNT).map((r) => ({
    result: r.won ? 'VICTORY' : 'DEFEAT',
    map: r.map || 'Unknown',
    mode: r.mode || 'Competitive',
    agent: r.agent || '—',
    kda: `${r.kills} / ${r.deaths} / ${r.assists}`,
    score: r.score,
    date: relTime(r.start),
    matchId: r.id,
    kd: r.deaths ? Math.round((r.kills / r.deaths) * 100) / 100 : (r.kills ? r.kills : '—'),
    duration: r.duration,
  }));
}

// Separate richer format for Match History (more fields, no display limit).
async function rowsToHistory(rows) {
  const mapAssets = {};
  await Promise.all(rows.map(async (r) => {
    if (!r.map || mapAssets[r.map]) return;
    const asset = await getMapAsset(r.map);
    mapAssets[r.map] = asset || {};
  }));
  return rows.map((r) => {
    const agent = resolveAgent(r.agent || '');
    const map = mapAssets[r.map] || {};
    const art = agent ? agentAssets(agent.uuid) : null;
    return {
    result: r.won ? 'VICTORY' : 'DEFEAT',
    map: r.map || 'Unknown',
    mode: r.mode || 'Competitive',
    agent: r.agent || '—',
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    kda: `${r.kills} / ${r.deaths} / ${r.assists}`,
    acs: r.acs,
    kd: r.deaths ? Math.round((r.kills / r.deaths) * 100) / 100 : (r.kills ? r.kills : null),
    score: r.score,
    date: relTime(r.start),
    matchId: r.id,
    duration: r.duration,
    start: r.start,
    mapSplash: map.splash || map.listIcon || null,
    agentIcon: art && art.icon || null,
    };
  });
}

// Shared match-detail fetcher that uses the in-memory cache.
async function fetchDetail(mid, auth, fetchFn) {
  const cached = getCachedDetail(mid);
  if (cached) return cached;
  try {
    let detail;
    if (fetchFn) detail = await fetchFn(mid);
    else detail = await auth.pdGet(`/match-details/v1/matches/${mid}`, { retries: 1 });
    if (detail && Array.isArray(detail.players)) {
      setCachedDetail(mid, detail);
      return detail;
    }
  } catch { /* skip */ }
  return null;
}

// Matches are pulled through a helper so both Overview and Match History share
// the detail cache and avoid duplicate network requests.
async function fetchMatchRows(puuid, count, auth, fetchFn) {
  const rows = [];
  try {
    const hist = fetchFn
      ? await fetchFn(`/val/match/v1/matchlists/by-puuid/${encodeURIComponent(puuid)}`, count)
      : await auth.pdGet(`/match-history/v1/history/${puuid}?startIndex=0&endIndex=${count - 1}`, { retries: 1 });
    const entries = (hist && hist.History) || (Array.isArray(hist) ? hist : (hist && (hist.history || [])));
    const mids = entries.map((e) => e.matchId || e.MatchID).filter(Boolean).slice(0, count);
    for (const mid of mids) {
      const detail = await fetchDetail(mid, auth, fetchFn);
      const row = reduceMatch(detail, puuid);
      if (row) rows.push(row);
    }
  } catch { /* rows may be partial */ }
  return rows.sort((a, b) => b.start - a.start);
}

async function buildLocal() {
  if (!lockfileAvailable()) return null;
  const auth = new LocalAuth();
  await auth.headers();
  const live = new LiveMatch(auth);
  const puuid = auth.puuid;
  const season = await live.seasonId();
  const prev = await live.prevSeasonId();
  const rank = await live.rankInfo(puuid, season, prev);

  let rows = await fetchMatchRows(puuid, RECENT_COUNT, auth);

  let account = null;
  try {
    const names = await live.revealNames([puuid]);
    const full = names[puuid] || '';
    const hash = full.lastIndexOf('#');
    if (full) {
      account = hash > 0
        ? { gameName: full.slice(0, hash), tagLine: full.slice(hash + 1), puuid }
        : { gameName: full, tagLine: '', puuid };
    }
  } catch { account = null; }

  return {
    source: 'local',
    account,
    rank: rank && rank.ok ? {
      name: rankFromTier(rank.tier).name,
      rr: rank.rr != null ? rank.rr : null,
      peak: rank.peak != null ? rankFromTier(rank.peak).name : null,
    } : null,
    stats: collate(rows),
    form: rows.map((r) => (r.won ? 'W' : 'L')),
    matches: rowsToMatches(rows),
  };
}

async function buildOfficial() {
  if (!configured()) return null;
  const { shard, regional } = routing();
  const base = (p) => `https://${regional}.api.riotgames.com${p}`;
  const h = {
    Authorization: `Bearer ${process.env.RIOT_RSO_ACCESS_TOKEN}`,
    'X-Riot-Token': process.env.RIOT_API_KEY,
  };
  const accountRes = await fetch(base('/riot/account/v1/accounts/me'), { headers: h });
  if (!accountRes.ok) return { source: 'official', account: null, reason: 'account' };
  const acct = await accountRes.json();
  const account = { gameName: acct.gameName, tagLine: acct.tagLine, puuid: acct.puuid };

  // Official fetch wrapper for the shared helpers.
  const officialFetch = async (url, listCount) => {
    if (listCount) {
      const r = await fetch(url, { headers: h });
      if (!r || !r.ok) return { history: [] };
      const list = await r.json();
      return { history: (Array.isArray(list) ? list : list.history || []).slice(0, listCount) };
    }
    const r = await fetch(url, { headers: h });
    if (!r.ok) return null;
    return r.json();
  };

  const rows = await fetchMatchRows(acct.puuid, RECENT_COUNT, null, officialFetch);
  return {
    source: 'official',
    account,
    rank: null, // public VALORANT API offers no general current-rank endpoint.
    stats: collate(rows),
    form: rows.map((r) => (r.won ? 'W' : 'L')),
    matches: rowsToMatches(rows),
  };
}

async function buildProfileSummary() {
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_MS) return cache.value;

  // Prefer the official API first: it returns real account profile and
  // statistics WITHOUT requiring VALORANT to be running. Then read the local
  // Riot client for rank / current RR / peak where it is available.
  let official = null;
  let local = null;
  try { official = await buildOfficial(); } catch { official = null; }
  try { local = await buildLocal(); } catch { local = null; }

  let result = null;
  if (official && official.account) {
    // Official source works regardless of VALORANT. Use its account + stats;
    // layer local rank / RR / peak on top when the client is reachable.
    result = {
      source: 'official',
      account: official.account,
      rank: (local && local.rank) ? local.rank : null,
      stats: official.stats,
      form: official.form,
      matches: official.matches,
    };
  } else if (local) {
    result = { ...local, source: 'local' };
  } else {
    result = { source: 'none', account: null, rank: null, stats: null, form: [], matches: [] };
  }
  cache = { at: now, value: result };
  return result;
}

// ── Match History (separate endpoint, separate cache, 20 matches ──

async function buildHistoryLocal() {
  if (!lockfileAvailable()) return null;
  const auth = new LocalAuth();
  await auth.headers();
  const live = new LiveMatch(auth);
  const puuid = auth.puuid;
  if (!puuid) return null;
  const rows = await fetchMatchRows(puuid, HISTORY_COUNT, auth);
  let account = null;
  try {
    const names = await live.revealNames([puuid]);
    const full = names[puuid] || '';
    const hash = full.lastIndexOf('#');
    if (full) {
      account = hash > 0
        ? { gameName: full.slice(0, hash), tagLine: full.slice(hash + 1), puuid }
        : { gameName: full, tagLine: '', puuid };
    }
  } catch { account = null; }
  return { source: 'local', account, matches: await rowsToHistory(rows) };
}

async function buildHistoryOfficial() {
  if (!configured()) return null;
  const { shard, regional } = routing();
  const base = (p) => `https://${regional}.api.riotgames.com${p}`;
  const h = {
    Authorization: `Bearer ${process.env.RIOT_RSO_ACCESS_TOKEN}`,
    'X-Riot-Token': process.env.RIOT_API_KEY,
  };
  const accountRes = await fetch(base('/riot/account/v1/accounts/me'), { headers: h });
  if (!accountRes.ok) return { source: 'official', account: null, matches: [] };
  const acct = await accountRes.json();
  const account = { gameName: acct.gameName, tagLine: acct.tagLine, puuid: acct.puuid };
  const officialFetch = async (url, listCount) => {
    if (listCount) {
      const r = await fetch(url, { headers: h });
      if (!r || !r.ok) return { history: [] };
      const list = await r.json();
      return { history: (Array.isArray(list) ? list : list.history || []).slice(0, listCount) };
    }
    const r = await fetch(url, { headers: h });
    if (!r.ok) return null;
    return r.json();
  };
  const rows = await fetchMatchRows(acct.puuid, HISTORY_COUNT, null, officialFetch);
  return { source: 'official', account, matches: await rowsToHistory(rows) };
}

async function buildMatchHistory() {
  const now = Date.now();
  if (histCache.value && now - histCache.at < CACHE_MS) return histCache.value;
  let official = null;
  let local = null;
  try { official = await buildHistoryOfficial(); } catch { official = null; }
  try { local = await buildHistoryLocal(); } catch { local = null; }
  let result;
  if (official && official.account) {
    result = { source: 'official', account: official.account, matches: official.matches };
  } else if (local) {
    result = local;
  } else {
    result = { source: 'none', account: null, matches: [] };
  }
  histCache = { at: now, value: result };
  return result;
}

module.exports = { buildProfileSummary, buildMatchHistory, buildMatchDetail };

// Full match-detail roster for the Match History "View Teams" expanded panel.
// Uses the SAME real local-Riot-client data path as the rest of Match History
// (match-details + name-service + agent map). No data is fabricated: names,
// agents, K/D/A, ACS and ADR all come from the actual match payload. ADR is
// computed from the per-round damage table (it is "if available"). Deathmatch
// is returned as a single standings list instead of a forced 5v5 layout.
async function buildMatchDetail(matchId) {
  if (!matchId) return { source: 'none', error: 'Missing match id.' };
  try {
    if (!lockfileAvailable()) return { source: 'none', error: 'Riot Client is not running.' };
    const auth = new LocalAuth();
    await auth.headers();
    const live = new LiveMatch(auth);
    const detail = await fetchDetail(matchId, auth, null);
    if (!detail || !Array.isArray(detail.players)) return { source: 'none', error: 'No match detail available.' };

    const puuid = auth.puuid;
    const info = detail.matchInfo || {};
    const mode = modeLabel(info.queueID || info.queueId || info.QueueID);
    const map = mapNameFromPath(info.mapId || '');

    // Damage per round (for ADR), aggregated across roundResults.
    const dmgBySubject = {};
    for (const round of detail.roundResults || []) {
      for (const ps of round.playerStats || []) {
        let dmg = 0;
        for (const d of ps.damage || []) dmg += (d.headshots || 0) + (d.bodyshots || 0) + (d.legshots || 0);
        if (dmg) dmgBySubject[ps.subject] = (dmgBySubject[ps.subject] || 0) + dmg;
      }
    }

    const players = detail.players.map((p) => {
      const st = p.stats || {};
      const agent = resolveAgent(p.characterId || '');
      const played = Number(st.roundsPlayed) || 0;
      const score = Number(st.score) || 0;
      return {
        puuid: p.subject,
        teamId: p.teamId || null,
        name: null,
        agent: agent ? agent.name : null,
        agentIcon: agent ? agentArt(agent.uuid).icon : null,
        kills: st.kills || 0,
        deaths: st.deaths || 0,
        assists: st.assists || 0,
        acs: played ? Math.round(score / played) : null,
        adr: played && dmgBySubject[p.subject] ? Math.round(dmgBySubject[p.subject] / played) : null,
        score,
      };
    });

    const subjects = players.map((p) => p.puuid).filter(Boolean);
    if (subjects.length) {
      try {
        const names = await live.revealNames(subjects);
        for (const p of players) {
          if (p.puuid && names[p.puuid]) p.name = names[p.puuid];
        }
      } catch { /* names stay null */ }
    }

    if (String(info.queueID || '').toLowerCase() === 'deathmatch') {
      players.sort((a, b) => b.score - a.score);
      return { source: 'local', mode, map, deathmatch: true, players };
    }

    const detailTeams = Array.isArray(detail.teams) ? detail.teams : [];
    const teamScore = (tid) => {
      if (!tid) return { won: null, roundsWon: null };
      const t = detailTeams.find((x) => x.teamId === tid) || {};
      return { won: t.won == null ? null : Boolean(t.won), roundsWon: t.roundsWon == null ? null : t.roundsWon };
    };
    const myTeamId = (detail.players.find((p) => p.subject === puuid) || {}).teamId || null;
    const allies = players.filter((p) => p.teamId === myTeamId).slice().sort((a, b) => b.score - a.score);
    const enemies = players.filter((p) => p.teamId && p.teamId !== myTeamId).slice().sort((a, b) => b.score - a.score);
    const oppId = enemies.length ? enemies[0].teamId : null;

    return {
      source: 'local',
      mode,
      map,
      deathmatch: false,
      teams: [
        { teamId: myTeamId, label: 'YOUR TEAM', ...teamScore(myTeamId), players: allies },
        { teamId: oppId, label: 'OPPONENT', ...teamScore(oppId), players: enemies },
      ],
    };
  } catch (error) {
    return { source: 'none', error: 'Could not load match details.' };
  }
}

