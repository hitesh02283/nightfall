'use strict';

/*
 * Cosmetic asset lookups from the public, unofficial valorant-api.com
 * (media CDN + reference data). Nothing here talks to the local Riot
 * Client or to Riot's authenticated APIs — it only fetches static,
 * publicly-cacheable game data (agent art, rank emblems, map art, spray
 * and gun-buddy icons) and caches it in memory for an hour at a time.
 */

const TTL_MS = 60 * 60 * 1000;

const cache = {
  maps: { at: 0, byName: null },
  ranks: { at: 0, byName: null },
  buddies: { at: 0, byUuid: null },
  sprays: { at: 0, byUuid: null },
};

function normalize(name) {
  return String(name || '').trim().toLowerCase();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`valorant-api.com returned ${res.status}`);
  const body = await res.json();
  return body && body.data;
}

// Agent art is served from a predictable CDN path keyed by the same agent
// UUIDs already in lib/agents.js, so no network round trip is needed.
function agentAssets(uuid) {
  if (!uuid) return null;
  const id = String(uuid).toLowerCase();
  const base = `https://media.valorant-api.com/agents/${id}`;
  return {
    icon: `${base}/displayicon.png`,
    portrait: `${base}/fullportrait.png`,
    killfeed: `${base}/killfeedportrait.png`,
  };
}

async function getMapAssets() {
  const now = Date.now();
  if (cache.maps.byName && now - cache.maps.at < TTL_MS) return cache.maps.byName;
  const byName = {};
  try {
    const maps = await fetchJson('https://valorant-api.com/v1/maps');
    for (const m of maps || []) {
      if (!m || !m.displayName) continue;
      byName[normalize(m.displayName)] = {
        splash: m.splash || null,
        listIcon: m.listViewIcon || null,
        minimap: m.displayIcon || null,
      };
    }
  } catch { /* keep whatever we had, or empty */ }
  if (Object.keys(byName).length) cache.maps = { at: now, byName };
  return cache.maps.byName || byName;
}

async function getMapAsset(name) {
  const all = await getMapAssets();
  return all[normalize(name)] || null;
}

// Player-card artwork for the equipped Riot player card.
async function getPlayerCardAsset(uuid) {
  if (!uuid) return null;
  try {
    const card = await fetchJson(`https://valorant-api.com/v1/playercards/${encodeURIComponent(uuid)}`);
    if (!card) return null;
    return {
      id: card.uuid || uuid,
      name: card.displayName || null,
      smallArt: card.smallArt || null,
      wideArt: card.wideArt || null,
      largeArt: card.largeArt || null,
    };
  } catch {
    return null;
  }
}

// Rank emblems: valorant-api.com keeps one "episode" of competitive tiers
// active at a time. We take the last entry, which is always the current one.
async function getRankIcons() {
  const now = Date.now();
  if (cache.ranks.byName && now - cache.ranks.at < TTL_MS) return cache.ranks.byName;
  const byName = {};
  try {
    const tierSets = await fetchJson('https://valorant-api.com/v1/competitivetiers');
    const current = (tierSets || [])[tierSets.length - 1];
    for (const tier of (current && current.tiers) || []) {
      if (!tier || !tier.tierName) continue;
      const label = tier.tierName.trim() === 'Unranked' ? 'Unranked' : tier.tierName.trim();
      byName[normalize(label)] = {
        small: tier.smallIcon || null,
        large: tier.largeIcon || null,
      };
    }
  } catch { /* ignore */ }
  if (Object.keys(byName).length) cache.ranks = { at: now, byName };
  return cache.ranks.byName || byName;
}

async function getRankIcon(rankName) {
  const all = await getRankIcons();
  return all[normalize(rankName)] || null;
}

async function getBuddyDefs() {
  const now = Date.now();
  if (cache.buddies.byUuid && now - cache.buddies.at < TTL_MS) return cache.buddies.byUuid;
  const byUuid = {};
  try {
    const buddies = await fetchJson('https://valorant-api.com/v1/buddies');
    for (const b of buddies || []) {
      for (const level of b.levels || []) {
        if (!level || !level.uuid) continue;
        byUuid[level.uuid.toLowerCase()] = { name: b.displayName, icon: level.displayIcon || b.displayIcon };
      }
    }
  } catch { /* ignore */ }
  if (Object.keys(byUuid).length) cache.buddies = { at: now, byUuid };
  return cache.buddies.byUuid || byUuid;
}

async function getSprayDefs() {
  const now = Date.now();
  if (cache.sprays.byUuid && now - cache.sprays.at < TTL_MS) return cache.sprays.byUuid;
  const byUuid = {};
  try {
    const sprays = await fetchJson('https://valorant-api.com/v1/sprays');
    for (const s of sprays || []) {
      if (!s || !s.uuid) continue;
      byUuid[s.uuid.toLowerCase()] = { name: s.displayName, icon: s.fullTransparentIcon || s.displayIcon };
    }
  } catch { /* ignore */ }
  if (Object.keys(byUuid).length) cache.sprays = { at: now, byUuid };
  return cache.sprays.byUuid || byUuid;
}

module.exports = {
  agentAssets,
  getMapAssets,
  getMapAsset,
  getPlayerCardAsset,
  getRankIcons,
  getRankIcon,
  getBuddyDefs,
  getSprayDefs,
};
