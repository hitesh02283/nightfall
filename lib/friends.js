'use strict';

/*
 * Nightfall friends + chat.
 *
 * Reads the real friend list and chat/messaging state from the local Riot
 * Client through the existing LocalAuth session (lib/local-auth.js). No
 * credentials, tokens, entitlements, or lockfile secrets ever leave this
 * process — the browser only receives sanitized JSON.
 */

const { LocalAuth, lockfileAvailable, chatPresences, decodePrivate } = require('./local-auth');
const { GAMEMODES } = require('./vconstants');

const STATE_LABELS = {
  MENUS: 'In Lobby',
  PREGAME: 'Agent Select',
  INGAME: 'In Game',
  MATCHMAKING: 'Matchmaking',
  AWAY: 'Away',
  ONLINE: 'Online',
};

// First defined non-null value.
function pick() {
  for (let i = 0; i < arguments.length; i += 1) {
    const v = arguments[i];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

// Human-friendly one-line status, e.g. "In Lobby · Competitive" or "Online".
function statusLine(online, state, queue) {
  if (!online) return null;
  const label = STATE_LABELS[state] || 'Online';
  const q = queue ? ` · ${queue}` : '';
  return `${label}${q}`;
}

// Map sessionLoopState -> a clean UI label. Unknown states fall back to "Online".
function presenceState(privPayload) {
  const mp = privPayload.matchPresenceData || {};
  const loop = pick(
    mp.sessionLoopState, privPayload.sessionLoopState, privPayload.partyOwnerSessionLoopState,
  );
  const inGame = privPayload.isInGame === true || mp.sessionLoopState === 'INGAME';
  const away = privPayload.isAway === true || privPayload.isIdle === true;
  const loading = privPayload.isLoading === true || mp.provisioningFlow === 'Matchmaking';
  if (away) return 'AWAY';
  if (inGame || loop === 'INGAME') return 'INGAME';
  if (loop === 'PREGAME' || mp.sessionLoopState === 'PREGAME') return 'PREGAME';
  if (loop === 'MENUS' || mp.sessionLoopState === 'MENUS') return 'MENUS';
  // Matchmaking / loading state.
  if (loading) return 'MATCHMAKING';
  // Presence present but no VALORANT state — treat as simply online.
  return 'ONLINE';
}

function presenceQueue(privPayload) {
  const mp = privPayload.matchPresenceData || {};
  const q = pick(mp.queueId, mp.queue, privPayload.queueId, privPayload.queueID, privPayload.queue);
  if (!q) return null;
  const key = String(q).toLowerCase();
  return GAMEMODES[key] || String(q).replace(/_/g, ' ');
}

/*
 * ─── Presence relevance + priority ───────────────────────────────────────
 *
 * Riot returns MULTIPLE presence entries per friend — one per product
 * (valorant, riot_client, league_of_legends). The Riot Mobile client advertises
 * a `league_of_legends` presence with `state: "mobile"` and *no* desktop
 * platform. Only the entry with product === "valorant" and
 * activePlatform === "windows" represents a real desktop VALORANT session.
 */
function isRelevantDesktopValorantPresence(presence) {
  return Boolean(
    presence &&
    presence.product === 'valorant' &&
    presence.activePlatform === 'windows'
  );
}

// Lower = shown first. Offline is always after online.
const STATE_RANK = { INGAME: 0, PREGAME: 1, MENUS: 2, MATCHMAKING: 3, ONLINE: 4, AWAY: 5 };
function presenceRank(state) {
  return STATE_RANK[state] !== undefined ? STATE_RANK[state] : 4;
}

// Normalize the local /chat/v4/friends payload and merge real presence state.
async function friendsList() {
  if (!lockfileAvailable()) {
    return { source: 'none', message: 'Riot Client unavailable', friends: [] };
  }
  try {
    const auth = new LocalAuth();
    await auth.headers();

    const data = await auth.localGet('/chat/v4/friends');
    const raw = Array.isArray(data && data.friends) ? data.friends : [];

    // Online status comes from presences, not the friends payload alone.
    let presences = [];
    try { presences = await chatPresences(auth); } catch { /* offline fallback */ }

    // Aggregate multiple presence entries per puuid (one per Riot product),
    // keeping the entry that best represents a desktop VALORANT session.
    const PRODUCT_PRIORITY = { valorant: 0, riot_client: 1, league_of_legends: 2 };
    function productPriority(prod) {
      return PRODUCT_PRIORITY[prod] !== undefined ? PRODUCT_PRIORITY[prod] : 9;
    }
    const presenceByPuuid = {};
    for (const p of presences) {
      if (!p || !p.puuid) continue;
      const entry = {
        product: p.product || '',
        activePlatform: p.activePlatform || null,
        state: p.state || null,
      };
      const priv = decodePrivate(p.private);
      entry.priv = (priv && priv.isValid !== false && typeof priv === 'object') ? priv : {};
      const current = presenceByPuuid[p.puuid];
      if (!current) {
        presenceByPuuid[p.puuid] = entry;
      } else {
        const currentWorth = isRelevantDesktopValorantPresence(current)
          ? 0
          : 1 + productPriority(current.product);
        const entryWorth = isRelevantDesktopValorantPresence(entry)
          ? 0
          : 1 + productPriority(entry.product);
        if (entryWorth < currentWorth) presenceByPuuid[p.puuid] = entry;
      }
    }

    const friends = raw
      .map((f) => {
        const puuid = f.puuid || '';
        const name = f.game_name || '';
        const tag = f.game_tag || '';
        const presence = presenceByPuuid[puuid];
        // Only a desktop VALORANT/game-client session counts as online.
        const online = isRelevantDesktopValorantPresence(presence);
        let state = online ? presenceState(presence.priv) : null;
        let queue = online ? presenceQueue(presence.priv) : null;
        return {
          id: puuid,
          puuid,
          pid: f.pid != null ? String(f.pid) : null,
          name: name || null,
          tag: tag || null,
          riotId: name && tag ? `${name}#${tag}` : (name || null),
          note: f.note || null,
          online,
          state,
          queue,
          statusText: statusLine(online, state, queue),
          lastOnline: f.last_online_ts != null ? f.last_online_ts : null,
          platform: f.activePlatform || null,
          group: f.displayGroup || f.group || null,
        };
      })
      .filter((f) => f.name || f.id || f.puuid);

    // Online friends first (ranked by useful VALORANT state),
    // then inactive/offline friends.
    friends.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.online) return presenceRank(a.state) - presenceRank(b.state);
      return 0;
    });

    return { source: 'riot-client', friends };
  } catch (error) {
    // Technical error only — never credentials.
    console.error('[friends]', error && error.message);
    return { source: 'local', error: true, message: 'Failed to load friends', friends: [] };
  }
}

