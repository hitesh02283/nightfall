'use strict';

/*
 * Nightfall daily shop / storefront.
 *
 * Reads the player's real VALORANT storefront through the existing LocalAuth
 * session (lib/local-auth.js) using the shard already computed from the local
 * client. Raw item IDs are resolved against the public valorant-api.com
 * reference data (names / icons / bundles). Nothing authenticated is ever sent
 * to valorant-api.com or to the browser — only sanitized item data leaves here.
 */

const { LocalAuth, lockfileAvailable } = require('./local-auth');

const VP_CURRENCY_ID = '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741';
// Some older clients reported the VP id as ...3a1f; accept both so prices
// resolve regardless of which currency key the live response uses.
const VP_CURRENCY_IDS = [VP_CURRENCY_ID, '85ad13f7-3d1b-5128-9eb2-7cd8ee0b3a1f'];
const TTL_MS = 3 * 60 * 1000; // refresh the storefront at most every 3 minutes

let storeCache = { at: 0, value: null };

let skinDefsPromise = null;
let bundleDefsPromise = null;
let weaponDefsPromise = null;

async function fetchData(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`valorant-api.com returned ${r.status}`);
  const body = await r.json();
  return (body && body.data) || [];
}

// skin UUID / level UUID / chroma UUID -> { name, icon, weaponUuid, weaponName }
const WEAPON_NAMES = [
  'Classic', 'Shorty', 'Frenzy', 'Ghost', 'Sheriff',
  'Spectre', 'Stinger', 'Bulldog', 'Guardian', 'Phantom',
  'Vandal', 'Marshal', 'Outlaw', 'Operator', 'Bucky',
  'Judge', 'Ares', 'Odin', 'Melee',
];
function weaponFromName(name) {
  const n = String(name || '');
  const lower = n.toLowerCase();
  for (const w of WEAPON_NAMES) {
    if (lower.endsWith(' ' + w.toLowerCase())) return w;
  }
  return null;
}
async function skinDefs() {
  if (skinDefsPromise) return skinDefsPromise;
  skinDefsPromise = (async () => {
    const out = {};
    try {
      const skins = await fetchData('https://valorant-api.com/v1/weapons/skins');
      for (const s of skins || []) {
        if (!s || !s.uuid) continue;
        // valorant-api can return a null weaponUuid on some levels, so also
        // derive the weapon from the trailing token of the skin's display name.
        const weapon = s.weaponUuid || s.weapon || '';
        const weaponName = weaponFromName(s.displayName) || null;
        const icon = s.displayIcon || null;
        const meta = { name: s.displayName || 'Unknown', icon, weaponUuid: weapon || null, weaponName };
        const put = (uuid) => { out[String(uuid).toLowerCase()] = meta; };
        put(s.uuid);
        for (const l of s.levels || []) if (l && l.uuid) put(l.uuid);
        for (const c of s.chromas || []) if (c && c.uuid) put(c.uuid);
      }
    } catch { /* leave whatever we have */ }
    return out;
  })();
  return skinDefsPromise;
}

// bundle UUID -> { name, image }
async function bundleDefs() {
  if (bundleDefsPromise) return bundleDefsPromise;
  bundleDefsPromise = (async () => {
    const out = {};
    try {
      const bundles = await fetchData('https://valorant-api.com/v1/bundles');
      for (const b of bundles || []) {
        if (!b || !b.uuid) continue;
        out[String(b.uuid).toLowerCase()] = { name: b.displayName || null, image: b.displayIcon || null };
      }
    } catch { /* ignore */ }
    return out;
  })();
  return bundleDefsPromise;
}

// weapon UUID -> display name
async function weaponDefs() {
  if (weaponDefsPromise) return weaponDefsPromise;
  weaponDefsPromise = (async () => {
    const out = {};
    try {
      const weapons = await fetchData('https://valorant-api.com/v1/weapons');
      for (const w of weapons || []) {
        if (w && w.uuid && w.displayName) out[String(w.uuid).toLowerCase()] = w.displayName;
      }
    } catch { /* ignore */ }
    return out;
  })();
  return weaponDefsPromise;
}

// Price helper: VP cost from a Cost map (keyed by currency UUID).
function vpCost(cost) {
  if (!cost || typeof cost !== 'object') return null;
  for (const id of VP_CURRENCY_IDS) {
    const amount = cost[id];
    if (amount != null) return Number(amount);
  }
  return null;
}

