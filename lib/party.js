'use strict';

/*
 * Nightfall party invite.
 *
 * Lets the person invite another player to their current VALORANT party by
 * Riot ID (Name#Tag). This is intentionally kept separate from
 * lib/match-controls.js:
 *  - It doesn't touch Agent Select, doesn't run automatically, and isn't
 *    gated behind the "enable game-client controls" switch — it's the same
 *    action as typing a name into the in-game party panel.
 *  - The only write it ever performs is POSTing a party invite, and that
 *    only happens when the person submits the form.
 *
 * Uses the same local Riot Client session (lib/local-auth.js) as the rest of
 * Nightfall. Credentials never leave this process.
 */

const { LocalAuth, lockfileAvailable } = require('./local-auth');

function parseRiotId(raw) {
  const value = String(raw || '').trim();
  const hashIdx = value.lastIndexOf('#');
  if (hashIdx < 1 || hashIdx >= value.length - 1) return null;
  const gameName = value.slice(0, hashIdx).trim();
  const tagLine = value.slice(hashIdx + 1).trim();
  if (!gameName || !tagLine) return null;
  return { gameName, tagLine };
}

const ERROR_MESSAGES = {
  PLAYER_DOES_NOT_EXIST: "Couldn't find that Riot ID.",
  PARTY_FULL: 'Your party is full.',
  PLAYER_ALREADY_IN_PARTY: 'That player is already in a party.',
  PLAYER_ALREADY_INVITED: "You've already invited that player.",
  PLAYER_CANNOT_INVITE_YOURSELF: "You can't invite yourself.",
  INVALID_INVITE_CODE: 'Invalid or expired party code.',
  PARTY_NOT_FOUND: 'Invalid or expired party code.',
};

function humanizeError(code) {
  return ERROR_MESSAGES[code] || `Invite failed (${code}).`;
}

async function currentPartyId(auth) {
  const player = await auth.glzGet(`/parties/v1/players/${auth.puuid}`);
  return player && player.CurrentPartyID;
}

async function partyStatus() {
  if (!lockfileAvailable()) {
    return { available: false, message: "Couldn't reach the local client — is VALORANT open?" };
  }
  try {
    const auth = new LocalAuth();
    await auth.headers();
    const partyId = await currentPartyId(auth);
    if (!partyId) return { available: false, message: 'No active party found.' };
    let size = null;
    try {
      const party = await auth.glzGet(`/parties/v1/parties/${partyId}`);
      size = Array.isArray(party && party.Members) ? party.Members.length : null;
    } catch { /* member count is a nice-to-have, not required */ }
    return { available: true, partyId, size };
  } catch (error) {
    return { available: false, message: `Couldn't reach the local client: ${error && error.message}` };
  }
}

async function partyInvite(payload) {
  const parsed = parseRiotId(payload && payload.riotId);
  if (!parsed) return { ok: false, message: 'Invalid Riot ID format. Use Name#Tag.' };
  if (!lockfileAvailable()) {
    return { ok: false, message: "Couldn't reach the local client — is VALORANT open?" };
  }
  try {
    const auth = new LocalAuth();
    await auth.headers();
    const partyId = await currentPartyId(auth);
    if (!partyId) return { ok: false, message: "You're not in a party — open the Play menu first." };
    const res = await auth.glzPost(
      `/parties/v1/parties/${partyId}/invites/name/${encodeURIComponent(parsed.gameName)}/tag/${encodeURIComponent(parsed.tagLine)}`,
    );
    if (res && res.errorCode) {
      return { ok: false, message: humanizeError(res.errorCode) };
    }
    return { ok: true, message: `Invite sent to ${parsed.gameName}#${parsed.tagLine}.` };
  } catch (error) {
    return { ok: false, message: `Invite failed: ${error && error.message}` };
  }
}

function parseCode(raw) {
  const value = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9]{4,8}$/.test(value)) return null;
  return value;
}

async function generateCode() {
  if (!lockfileAvailable()) {
    return { ok: false, message: "Couldn't reach the local client — is VALORANT open?" };
  }
  try {
    const auth = new LocalAuth();
    await auth.headers();
    const partyId = await currentPartyId(auth);
    if (!partyId) return { ok: false, message: "You're not in a party — open the Play menu first." };
    const res = await auth.glzPost(`/parties/v1/parties/${partyId}/invitecode`);
    const code = res && res.InviteCode;
    if (!code) return { ok: false, message: 'Could not generate a party code.' };
    return { ok: true, code, message: `Party code: ${code}` };
  } catch (error) {
    return { ok: false, message: `Could not generate a code: ${error && error.message}` };
  }
}

async function disableCode() {
  if (!lockfileAvailable()) {
    return { ok: false, message: "Couldn't reach the local client — is VALORANT open?" };
  }
  try {
    const auth = new LocalAuth();
    await auth.headers();
    const partyId = await currentPartyId(auth);
    if (!partyId) return { ok: false, message: "You're not in a party." };
    await auth.glzDelete(`/parties/v1/parties/${partyId}/invitecode`);
    return { ok: true, message: 'Party code turned off.' };
  } catch (error) {
    return { ok: false, message: `Could not turn off the code: ${error && error.message}` };
  }
}

async function joinByCode(payload) {
  const code = parseCode(payload && payload.code);
  if (!code) return { ok: false, message: 'Enter a valid party code.' };
  if (!lockfileAvailable()) {
    return { ok: false, message: "Couldn't reach the local client — is VALORANT open?" };
  }
  try {
    const auth = new LocalAuth();
    await auth.headers();
    const res = await auth.glzPost(`/parties/v1/players/joinbycode/${encodeURIComponent(code)}`);
    if (res && res.errorCode) {
      return { ok: false, message: humanizeError(res.errorCode) };
    }
    if (!res || !res.CurrentPartyID) {
      return { ok: false, message: 'Could not join that party — check the code.' };
    }
    return { ok: true, partyId: res.CurrentPartyID, message: 'Joined the party.' };
  } catch (error) {
    return { ok: false, message: `Join failed: ${error && error.message}` };
  }
}

module.exports = { partyStatus, partyInvite, generateCode, disableCode, joinByCode };
