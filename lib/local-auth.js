'use strict';

/*
 * Local Riot Client session reader adapted from Valorant Scout
 * (https://github.com/kryotrades/valorant-scout) backend/riot_client.py
 * Copyright (C) 2026 kryotrades
 * Licensed under the GNU General Public License v3.0. See LICENSE and NOTICE.
 *
 * Nightfall uses this only for read-only local session access. Credentials
 * never leave this process.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requestJson, sleep } = require('./http');

const REGION_MAP = {
  na: ['na', ['na-1', 'na']],
  eu: ['eu', ['eu-1', 'eu']],
  ap: ['ap', ['ap-1', 'ap']],
  kr: ['kr', ['kr-1', 'kr']],
  latam: ['na', ['na-1', 'latam']],
  br: ['na', ['na-1', 'br']],
};

const CLIENT_PLATFORM = 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9';

class ClientNotReady extends Error {
  constructor(message) {
    super(message);
    this.name = 'ClientNotReady';
  }
}

function lockfilePath() {
  const root = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(root, 'Riot Games', 'Riot Client', 'Config', 'lockfile');
}

function shooterLogPath() {
  const root = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(root, 'VALORANT', 'Saved', 'Logs', 'ShooterGame.log');
}

function lockfileAvailable() {
  try {
    return fs.existsSync(lockfilePath());
  } catch {
    return false;
  }
}

let holdUntil = { mmr: 0, other: 0 };
let lastCall = 0;

function family(endpoint) {
  return String(endpoint || '').startsWith('/mmr/') ? 'mmr' : 'other';
}

async function throttle(endpoint) {
  const fam = family(endpoint);
  const now = Date.now();
  const held = holdUntil[fam] - now;
  if (held > 0) await sleep(held);
  const gap = fam === 'mmr' ? 250 : 80;
  const wait = gap - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

function setHold(endpoint, seconds) {
  const fam = family(endpoint);
  holdUntil[fam] = Math.max(holdUntil[fam], Date.now() + seconds * 1000);
}

class LocalAuth {
  constructor(region) {
    this.lockfile = this.#readLockfile();
    const pinned = String(region || process.env.RIOT_REGION || '').trim().toLowerCase();
    if (REGION_MAP[pinned]) {
      this.region = REGION_MAP[pinned];
    } else {
      this.region = this.#regionFromLog();
    }
    this.shard = this.region[0];
    this.pdUrl = `https://pd.${this.shard}.a.pvp.net`;
    this.glzUrl = `https://glz-${this.region[1][0]}.${this.region[1][1]}.a.pvp.net`;
    this.puuid = '';
    this.reqCount = 0;
    this._headers = null;
    this._version = null;
  }

  #readLockfile() {
    const file = lockfilePath();
    if (!fs.existsSync(file)) throw new ClientNotReady('Riot Client lockfile not found');
    const raw = fs.readFileSync(file, 'utf8').trim();
    const [name, pid, port, password, protocol] = raw.split(':');
    if (!port || !password) throw new ClientNotReady('Riot Client lockfile is incomplete');
    return { name, pid, port, protocol: protocol || 'https' };
  }

  #localAuthHeader() {
    const password = fs.readFileSync(lockfilePath(), 'utf8').trim().split(':')[3];
    return `Basic ${Buffer.from(`riot:${password}`, 'utf8').toString('base64')}`;
  }

  #regionFromLog() {
    const file = shooterLogPath();
    if (!fs.existsSync(file)) {
      const fallback = String(process.env.RIOT_PLATFORM || 'ap').toLowerCase();
      return REGION_MAP[fallback] || REGION_MAP.ap;
    }
    let pd = null;
    let glz = null;
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line.includes('.a.pvp.net/account-xp/v1/')) {
        pd = line.split('.a.pvp.net/account-xp/v1/')[0].split('.').pop();
      } else if (line.includes('https://glz')) {
        const rest = line.split('https://glz-')[1] || '';
        glz = [rest.split('.')[0], rest.split('.')[1]];
      }
      if (pd) {
        if (pd === 'pbe') return REGION_MAP.na;
        // Use the pd shard even if the glz pattern was not found yet — the
        // game may not have entered a match at this point. A reasonable
        // glz default (region-1.region) keeps glzUrl valid without
        // falling back to the wrong shard for non-AP accounts.
        return [pd, glz || [pd + '-1', pd]];
      }
    }
    return REGION_MAP[String(process.env.RIOT_PLATFORM || 'ap').toLowerCase()] || REGION_MAP.ap;
  }

  async clientVersion() {
    if (this._version) return this._version;
    try {
      const data = await this.localGet('/chat/v4/presences');
      for (const presence of data.presences || []) {
        if (presence.product !== 'valorant' || !presence.private) continue;
        const priv = decodePrivate(presence.private);
        const version = (priv.partyPresenceData || {}).partyClientVersion || priv.partyClientVersion;
        if (version) {
          this._version = version;
          return version;
        }
      }
    } catch { /* try public version next */ }
    try {
      const res = await requestJson('GET', 'https://valorant-api.com/v1/version', { timeout: 6000 });
      const version = (res.json.data || {}).riotClientVersion;
      if (version) {
        this._version = version;
        return version;
      }
    } catch { /* ignore */ }
    this._version = 'release-09.00';
    return this._version;
  }

  async headers(refresh = false) {
    if (this._headers && !refresh) return this._headers;
    const res = await requestJson('GET', `https://127.0.0.1:${this.lockfile.port}/entitlements/v1/token`, {
      headers: { Authorization: this.#localAuthHeader() },
      timeout: 5000,
    });
    const ent = res.json;
    if (!ent || !ent.subject || !ent.accessToken || !ent.token) {
      throw new ClientNotReady(`entitlements not ready (HTTP ${res.status})`);
    }
    this.puuid = ent.subject;
    this._headers = {
      Authorization: `Bearer ${ent.accessToken}`,
      'X-Riot-Entitlements-JWT': ent.token,
      'X-Riot-ClientPlatform': CLIENT_PLATFORM,
      'X-Riot-ClientVersion': await this.clientVersion(),
      'User-Agent': 'ShooterGame/13 Windows/10.0.19043.1.256.64bit',
    };
    return this._headers;
  }

  async localGet(endpoint) {
    const res = await requestJson('GET', `https://127.0.0.1:${this.lockfile.port}${endpoint}`, {
      headers: { Authorization: this.#localAuthHeader() },
      timeout: 5000,
    });
    return res.json;
  }

  async localPost(endpoint, payload) {
    const res = await requestJson('POST', `https://127.0.0.1:${this.lockfile.port}${endpoint}`, {
      headers: { Authorization: this.#localAuthHeader() },
      body: payload,
      timeout: 5000,
    });
    return res.json;
  }

  // Raw variants that surface the HTTP status code and raw text/JSON body.
  // Used only for server-side diagnostics; callers decide what to expose.
  // Never log or return auth headers / tokens.
  async localGetRaw(endpoint) {
    return requestJson('GET', `https://127.0.0.1:${this.lockfile.port}${endpoint}`, {
      headers: { Authorization: this.#localAuthHeader() },
      timeout: 5000,
    });
  }

  async localPostRaw(endpoint, payload) {
    return requestJson('POST', `https://127.0.0.1:${this.lockfile.port}${endpoint}`, {
      headers: { Authorization: this.#localAuthHeader() },
      body: payload,
      timeout: 5000,
    });
  }

  async glzGet(endpoint) {
    await throttle(endpoint);
    this.reqCount += 1;
    const res = await requestJson('GET', this.glzUrl + endpoint, {
      headers: await this.headers(),
      timeout: 8000,
    });
    return parseBody(res);
  }

  async glzPost(endpoint, payload) {
    await throttle(endpoint);
    this.reqCount += 1;
    const res = await requestJson('POST', this.glzUrl + endpoint, {
      headers: await this.headers(),
      body: payload,
      timeout: 8000,
    });
    return parseBody(res);
  }

  async glzDelete(endpoint) {
    await throttle(endpoint);
    this.reqCount += 1;
    const res = await requestJson('DELETE', this.glzUrl + endpoint, {
      headers: await this.headers(),
      timeout: 8000,
    });
    return parseBody(res);
  }

  async pdGet(endpoint, { refresh = false, retries = 0 } = {}) {
    let backoff = 3;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      await throttle(endpoint);
      this.reqCount += 1;
      // On retry attempts, force a token refresh — 401 means the cached
      // token may have expired, and 404 on playerloadout can be transient
      // while Riot syncs client data (see live-match.js currentProfileAssets).
      const res = await requestJson('GET', this.pdUrl + endpoint, {
        headers: await this.headers(refresh || attempt > 0),
        timeout: 8000,
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers['retry-after']) || backoff;
        setHold(endpoint, retryAfter);
        if (attempt < retries) {
          backoff += 3;
          continue;
        }
        return { errorCode: 'RATE_LIMITED', status: 429 };
      }
      // Retry on transient failures: 401 (token expired), 404 (temporary
      // on playerloadout endpoint), and 5xx (Riot server errors).
      if (
        (res.status === 401 || res.status === 404 || (res.status >= 500 && res.status < 600)) &&
        attempt < retries
      ) {
        backoff += 3;
        await sleep(backoff);
        continue;
      }
      return parseBody(res);
    }
    return { errorCode: 'RATE_LIMITED', status: 429 };
  }

  async pdPut(endpoint, payload, { refresh = false } = {}) {
    await throttle(endpoint);
    this.reqCount += 1;
    let res = await requestJson('PUT', this.pdUrl + endpoint, {
      headers: await this.headers(refresh),
      body: payload,
      timeout: 8000,
    });
    // Retry once on 401 — the cached token may have expired between
    // the initial headers() call and the PUT (e.g. long-running session).
    if (res.status === 401) {
      try {
        await this.headers(true);
        res = await requestJson('PUT', this.pdUrl + endpoint, {
          headers: await this.headers(true),
          body: payload,
          timeout: 8000,
        });
      } catch {}
    }
    return parseBody(res);
  }

  async pdPost(endpoint, payload, { refresh = false } = {}) {
    await throttle(endpoint);
    this.reqCount += 1;
    const res = await requestJson('POST', this.pdUrl + endpoint, {
      headers: await this.headers(refresh),
      body: payload,
      timeout: 8000,
    });
    return parseBody(res);
  }
}

function parseBody(res) {
  if (res.status === 429) return { errorCode: 'RATE_LIMITED', status: 429 };
  return res.json && typeof res.json === 'object' ? res.json : {};
}

function decodePrivate(value) {
  if (!value || String(value).includes('{')) return { isValid: false };
  try {
    const decoded = JSON.parse(Buffer.from(String(value), 'base64').toString('utf8'));
    return decoded && typeof decoded === 'object' ? decoded : { isValid: false };
  } catch {
    return { isValid: false };
  }
}

async function chatPresences(auth) {
  const data = await auth.localGet('/chat/v4/presences');
  return ((data || {}).presences || []).filter((row) => row && typeof row === 'object');
}

module.exports = {
  ClientNotReady,
  LocalAuth,
  lockfileAvailable,
  lockfilePath,
  decodePrivate,
  chatPresences,
};