// First defined non-null value — tolerates the many field-name variations the
// Riot Client has shipped across storefront versions.
function pick() {
  for (let i = 0; i < arguments.length; i += 1) {
    const v = arguments[i];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

// Shape-only debug log (never credentials/tokens). Enable with DEBUG_STORE=1.
const DEBUG_STORE = !!process.env.DEBUG_STORE;
function dbg(shape) {
  if (DEBUG_STORE) console.error('[store debug]', JSON.stringify(shape));
}

// Featured bundle -> normalized shape. Returns null when no bundle is present.
function featuredFromStore(data, bundles) {
  const fb = pick(data && data.FeaturedBundle && data.FeaturedBundle.Bundle);
  if (!fb) return null;
  // The bundle asset id is what valorant-api.com keys bundles by.
  const bundleId = String(
    pick(fb.DataAssetID, fb.BundleDataAssetID, fb.ID) || '',
  ).toLowerCase();
  const meta = bundleId ? (bundles[bundleId] || {}) : {};
  const items = Array.isArray(fb.Items) ? fb.Items : [];
  let base = 0;
  let discounted = 0;
  let hasDiscount = false;
  for (const it of items) {
    const b = Number(pick(it.BasePrice, it.Price) || 0);
    if (!Number.isFinite(b)) continue;
    base += b;
    const d = pick(it.DiscountedPrice, it.OfferPrice);
    if (d != null && Number.isFinite(Number(d))) {
      discounted += Number(d);
      hasDiscount = hasDiscount || Number(d) < b;
    } else {
      discounted += b;
    }
  }
  const remaining = pick(
    data.FeaturedBundle.BundleRemainingDurationInSeconds,
    data.FeaturedBundle.DurationInSeconds,
  );
  return {
    name: meta.name || null,
    image: meta.image || null,
    price: items.length ? { base: base || null, discounted: hasDiscount ? discounted : null } : null,
    remainingSeconds: remaining != null ? remaining : null,
  };
}

// One daily offer -> normalized shape. The item's real skin UUID lives in
// Rewards[0].ItemID; OfferID is only a fallback for older response shapes.
function offerFromStore(o, skins, weapons) {
  const costMap = pick(o && o.Cost, o && o.Offer && o.Offer.Cost);
  const reward = Array.isArray(o && o.Rewards) && o.Rewards[0]
    ? String(o.Rewards[0].ItemID || '').toLowerCase()
    : '';
  const oid = String(
    pick(reward, o && o.OfferID, o && o.Offer && o.Offer.OfferID) || '',
  ).toLowerCase();
  const skinMeta = oid ? (skins[oid] || {}) : {};
  const weaponName =
    skinMeta.weaponName ||
    (skinMeta.weaponUuid ? (weapons[skinMeta.weaponUuid] || null) : null);
  return {
    weapon: weaponName || null,
    skin: skinMeta.name || null,
    image: skinMeta.icon || null,
    price: vpCost(costMap),
    remainingSeconds: null, // filled in below from the layout-level timer
  };
}

async function storefront() {
  if (!lockfileAvailable()) {
    return { source: 'none', message: 'Riot Client unavailable', featured: null, offers: [], remainingSeconds: null };
  }

  const now = Date.now();
  if (storeCache.value && now - storeCache.at < TTL_MS) return storeCache.value;

  try {
    const auth = new LocalAuth();
    await auth.headers();
    // The current storefront is a POST on /store/v3/storefront. The older
    // GET /store/v2/storefront returns 404 on modern clients.
    const data = await auth.pdPost(`/store/v3/storefront/${auth.puuid}`, {});

    dbg({
      topKeys: Object.keys(data || {}),
      hasSkinsPanel: !!(data && data.SkinsPanelLayout),
      offerCount: Array.isArray(data && data.SkinsPanelLayout && data.SkinsPanelLayout.SingleItemStoreOffers)
        ? data.SkinsPanelLayout.SingleItemStoreOffers.length
        : 0,
      hasFeatured: !!(data && data.FeaturedBundle),
    });

    if (!data || data.errorCode) {
      throw new Error(
        data && data.errorCode
          ? `${data.errorCode}${data.status ? ` (HTTP ${data.status})` : ''}`
          : 'Empty storefront response',
      );
    }

    const [skins, bundles, weapons] = await Promise.all([skinDefs(), bundleDefs(), weaponDefs()]);

    const featured = featuredFromStore(data, bundles);

    const layout = data && data.SkinsPanelLayout;
    // Some clients nest daily offers under SingleItemStoreOffers, others under
    // SingleItemOffers — accept both so real data is never dropped.
    const offersRaw = Array.isArray(layout && layout.SingleItemStoreOffers)
      ? layout.SingleItemStoreOffers
      : (Array.isArray(layout && layout.SingleItemOffers) ? layout.SingleItemOffers : []);
    const layoutRemaining =
      pick(
        layout && layout.SingleItemOffersRemainingDurationInSeconds,
        layout && layout.SingleItemOffersRemainingTime,
      ) != null
        ? Number(pick(
          layout.SingleItemOffersRemainingDurationInSeconds,
          layout.SingleItemOffersRemainingTime,
        ))
        : null;
    const offers = offersRaw
      .slice(0, 4)
      .map((o) => Object.assign(offerFromStore(o, skins, weapons), { remainingSeconds: layoutRemaining }));

    dbg({ resolvedOffers: offers.filter((o) => o.image || o.skin).length, featuredName: featured && featured.name });

    const out = {
      source: 'riot-client',
      featured,
      offers,
      remainingSeconds: layoutRemaining,
    };

    storeCache = { at: now, value: out };
    return out;
  } catch (error) {
    storeCache = { at: 0, value: null };
    console.error('[store]', error && error.message);
    return { source: 'local', error: true, message: (error && error.message) || 'Store unavailable', featured: null, offers: [], remainingSeconds: null };
  }
}

module.exports = { storefront };