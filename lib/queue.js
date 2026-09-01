'use strict';

const { LocalAuth, lockfileAvailable } = require('./local-auth');

async function party(auth) {
  const player = await auth.glzGet(`/parties/v1/players/${auth.puuid}`);
  if (!player || !player.CurrentPartyID) throw new Error('No active party found.');
  return auth.glzGet(`/parties/v1/parties/${player.CurrentPartyID}`);
}

function safeError(body, fallback) {
  if (!body || typeof body !== 'object') return fallback;
  return body.message || body.errorCode || fallback;
}

async function queueMode(queueId) {
  if (!lockfileAvailable()) return { ok: false, error: 'RIOT_CLIENT_UNAVAILABLE', message: 'Riot Client unavailable.' };
  const id = String(queueId || '').trim().toLowerCase();
  if (!id) return { ok: false, error: 'INVALID_QUEUE_ID', message: 'A queue mode is required.' };
  try {
    const auth = new LocalAuth();
    await auth.headers();
    const current = await party(auth);
    const allowed = Array.isArray(current.EligibleQueues) ? current.EligibleQueues.map(String) : [];
    if (allowed.length && !allowed.includes(id)) {
      return { ok: false, error: 'QUEUE_NOT_ELIGIBLE', message: `Riot Client does not allow ${id} for this party.`, eligibleQueues: allowed };
    }
    const result = await auth.glzPost(`/parties/v1/parties/${current.ID}/queue`, { queueId: id });
    if (result && result.errorCode) return { ok: false, error: result.errorCode, message: safeError(result, 'Queue selection failed.') };
    return { ok: true, queueId: id, message: 'Queue mode selected.' };
  } catch (error) {
    return { ok: false, error: 'RIOT_QUEUE_ERROR', message: safeError(error, 'Queue selection failed.') };
  }
}

async function queueStart(queueId) {
  if (!lockfileAvailable()) return { ok: false, error: 'RIOT_CLIENT_UNAVAILABLE', message: 'Riot Client unavailable.' };
  const selected = await queueMode(queueId);
  if (!selected.ok) return selected;
  try {
    const auth = new LocalAuth();
    await auth.headers();
    const current = await party(auth);
    const result = await auth.glzPost(`/parties/v1/parties/${current.ID}/matchmaking/join`);
    if (result && result.errorCode) return { ok: false, error: result.errorCode, message: safeError(result, 'Could not start matchmaking.') };
    return { ok: true, queueId: selected.queueId, message: 'Matchmaking requested.' };
  } catch (error) {
    return { ok: false, error: 'RIOT_MATCHMAKING_ERROR', message: safeError(error, 'Could not start matchmaking.') };
  }
}

async function queueCancel() {
  if (!lockfileAvailable()) return { ok: false, error: 'RIOT_CLIENT_UNAVAILABLE', message: 'Riot Client unavailable.' };
  try {
    const auth = new LocalAuth();
    await auth.headers();
    const current = await party(auth);
    const result = await auth.glzPost(`/parties/v1/parties/${current.ID}/matchmaking/leave`);
    if (result && result.errorCode) return { ok: false, error: result.errorCode, message: safeError(result, 'Could not cancel matchmaking.') };
    return { ok: true, message: 'Matchmaking cancelled.' };
  } catch (error) {
    return { ok: false, error: 'RIOT_QUEUE_CANCEL_ERROR', message: safeError(error, 'Could not cancel matchmaking.') };
  }
}

async function queueStatus() {
  if (!lockfileAvailable()) return { available: false, searching: false, message: 'Riot Client unavailable.' };
  try {
    const auth = new LocalAuth();
    await auth.headers();
    const current = await party(auth);
    const state = String(current.State || '').toUpperCase();
    const entry = String(current.QueueEntryTime || '');
    const searching = ['MATCHMAKING', 'QUEUEING', 'MATCH_FOUND'].includes(state) ||
      Boolean(entry && !entry.startsWith('0001-01-01') && state !== 'DEFAULT');
    return {
      available: true,
      searching,
      queueId: current.MatchmakingData && current.MatchmakingData.QueueID || null,
      state: current.State || null,
      queueEntryTime: current.QueueEntryTime || null,
    };
  } catch (error) {
    return { available: false, searching: false, message: error.message || 'Could not read queue state.' };
  }
}

module.exports = { queueMode, queueStart, queueCancel, queueStatus };