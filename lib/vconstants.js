'use strict';

/*
 * Rank labels, map aliases, and session states adapted from Valorant Scout
 * (https://github.com/kryotrades/valorant-scout)
 * Copyright (C) 2026 kryotrades
 * Licensed under the GNU General Public License v3.0. See LICENSE and NOTICE.
 */

const GAMEMODES = {
  competitive: 'Competitive',
  unrated: 'Unrated',
  swiftplay: 'Swiftplay',
  spikerush: 'Spike Rush',
  deathmatch: 'Deathmatch',
  ggteam: 'Escalation',
  hurm: 'Team Deathmatch',
  fortcollins: 'Retake',
  skirmish2v2: 'Skirmish 2v2',
  custom: 'Custom',
  Lobby: 'Lobby',
};

const MAPS = [
  'Ascent', 'Bind', 'Haven', 'Split', 'Lotus', 'Sunset',
  'Abyss', 'Breeze', 'Icebox', 'Fracture', 'Pearl', 'Corrode', 'Summit',
];

const MAP_ALIAS = {
  Triad: 'Haven', Duality: 'Bind', Bonsai: 'Split', Ascent: 'Ascent',
  Port: 'Icebox', Foxtrot: 'Breeze', Canyon: 'Fracture', Pitt: 'Pearl',
  Jam: 'Lotus', Juliett: 'Sunset', Infinity: 'Abyss', Rook: 'Corrode',
  Plummet: 'Summit', HURM_Alley: 'District', HURM_Bowl: 'Kasbah',
  HURM_Helix: 'Drift', HURM_HighTide: 'Glitch', HURM_Yard: 'Piazza',
};

const RANK_GROUPS = [
  ['Unranked', ['', '', ''], '#4A4A4A'],
  ['Iron', ['Iron 1', 'Iron 2', 'Iron 3'], '#5A5751'],
  ['Bronze', ['Bronze 1', 'Bronze 2', 'Bronze 3'], '#BB8F5A'],
  ['Silver', ['Silver 1', 'Silver 2', 'Silver 3'], '#AEB2B2'],
  ['Gold', ['Gold 1', 'Gold 2', 'Gold 3'], '#C5BA3F'],
  ['Platinum', ['Platinum 1', 'Platinum 2', 'Platinum 3'], '#18A7B9'],
  ['Diamond', ['Diamond 1', 'Diamond 2', 'Diamond 3'], '#D864C7'],
  ['Ascendant', ['Ascendant 1', 'Ascendant 2', 'Ascendant 3'], '#189452'],
  ['Immortal', ['Immortal 1', 'Immortal 2', 'Immortal 3'], '#DD4444'],
  ['Radiant', ['Radiant'], '#FFFDCD'],
];

const RANKS = [];
for (const [group, names, color] of RANK_GROUPS) {
  for (const name of names) {
    RANKS.push({ tier: RANKS.length, name: name || 'Unranked', group, color });
  }
}

const STATES = {
  MENUS: 'In Lobby',
  PREGAME: 'Agent Select',
  INGAME: 'In Game',
  OFFLINE: 'Offline',
};

function rankFromTier(tier) {
  let value = Number(tier);
  if (!Number.isFinite(value)) value = 0;
  value = Math.max(0, Math.min(Math.trunc(value), RANKS.length - 1));
  return RANKS[value];
}

function mapNameFromPath(mapId) {
  if (!mapId) return null;
  const leaf = String(mapId).replace(/\/+$/, '').split('/').pop();
  return MAP_ALIAS[leaf] || (MAPS.includes(leaf) ? leaf : leaf || 'Unknown');
}

function modeLabel(queue) {
  if (!queue) return 'Custom';
  return GAMEMODES[String(queue).toLowerCase()] || String(queue).replace(/_/g, ' ');
}

module.exports = { GAMEMODES, STATES, rankFromTier, mapNameFromPath, modeLabel };