/*
 * ─── CID Resolution ─────────────────────────────────────────────────────
 *
 * The Riot local chat API identifies direct-message conversations by CID.
 * The conversation endpoint /chat/v6/conversations/ returns objects with the
 * shape { cid, type, direct_messages, mid, ... } — critically there is NO
 * `participants` array and `direct_messages` is a boolean, NOT an array.
 *
 * Empirically (verified against the running Riot Client) the direct-message
 * cid is built exactly like the friend's pid:
 *
 *     <puuid>@<region>.pvp.net
 *
 * i.e. for a direct message conversation, cid === friend.pid. We therefore:
 *   1. locate the friend's puuid from /chat/v4/friends
 *   2. check /chat/v6/conversations/ for a matching cid by puuid/pid
 *   3. fall back to the friend's pid (identical DM cid format) so the very
 *      first message still works
 *
 * We return a diagnostics object (sanitised — no auth/secrets) so the caller
 * and server logs can see exactly how the cid was obtained.
 */
async function resolveCid(pid, auth) {
  const target = String(pid || '').trim();
  const info = {
    pid: target,
    puuid: null,
    gameName: null,
    gameTag: null,
    conversationCount: 0,
    matchedCid: null,
    cidSource: 'constructed', // 'existing' if found in conversations
    cid: target || null,
  };
  if (!target) return info;

  // Correlate pid -> friend record (puuid, game_name, game_tag).
  try {
    const friendsData = await auth.localGet('/chat/v4/friends');
    const friend = (Array.isArray(friendsData && friendsData.friends) ? friendsData.friends : [])
      .find((f) => String(f.pid) === target);
    if (friend) {
      info.puuid = friend.puuid || null;
      info.gameName = friend.game_name || null;
      info.gameTag = friend.game_tag || null;
    }
  } catch { /* non-fatal: cid can still be constructed from pid */ }

  // Look for an existing direct conversation matching this friend.
  try {
    const convData = await auth.localGet('/chat/v6/conversations/');
    const conversations = Array.isArray(convData && convData.conversations) ? convData.conversations : [];
    info.conversationCount = conversations.length;
    for (const conv of conversations) {
      const convCid = conv && conv.cid ? String(conv.cid) : null;
      if (!convCid) continue;
      const cidUuid = convCid.split('@')[0];
      const pidMatch = convCid === target;
      const puuidMatch = info.puuid && cidUuid === info.puuid;
      if (pidMatch || puuidMatch) {
        info.matchedCid = convCid;
        info.cidSource = 'existing';
        break;
      }
    }
  } catch { /* fall back to constructed cid below */ }

  // For a DM the cid format equals the pid format: <puuid>@<region>.pvp.net.
  info.cid = info.matchedCid || target;
  return info;
}

/*
 * ─── Chat History ───────────────────────────────────────────────────────
 *
 * Resolve CID → GET /chat/v6/messages?cid=<cid>
 * Returns the real messages — nothing fabricated.
 */
