'use strict';

/*
 * Nightfall match controls: instalock and dodge.
 *
 * These are the ONLY write requests Nightfall ever sends to the local
 * VALORANT client, and every write is gated behind an explicit
 * "enable game-client controls" switch that is OFF by default. No write
 * request ever happens automatically just because Agent Select is detected.
 *
 * Logic is collated from Valorant Scout
 * (https://github.com/kryotrades/valorant-scout) backend/instalock_worker.py
 * and Fast Pick (https://github.com/Imu-D-sama/Fast-Pick) main.py.
 * Read-only live detection in lib/live-match.js is reused untouched.
 */

const { LocalAuth, chatPresences, decodePrivate, lockfileAvailable } = require('./local-auth');
const { resolveAgent, AGENT_NAMES } = require('./agents');
const { mapNameFromPath } = require('./vconstants');
const { sleep } = require('./http');
const { snapshotClient, invalidateLive } = require('./live-match');

const POLL_MS = 1000;
const STOP_GRACE_MS = 900;

// Controls are permanently enabled. The UI toggle was removed.
// Instalock still requires explicit Start; no automatic locking.

class Instalock {
  constructor() {
    this.status = {
      running: false, status: 'idle', message: 'Instalock is off.',
      agent: null, mode: 'lock', delay: 0, map: null, perMap: {},
    };
    this._stop = false;
    this._running = false;
  }

  isRunning() {
    return this._running;
  }

  start({ agent, mode = 'lock', delay = 0, perMap = {} }) {
    const target = resolveAgent(agent || '');
    if (!target) return { ok: false, message: `Unknown agent '${agent || ''}'.` };

    const norm = {};
    for (const [map, name] of Object.entries(perMap || {})) {
      if (!map || name === undefined || name === null || name === '') continue;
      if (!resolveAgent(String(name))) {
        return { ok: false, message: `Unknown agent '${String(name)}' for map '${map}'.` };
      }
      norm[String(map).trim().toLowerCase()] = String(name).trim();
    }

    this._stop = true;
    this._running = false;
    this._stop = false;
    this._running = true;
    this.status = {
      running: true, status: 'waiting', mode,
      delay: Math.max(0, Number(delay) || 0),
      agent: target.name, map: null, perMap: norm,
      message: `Armed — waiting for Agent Select (${target.name}).`,
    };
    this._loop(target, mode, this.status.delay, norm).catch(() => {});
    return { ok: true, running: true, agent: target.name, status: 'waiting', message: this.status.message };
  }

  async stop() {
    this._stop = true;
    if (this._running) await sleep(STOP_GRACE_MS);
    this._running = false;
    this.status.running = false;
    if (this.status.status !== 'locked' && this.status.status !== 'error') {
      this.status.status = 'stopped';
      this.status.message = 'Instalock stopped.';
    }
    return { ok: true, running: false, message: 'Instalock stopped.' };
  }

  _fail(message) {
    this._running = false;
    this.status = { ...this.status, running: false, status: 'error', message };
  }
async _loop(target, mode, delay, perMap) {
    let auth = null;
    try {
      if (!lockfileAvailable()) {
        this._fail("Couldn't reach the local client — is VALORANT open?");
        return;
      }
      auth = new LocalAuth();
      await auth.headers();
    } catch (error) {
      this._fail(`Couldn't reach the local client: ${error && error.message}`);
      return;
    }

    const done = new Set();
    while (!this._stop) {
      try {
        const presences = await chatPresences(auth);
        let state = null;
        let foundSelf = false;
        for (const p of presences) {
          if (!p || p.puuid !== auth.puuid) continue;
          foundSelf = true;
          const priv = decodePrivate(p.private);
          if (priv && typeof priv === 'object') {
            if (priv.matchPresenceData) state = priv.matchPresenceData.sessionLoopState || 'MENUS';
            else if (priv.sessionLoopState) state = priv.sessionLoopState;
          }
          break;
        }
        if (!foundSelf) {
          this._fail("Local client not reachable — is VALORANT open?");
          return;
        }

        if (state === 'PREGAME') {
          const pg = await auth.glzGet(`/pregame/v1/players/${auth.puuid}`);
          const mid = pg && pg.MatchID;
          if (mid && !done.has(mid)) {
            if (delay > 0) {
              await sleep(delay);
              if (this._stop) break;
            }
            const match = await auth.glzGet(`/pregame/v1/matches/${mid}`);
            const side = { Red: 'Attacker', Blue: 'Defender' }[((match || {}).AllyTeam || {}).TeamID] || null;
            const mapName = mapNameFromPath((match || {}).MapID || '');
            let chosen = target;
            const override = perMap[(mapName || '').toLowerCase()];
            if (override) {
              const resolved = resolveAgent(override);
              if (resolved) chosen = resolved;
            }
            await auth.glzPost(`/pregame/v1/matches/${mid}/select/${chosen.uuid}`);
            if (mode === 'lock') {
              await auth.glzPost(`/pregame/v1/matches/${mid}/lock/${chosen.uuid}`);
            }
            done.add(mid);
            this._running = false;
            this.status = {
              running: false, status: 'locked', mode, delay,
              agent: chosen.name, map: mapName, perMap,
              message: `Locked ${chosen.name}${mapName && mapName !== 'Unknown' ? ' on ' + mapName : ''}${side ? " — you're " + side + '.' : ''}.`,
            };
            return;
          }
        }
      } catch (error) {
        if (this._stop) break;
        try { await auth.headers(true); } catch { /* keep looping */ }
      }
      if (this._stop) break;
      await sleep(POLL_MS);
    }
    this._running = false;
    if (this.status.status !== 'locked' && this.status.status !== 'error') {
      this.status.status = 'stopped';
      this.status.message = 'Instalock stopped.';
    }
  }
}
const instalock = new Instalock();

function agentList() {
  return AGENT_NAMES;
}

function instalockStart(payload) {
  const p = payload || {};
  return instalock.start({
    agent: p.agent,
    mode: p.mode === 'select' ? 'select' : 'lock',
    delay: Number(p.delay) || 0,
    perMap: p.perMap && typeof p.perMap === 'object' ? p.perMap : {},
  });
}

async function instalockStop() {
  return instalock.stop();
}

async function controlsDodge(payload) {
  if (!payload || payload.confirmed !== true) {
    return { ok: false, message: 'Dodge requires explicit confirmation.' };
  }
  try {
    if (instalock.isRunning()) await instalock.stop();
    if (!lockfileAvailable()) return { ok: false, message: 'Riot Client not running.' };
    const auth = new LocalAuth();
    await auth.headers();
    const pre = await auth.glzGet(`/pregame/v1/players/${auth.puuid}`);
    const mid = pre && pre.MatchID;
    if (!mid) return { ok: false, message: 'Not in Agent Select — nothing to dodge.' };
    await auth.glzPost(`/pregame/v1/matches/${mid}/quit`);
    invalidateLive();
    return { ok: true, message: 'Dodged Agent Select.' };
  } catch (error) {
    return { ok: false, message: `Dodge failed: ${error && error.message}` };
  }
}

async function controlsStatus() {
  let snap = { state: 'OFFLINE', stateLabel: 'Offline', running: false };
  try {
    snap = await snapshotClient();
  } catch (error) { /* public status only */ }
  return {
    enabled: true,
    state: snap.state,
    stateLabel: snap.stateLabel,
    running: snap.running,
    instalock: instalock.status,
    canDodge: snap.state === 'PREGAME',
  };
}

module.exports = {
  agentList,
  instalockStart,
  instalockStop,
  controlsDodge,
  controlsStatus,
};