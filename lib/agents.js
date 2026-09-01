'use strict';

/*
 * Agent UUID map adapted from Valorant Scout
 * (https://github.com/kryotrades/valorant-scout)
 * Copyright (C) 2026 kryotrades
 * Licensed under the GNU General Public License v3.0. See LICENSE and NOTICE.
 */

const AGENTS = {
  Jett: ['add6443a-41bd-e414-f6ad-e58d267f4e95', 'Duelist'],
  Phoenix: ['eb93336a-449b-9c1b-0a54-a891f7921d69', 'Duelist'],
  Reyna: ['a3bfb853-43b2-7238-a4f1-ad90e9e46bcc', 'Duelist'],
  Raze: ['f94c3b30-42be-e959-889c-5aa313dba261', 'Duelist'],
  Yoru: ['7f94d92c-4234-0a36-9646-3a87eb8b5c89', 'Duelist'],
  Neon: ['bb2a4828-46eb-8cd1-e765-15848195d751', 'Duelist'],
  Iso: ['0e38b510-41a8-5780-5e8f-568b2a4f2d6c', 'Duelist'],
  Waylay: ['df1cb487-4902-002e-5c17-d28e83e78588', 'Duelist'],
  Sova: ['320b2a48-4d9b-a075-30f1-1f93a9b638fa', 'Initiator'],
  Breach: ['5f8d3a7f-467b-97f3-062c-13acf203c006', 'Initiator'],
  Skye: ['6f2a04ca-43e0-be17-7f36-b3908627744d', 'Initiator'],
  'KAY/O': ['601dbbe7-43ce-be57-2a40-4abd24953621', 'Initiator'],
  Fade: ['dade69b4-4f5a-8528-247b-219e5a1facd6', 'Initiator'],
  Gekko: ['e370fa57-4757-3604-3648-499e1f642d3f', 'Initiator'],
  Tejo: ['b444168c-4e35-8076-db47-ef9bf368f384', 'Initiator'],
  Brimstone: ['9f0d8ba9-4140-b941-57d3-a7ad57c6b417', 'Controller'],
  Omen: ['8e253930-4c05-31dd-1b6c-968525494517', 'Controller'],
  Viper: ['707eab51-4836-f488-046a-cda6bf494859', 'Controller'],
  Astra: ['41fb69c1-4189-7b37-f117-bcaf1e96f1bf', 'Controller'],
  Harbor: ['95b78ed7-4637-86d9-7e41-71ba8c293152', 'Controller'],
  Clove: ['1dbf2edd-4729-0984-3115-daa5eed44993', 'Controller'],
  Miks: ['7c8a4701-4de6-9355-b254-e09bc2a34b72', 'Controller'],
  Sage: ['569fdd95-4d10-43ab-ca70-79becc718b46', 'Sentinel'],
  Cypher: ['117ed9e3-49f3-6512-3ccf-0cada7e3823b', 'Sentinel'],
  Killjoy: ['1e58de9c-4950-5125-93e9-a0aee9f98746', 'Sentinel'],
  Chamber: ['22697a3d-45bf-8dd7-4fec-84a9e28c69d7', 'Sentinel'],
  Deadlock: ['cc8b64c8-4b25-4ff9-6e7f-37b4da43d235', 'Sentinel'],
  Vyse: ['efba5359-4016-a1e5-7626-b1ae76895940', 'Sentinel'],
  Veto: ['92eeef5d-43b5-1d4a-8d03-b3927a09034b', 'Sentinel'],
};

const BY_UUID = {};
for (const [name, [uuid, role]] of Object.entries(AGENTS)) {
  BY_UUID[uuid.toLowerCase()] = { name, uuid, role };
}

function resolveAgent(id) {
  if (!id) return null;
  const key = String(id).trim().toLowerCase();
  if (BY_UUID[key]) return BY_UUID[key];
  const named = Object.entries(AGENTS).find(([name]) => name.toLowerCase() === key);
  if (!named) return null;
  const [name, [uuid, role]] = named;
  return { name, uuid, role };
}

const AGENT_NAMES = Object.keys(AGENTS);

// Rich list for the Agent Picker UI: name, role, and predictable portrait art
// (same authoritative CDN keyed by the UUIDs above — no extra network call).
function agentCatalog() {
  return Object.entries(AGENTS).map(([name, [uuid, role]]) => {
    const art = agentArt(uuid);
    return { name, uuid, role, icon: art && art.icon, portrait: art && art.portrait };
  });
}

// Portrait/icon art is served from a predictable valorant-api.com CDN path
// keyed by the same agent UUIDs above, so this needs no network call.
function agentArt(uuid) {
  if (!uuid) return null;
  const id = String(uuid).toLowerCase();
  const base = `https://media.valorant-api.com/agents/${id}`;
  return { icon: `${base}/displayicon.png`, portrait: `${base}/fullportrait.png`, killfeed: `${base}/killfeedportrait.png` };
}

module.exports = { resolveAgent, AGENT_NAMES, agentCatalog, agentArt };