async function friendMessages(pid) {
  const target = String(pid || '').trim();
  if (!target) return { source: 'none', historyAvailable: false, messages: [] };
  if (!lockfileAvailable()) {
    return { source: 'none', historyAvailable: false, messages: [] };
  }
  try {
    const auth = new LocalAuth();
    await auth.headers();

    // Resolve the conversation CID (matches conversation lookup, or falls back
    // to the friend's pid which IS the DM cid format).
    const info = await resolveCid(target, auth);
    if (!info.cid) {
      return { source: 'riot-client', historyAvailable: false, messages: [] };
    }

    // Fetch history using the real CID. Use the raw call so we can tell the
    // difference between "0 messages" and a failed request.
    const res = await auth.localGetRaw(`/chat/v6/messages?cid=${encodeURIComponent(info.cid)}`);
    const status = res && res.status;
    const body = (res && typeof res.json === 'object') ? res.json : {};

    // A 404 with code RPC_ERROR / message "not_found" means the direct-message
    // conversation does not exist yet (no messages ever exchanged). That is a
    // normal, empty first-message conversation — NOT a messaging failure.
    const notFound404 = status === 404 && (
      body.errorCode === 'RPC_ERROR' ||
      String(body.message || '').toLowerCase().indexOf('not_found') >= 0
    );

    if (notFound404) {
      console.log('[friends history] CHAT DEBUG status=' + status +
        ' code=' + (body.errorCode || '') + ' pid=' + info.pid +
        ' puuid=' + info.puuid + ' cidSource=' + info.cidSource +
        ' emptyConversation=true');
      return {
        source: 'riot-client',
        historyAvailable: true,
        emptyConversation: true,
        messages: [],
      };
    }

    if (!res || status < 200 || status >= 300) {
      console.log('[friends history] CHAT DEBUG status=' + status +
        ' code=' + (body.errorCode || '') + ' message=' + String(body.message || '').slice(0, 80) +
        ' pid=' + info.pid + ' puuid=' + info.puuid + ' cidSource=' + info.cidSource);
      return {
        source: 'riot-client',
        historyAvailable: false,
        historyError: true,
        status,
        messages: [],
      };
    }

    const items = Array.isArray(body.messages) ? body.messages : [];
    const messages = items
      .map((m) => ({
        body: m.body != null ? String(m.body) : null,
        game_name: m.game_name || null,
        game_tag: m.game_tag || null,
        pid: m.pid != null ? String(m.pid) : null,
        puuid: m.puuid || null,
        timestamp: m.time != null ? m.time : (m.timestamp != null ? m.timestamp : null),
        type: m.type || null,
        cid: m.cid || null,
        isSelf: Boolean(auth.puuid && m.puuid === auth.puuid),
      }))
      .filter((m) => m.body != null);

    console.log('[friends history] CHAT DEBUG status=' + status +
      ' pid=' + info.pid + ' puuid=' + info.puuid + ' cidSource=' + info.cidSource +
      ' messageCount=' + messages.length);

    return { source: 'riot-client', historyAvailable: true, messages };
  } catch (error) {
    console.error('[friends history]', error && error.message);
    return { source: 'local', historyAvailable: false, historyError: true, messages: [] };
  }
}

// Send a direct message to a friend through the local Riot Client chat session.
async function sendFriendMessage(pid, message) {
  const target = String(pid || '').trim();
  const text = String(message || '').trim();
  if (!target || !text) return { ok: false, message: 'Missing recipient or message.' };
  if (!lockfileAvailable()) return { ok: false, message: 'Riot Client unavailable.' };

  try {
    const auth = new LocalAuth();
    await auth.headers();

    // Resolve the conversation CID.
    const info = await resolveCid(target, auth);
    if (!info.cid) {
      return { ok: false, message: 'Could not resolve conversation for this friend.' };
    }

    console.log('[friends send] CHAT DEBUG pid=' + info.pid + ' puuid=' + info.puuid +
      ' matchedCid=' + info.matchedCid + ' cidSource=' + info.cidSource +
      ' cid=' + info.cid);

    // POST /chat/v6/messages { cid, message, type: "chat" }.
    const res = await auth.localPostRaw('/chat/v6/messages', {
      cid: info.cid,
      message: text,
      type: 'chat',
    });
    const status = res && res.status;
    const body = (res && typeof res.json === 'object') ? res.json : {};

    console.log('[friends send] CHAT DEBUG endpoint=/chat/v6/messages status=' + status +
      ' code=' + (body.errorCode || '') + ' message=' + String(body.message || '').slice(0, 80));

    if (status >= 200 && status < 300) {
      // Success — return only sanitised response data (no auth headers).
      return { ok: true, message: body };
    }

    // Failure — return a sanitised, useful error object for the browser,
    // never auth headers or tokens.
    const code = body.errorCode || ('HTTP_' + status);
    const detail = body.errorMessage || body.message || '';
    const safeMessage = detail
      ? 'Riot chat returned ' + status + ': ' + detail
      : 'Riot chat returned ' + status + ' (' + code + ')';
    return { ok: false, error: 'RIOT_CHAT_ERROR', status, code, message: safeMessage };
  } catch (error) {
    console.error('[friends send]', error && error.message);
    return { ok: false, message: 'Could not send message' };
  }
}

module.exports = { friendsList, friendMessages, sendFriendMessage };