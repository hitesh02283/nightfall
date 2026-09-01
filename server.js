const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const fsSync=require('node:fs');
const net=require('node:net');

const {buildLive,snapshotClient}=require('./lib/live-match');
const {
  agentList,
  instalockStart,
  instalockStop,
  controlsDodge,
  controlsStatus
}=require('./lib/match-controls');
const {buildProfileSummary,buildMatchHistory,buildMatchDetail}=require('./lib/profile-summary');
const {
  partyStatus,
  partyInvite,
  generateCode,
  disableCode,
  joinByCode
}=require('./lib/party');
const valorantAssets=require('./lib/valorant-assets');
const {agentCatalog}=require('./lib/agents');
const {friendsList,friendMessages,sendFriendMessage}=require('./lib/friends');
const {queueMode,queueStart,queueCancel,queueStatus}=require('./lib/queue');
const {storefront}=require('./lib/store');

try{
  const env=fsSync.readFileSync('.env','utf8');
  for(const line of env.split(/\r?\n/)){
    const m=line.match(/^([A-Z0-9_]+)=(.*)$/);
    if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim();
  }
}catch{}

const port=Number(process.env.PORT||3000);
const platform=process.env.RIOT_PLATFORM||'ap';
const regional=process.env.RIOT_REGIONAL_ROUTING||'americas';
const henrikKey=process.env.HENRIK_API_KEY;

const types={
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8'
};

const configured=()=>Boolean(
  process.env.RIOT_API_KEY&&
  process.env.RIOT_RSO_ACCESS_TOKEN
);

async function riot(url,headers){
  const r=await fetch(url,{headers});
  if(!r.ok)throw new Error(`Riot API returned ${r.status}`);
  return r.json();
}

async function henrik(url){
  if(!henrikKey)
    throw new Error('HENRIK_API_KEY is missing from .env');

  const r=await fetch(url,{
    headers:{
      Authorization:henrikKey,
      Accept:'application/json'
    }
  });

  let data={};

  try{
    data=await r.json();
  }catch{}

  if(!r.ok){
    const message=
      data?.errors?.[0]?.message||
      data?.message||
      `HenrikDev API returned ${r.status}`;

    throw new Error(message);
  }

  return data;
}

async function liveSummary(){
  if(!configured())
    throw new Error('Missing Riot credentials.');

  const account=await riot(
    `https://${regional}.api.riotgames.com/riot/account/v1/accounts/me`,
    {Authorization:`Bearer ${process.env.RIOT_RSO_ACCESS_TOKEN}`}
  );

  const list=await riot(
    `https://${platform}.api.riotgames.com/val/match/v1/matchlists/by-puuid/${encodeURIComponent(account.puuid)}`,
    {'X-Riot-Token':process.env.RIOT_API_KEY}
  );

  return{
    account:{
      gameName:account.gameName,
      tagLine:account.tagLine,
      puuid:account.puuid
    },
    matches:(Array.isArray(list)?list:list.history||[]).slice(0,20),
    source:'riot'
  };
}

let defCache={at:0,maps:null};

const WEAPON_ORDER=[
  'Classic','Vandal','Phantom','Operator','Marshal',
  'Outlaw','Ghost','Sheriff','Frenzy','Spectre',
  'Stinger','Bulldog','Guardian','Bucky','Judge',
  'Ares','Odin','Shorty','Melee'
];

const SKIN_SOCKET_UUID='bcef87d6-209b-46c6-8b19-fbe40bd95abc';

async function fetchDefMaps(){
  const now=Date.now();

  if(defCache.maps&&now-defCache.at<3600000)
    return defCache.maps;

  const maps={
    weapons:{},
    weaponPaths:{},
    skins:{},
    skinIcons:{},
    skinWeapons:{},
    skinBases:{},
    order:WEAPON_ORDER
  };

  try{
    const[w,s]=await Promise.all([
      fetch('https://valorant-api.com/v1/weapons')
        .then(r=>r.ok?r.json():{data:[]}),
      fetch('https://valorant-api.com/v1/weapons/skins')
        .then(r=>r.ok?r.json():{data:[]})
    ]);

    for(const x of w.data||[]){
      if(x.uuid&&x.displayName)
        maps.weapons[x.uuid.toLowerCase()]={
          name:x.displayName,
          icon:x.displayIcon||x.killStreamIcon||null,
          assetPath:x.assetPath||''
        };
        maps.weaponPaths[x.uuid.toLowerCase()]=x.assetPath||'';
    }

    for(const x of s.data||[]){
      if(!x.uuid||!x.displayName)continue;

      let name=x.displayName;
      const weapon=x.weaponUuid||x.weapon||x.weaponDisplayName||'';
      const skinPath=String(x.assetPath||'');
      const skinDir=skinPath.slice(0,skinPath.lastIndexOf('/'));
      const inferredWeapon=Object.entries(maps.weaponPaths)
        .filter(([,path])=>path&&skinDir.startsWith(String(path).slice(0,String(path).lastIndexOf('/'))))
        .sort((a,b)=>String(b[1]).length-String(a[1]).length)[0];
      const weaponId=weapon
        ?String(weapon).toLowerCase()
        :(inferredWeapon?inferredWeapon[0]:null);

      if(
        weapon&&
        name.toLowerCase().endsWith(
          ' '+weapon.toLowerCase()
        )
      ){
        name=name
          .slice(0,-(weapon.length+1))
          .trim();
      }

      maps.skins[x.uuid.toLowerCase()]=name||'Standard';
      if(weaponId)maps.skinWeapons[x.uuid.toLowerCase()]=weaponId;
      maps.skinBases[x.uuid.toLowerCase()]=x.uuid.toLowerCase();
      if(x.displayIcon)maps.skinIcons[x.uuid.toLowerCase()]=x.displayIcon;

      for(const level of x.levels||[]){
        if(!level.uuid)continue;
        maps.skins[level.uuid.toLowerCase()]=name||'Standard';
        if(weaponId)maps.skinWeapons[level.uuid.toLowerCase()]=weaponId;
        maps.skinBases[level.uuid.toLowerCase()]=x.uuid.toLowerCase();
        if(level.displayIcon||x.displayIcon)
          maps.skinIcons[level.uuid.toLowerCase()]=level.displayIcon||x.displayIcon;
      }

      for(const chroma of x.chromas||[]){
        if(!chroma.uuid)continue;
        maps.skins[chroma.uuid.toLowerCase()]=name||'Standard';
        if(weaponId)maps.skinWeapons[chroma.uuid.toLowerCase()]=weaponId;
        maps.skinBases[chroma.uuid.toLowerCase()]=x.uuid.toLowerCase();
        if(chroma.displayIcon||chroma.fullRender||x.displayIcon)
          maps.skinIcons[chroma.uuid.toLowerCase()]=chroma.displayIcon||chroma.fullRender||x.displayIcon;
      }
    }
  }catch{}

  try{
    maps.buddies=await valorantAssets.getBuddyDefs();
  }catch{
    maps.buddies={};
  }

  defCache={at:now,maps};
  return maps;
}

async function buildLoadouts(){
  const{
    LocalAuth,
    lockfileAvailable,
    chatPresences
  }=require('./lib/local-auth');

  const{LiveMatch}=require('./lib/live-match');

  if(!lockfileAvailable())
    return{source:'none',items:[],sprays:[]};

  try{
    const auth=new LocalAuth();

    await auth.headers();

    const defs=await fetchDefMaps();
    const puuid=auth.puuid;

    let items=[];
    let sprays=[];
    let sprayDefs={};
    try{sprayDefs=await valorantAssets.getSprayDefs();}catch{}

    try{
      const lo=await auth.pdGet(
        `/personalization/v3/players/${puuid}/playerloadout`,
        {retries:2}
      );

      if(lo&&Array.isArray(lo.Guns))
        items=parseGunsLoadout(lo.Guns,defs);

      if(lo&&Array.isArray(lo.Sprays)){
        sprays=lo.Sprays
          .map(s=>{
            const id=String(s.SprayID||s.SprayLevelID||'').toLowerCase();
            const equipped=Boolean(s.SprayID);
            const def= id&&sprayDefs[id]?sprayDefs[id]:null;
            return {
              id: id||null,
              equipped,
              name: equipped?(def?def.name:'Spray'):'Empty',
              image: def?def.icon:null
            };
          });
      }else if(lo&&Array.isArray(lo.ActiveExpressions)){
        // v3 schema: sprays are in ActiveExpressions (TypeID = sprays itemtype).
        const SPRAY_TYPE_ID='d5f120f8-ff8c-4aac-92ea-f2b5acbe9475';
        sprays=lo.ActiveExpressions
          .filter(s=>String(s&&s.TypeID||'').toLowerCase()===SPRAY_TYPE_ID)
          .map(s=>{
            const id=String(s.AssetID||'').toLowerCase();
            const def= id&&sprayDefs[id]?sprayDefs[id]:null;
            return {
              id: id||null,
              equipped:Boolean(id),
              name: id?(def?def.name:'Spray'):'Empty',
              image: def?def.icon:null
            };
          });
      }

    }catch{}

    if(!items.length){
      try{
        const presences=await chatPresences(auth);
        const live=new LiveMatch(auth);
        const state=await live.gameState(presences);

        if(state==='INGAME'||state==='PREGAME'){
          const player=state==='INGAME'
            ?await auth.glzGet(`/core-game/v1/players/${puuid}`)
            :await auth.glzGet(`/pregame/v1/players/${puuid}`);

          const matchId=player?.MatchID;

          if(matchId){
            const endpoint=state==='INGAME'
              ?`/core-game/v1/matches/${matchId}/loadouts`
              :`/pregame/v1/matches/${matchId}/loadouts`;

            const ld=await auth.glzGet(endpoint);

            if(ld?.Loadouts){
              const entry=(Array.isArray(ld.Loadouts)
                ?ld.Loadouts
                :[]
              ).find(
                x=>
                  String(x.Subject||'').toLowerCase()===
                  puuid.toLowerCase()
              );

              if(entry){
                const raw=entry.Loadout
                  ?entry.Loadout.Items
                  :(entry.Items||{});

                items=parseLoadoutItems(
                  raw,
                  SKIN_SOCKET_UUID,
                  defs
                );
              }
            }
          }
        }
      }catch{}
    }

    items.sort((a,b)=>{
      const ai=defs.order.indexOf(a.weapon);
      const bi=defs.order.indexOf(b.weapon);

      return(
        (ai<0?defs.order.length:ai)-
        (bi<0?defs.order.length:bi)
      );
    });

    return{source:'riot',items,sprays};
  }catch{
    return{source:'local',items:[],sprays:[]};
  }
}

function parseLoadoutItems(raw,socketUuid,defs){
  const out=[];

  if(Array.isArray(raw)){
    for(const entry of raw){
      if(!entry?.ID||!entry?.SlotID)continue;

      const slot=String(entry.SlotID).toLowerCase();

      if(
        slot.includes('ability')||
        slot.includes('armor')||
        slot.includes('charm')||
        slot.includes('buddy')||
        slot.includes('spray')
      )continue;

      const weaponDef=defs.weapons[String(entry.ID).toLowerCase()];
      const weapon=weaponDef&&weaponDef.name;

      if(!weapon)continue;

      const skinId=entry.EntitlementID
        ?String(entry.EntitlementID).toLowerCase()
        :'';

      out.push({
        weaponId:String(entry.ID).toLowerCase(),
        weapon,
        skinId:skinId||null,
        skin:skinId?defs.skins[skinId]||'Standard':'Standard',
        skinIcon:skinId?defs.skinIcons[skinId]||null:null,
        weaponIcon:weaponDef&&weaponDef.icon||null
      });
    }
  }else if(raw&&typeof raw==='object'){
    for(const[wid,item]of Object.entries(raw)){
      const weaponDef=defs.weapons[String(wid).toLowerCase()];
      const weapon=weaponDef&&weaponDef.name;

      if(!weapon)continue;

      const socket=item?.Sockets?.[socketUuid];
      const id=socket?.Item?.ID;
      const skinId=id?String(id).toLowerCase():'';

      out.push({
        weaponId:String(wid).toLowerCase(),
        weapon,
        skinId:skinId||null,
        skin:skinId
          ?defs.skins[skinId]||'Standard'
          :'Standard',
        skinIcon:skinId?defs.skinIcons[skinId]||null:null,
        weaponIcon:weaponDef&&weaponDef.icon||null
      });
    }
  }

  return out;
}

function parseGunsLoadout(guns,defs){
  return(guns||[]).reduce((out,g)=>{
      const weaponDef=defs.weapons[String(g.ID||'').toLowerCase()];
      const weapon=weaponDef&&weaponDef.name;

    if(!weapon)return out;

    const skin=String(
      g.SkinID||
      g.SkinLevelID||
      ''
    ).toLowerCase();

    const charm=String(
      g.CharmLevelID||
      g.CharmID||
      ''
    ).toLowerCase();

    out.push({
      weaponId:String(g.ID||'').toLowerCase(),
      weapon,
      skinId:skin||null,
      skin:defs.skins[skin]||'Standard',
        skinIcon:defs.skinIcons[skin]||null,
        weaponIcon:weaponDef&&weaponDef.icon||null,
      buddy:charm&&defs.buddies&&defs.buddies[charm]
        ?defs.buddies[charm]
        :null
    });

    return out;
  },[]);
}

// Equip one weapon skin using the complete authenticated Riot loadout. The
// browser supplies only validated catalog IDs; auth headers and the payload
// remain server-side.
async function equipLoadoutSkin(body){
  const weaponId=String(body&&body.weaponId||'').trim().toLowerCase();
  const skinId=String(body&&body.skinId||'').trim().toLowerCase();
  if(!weaponId||!skinId)
    return{status:400,body:{ok:false,message:'weaponId and skinId are required.'}};

  const{LocalAuth,lockfileAvailable}=require('./lib/local-auth');
  if(!lockfileAvailable())
    return{status:503,body:{ok:false,message:'Riot Client is not ready.'}};

  const defs=await fetchDefMaps();
  if(!defs.weapons[weaponId])
    return{status:400,body:{ok:false,message:'Unknown weapon.'}};
  if(!defs.skins[skinId]||defs.skinWeapons[skinId]!==weaponId)
    return{status:400,body:{ok:false,message:'Skin does not belong to the specified weapon.'}};

  const auth=new LocalAuth();
  await auth.headers();
  const endpoint=`/personalization/v3/players/${auth.puuid}/playerloadout`;
  const current=await auth.pdGet(endpoint,{retries:2});
  // Surface the actual Riot error (e.g. RESOURCE_NOT_FOUND) instead of a
  // generic message so the cause is visible in the browser status bar.
  if(current&&current.errorCode)
    return{status:502,body:{ok:false,message:`Could not read the current Riot loadout (${current.errorCode}).`}};
  if(!current||!Array.isArray(current.Guns))
    return{status:502,body:{ok:false,message:'Could not read the current Riot loadout.'}};
  const target=current.Guns.find((g)=>String(g&&g.ID||'').toLowerCase()===weaponId);
  if(!target)
    return{status:400,body:{ok:false,message:'Weapon is not present in the current Riot loadout.'}};

  const payload=JSON.parse(JSON.stringify(current));
  // Per the documented SetPlayerLoadoutBody schema, the PUT body must
  // contain only Guns, Sprays, Identity, and Incognito. Subject and Version
  // are GET-response fields and must not be sent in the PUT body.
  delete payload.Subject;
  delete payload.Version;
  const targetCopy=payload.Guns.find((g)=>String(g&&g.ID||'').toLowerCase()===weaponId);
  targetCopy.SkinID=skinId;
  const put=await auth.pdPut(endpoint,payload);
  if(put&&put.errorCode)
    return{status:502,body:{ok:false,message:`Riot rejected the loadout update (${put.errorCode}).`}};

  // Force a token refresh + fresh fetch on verification so we read back
  // the post-PUT state rather than any cached response.
  const verified=await auth.pdGet(endpoint,{retries:2,refresh:true});
  const verifiedGun=verified&&Array.isArray(verified.Guns)
    ?verified.Guns.find((g)=>String(g&&g.ID||'').toLowerCase()===weaponId)
    :null;
  if(String(verifiedGun&&verifiedGun.SkinID||'').toLowerCase()!==skinId)
    return{status:502,body:{ok:false,message:'Riot did not confirm the requested skin.'}};
  return{status:200,body:{ok:true,weaponId,skinId}};
}

async function loadoutSkins(){
  const{LocalAuth,lockfileAvailable}=require('./lib/local-auth');
  if(!lockfileAvailable())return{source:'none',weapons:[]};
  const auth=new LocalAuth();
  await auth.headers();
  const defs=await fetchDefMaps();
  const [entitlements,loadout]=await Promise.all([
    auth.pdGet(`/store/v1/entitlements/${auth.puuid}`,{retries:1}),
        auth.pdGet(`/personalization/v3/players/${auth.puuid}/playerloadout`,{retries:2}),
  ]);
  const equipped=new Map((loadout&&loadout.Guns||[]).map((g)=>[
    String(g&&g.ID||'').toLowerCase(),defs.skinBases[String(g&&(g.SkinID||g.SkinLevelID)||'').toLowerCase()]||String(g&&(g.SkinID||g.SkinLevelID)||'').toLowerCase(),
  ]));
  const owned=new Set();
  // Riot exposes owned weapon skins across the base-skin and owned
  // level/chroma entitlement buckets. Both are authoritative; normalize
  // level/chroma ItemIDs to their parent skin UUID below.
  const skinTypes=new Set([
    '3ad1b2b2-acdb-4524-852f-954a76ddae0a',
    'e7c63390-eda7-46e0-bb7a-a6abdacd2433',
  ]);
  for(const bucket of Object.values((entitlements&&entitlements.EntitlementsByTypes)||{})){
    if(!skinTypes.has(String(bucket&&bucket.ItemTypeID||'').toLowerCase()))continue;
    for(const item of bucket.Entitlements||[]){
      const id=String(item&&item.ItemID||'').toLowerCase();
      const base=defs.skinBases[id]||id;
      if(base)owned.add(base);
    }
  }
  const grouped=new Map();
  for(const skinId of owned){
    const weaponId=defs.skinWeapons[skinId];
    if(!weaponId||!defs.weapons[weaponId])continue;
    if(!grouped.has(weaponId))grouped.set(weaponId,[]);
    grouped.get(weaponId).push({
      skinId,
      name:defs.skins[skinId]||'Unknown',
      icon:defs.skinIcons[skinId]||null,
      owned:true,
      equipped:equipped.get(weaponId)===skinId,
    });
  }
  return{source:'riot',weapons:[...grouped.entries()].map(([weaponId,skins])=>({
    weaponId,weaponName:defs.weapons[weaponId].name,skins,
  }))};
}

function regionForHenrik(region){
  const r=String(region||'').toLowerCase();

  if(['eu','na','ap','kr','latam','br'].includes(r))
    return r;

  return 'ap';
}

async function playerLookup(query){
  const riotId=typeof query==='string'
    ?query
    :(query?.riotId||'');

  const raw=String(riotId).trim();

  if(!raw){
    return{
      source:'none',
      found:false,
      message:'Provide a Riot ID (Name#Tag).'
    };
  }

  const hash=raw.lastIndexOf('#');

  if(hash<1||hash===raw.length-1){
    return{
      source:'none',
      found:false,
      message:'Invalid Riot ID format. Use Name#Tag.'
    };
  }

  const name=raw.slice(0,hash).trim();
  const tag=raw.slice(hash+1).trim();

  if(!name||!tag){
    return{
      source:'none',
      found:false,
      message:'Invalid Riot ID format. Use Name#Tag.'
    };
  }

  if(!henrikKey){
    return{
      source:'henrikdev',
      found:false,
      message:'HENRIK_API_KEY is missing from .env'
    };
  }

  try{
    const encodedName=encodeURIComponent(name);
    const encodedTag=encodeURIComponent(tag);

    const accountResponse=await henrik(
      `https://api.henrikdev.xyz/valorant/v2/account/${encodedName}/${encodedTag}`
    );

    const account=accountResponse?.data;

    if(!account){
      return{
        source:'henrikdev',
        found:false,
        message:'Player not found.'
      };
    }

    const region=regionForHenrik(account.region);

    let mmr=null;
    let matches=[];

    try{
      const r=await henrik(
        `https://api.henrikdev.xyz/valorant/v3/mmr/${region}/pc/${encodedName}/${encodedTag}`
      );

      mmr=r?.data||null;
    }catch{}

    try{
      const r=await henrik(
        `https://api.henrikdev.xyz/valorant/v4/matches/${region}/pc/${encodedName}/${encodedTag}?size=10`
      );

      matches=Array.isArray(r?.data)
        ?r.data
        :[];
    }catch{
      try{
        const r=await henrik(
          `https://api.henrikdev.xyz/valorant/v3/matches/${region}/${encodedName}/${encodedTag}?size=10`
        );

        matches=Array.isArray(r?.data)
          ?r.data
          :[];
      }catch{}
    }

    const current=mmr?.current||{};
    const peak=mmr?.peak||{};

    const currentTier=current?.tier||null;
    const peakTier=peak?.tier||null;

    let wins=0;
    let losses=0;
    let kills=0;
    let deaths=0;
    let assists=0;
    let headshots=0;
    let shots=0;

    const recent=matches.map(match=>{
      const players=
        match?.players?.all_players||
        match?.players||
        [];

      const me=players.find(
        p=>
          p?.puuid===account?.puuid||
          (
            String(p?.name||'').toLowerCase()===
            String(account?.name||name).toLowerCase()&&
            String(p?.tag||'').toLowerCase()===
            String(account?.tag||tag).toLowerCase()
          )
      );

      const teams=match?.teams||{};
      const team=me?.team?.toLowerCase();

      let won=null;

      if(team&&teams[team]?.has_won!==undefined)
        won=Boolean(teams[team].has_won);

      if(won===true)wins++;
      if(won===false)losses++;

      if(me?.stats){
        kills+=Number(me.stats.kills||0);
        deaths+=Number(me.stats.deaths||0);
        assists+=Number(me.stats.assists||0);
        headshots+=Number(me.stats.headshots||0);
        shots+=
          Number(me.stats.headshots||0)+
          Number(me.stats.bodyshots||0)+
          Number(me.stats.legshots||0);
      }

      return{
        map:match?.metadata?.map||'Unknown',
        mode:match?.metadata?.mode||'Unknown',
        kills:me?.stats?.kills??0,
        deaths:me?.stats?.deaths??0,
        assists:me?.stats?.assists??0,
        won,
        score:
          team&&teams[team]
            ?`${teams[team].rounds_won??0} — ${
              Object.entries(teams)
                .filter(([k])=>k!==team)
                .map(([,v])=>v?.rounds_won??0)[0]??0
            }`
            :'—',
        date:match?.metadata?.game_start_patched||
          match?.metadata?.game_start||
          null
      };
    });

    const games=wins+losses;

    return{
      source:'henrikdev',
      found:true,
      account:{
        name:account.name||name,
        tag:account.tag||tag,
        puuid:account.puuid,
        region:account.region,
        level:account.account_level,
        card:account.card||null
      },
      rank:currentTier
        ?{
          name:currentTier.name,
          id:currentTier.id,
          rr:current.rr??null,
          elo:current.elo??null
        }
        :null,
      peak:peakTier
        ?{
          name:peakTier.name,
          id:peakTier.id
        }
        :null,
      leaderboard:mmr?.current?.leaderboard_placement||null,
      stats:{
        games:games||null,
        wins:games?wins:null,
        losses:games?losses:null,
        winRate:games
          ?Math.round(wins/games*100)
          :null,
        kd:deaths
          ?Math.round(kills/deaths*100)/100
          :null,
        hs:shots
          ?Math.round(headshots/shots*100)
          :null,
        kills:kills||null,
        deaths:deaths||null,
        assists:assists||null
      },
      matches:recent
    };
  }catch(error){
    const message=error?.message||'Lookup failed.';

    if(
      message.includes('404')||
      message.toLowerCase().includes('not found')
    ){
      return{
        source:'henrikdev',
        found:false,
        message:'Player not found.'
      };
    }

    return{
      source:'henrikdev',
      found:false,
      message
    };
  }
}

function json(res,status,body){
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store'
  });

  res.end(JSON.stringify(body));
}

function readBody(req){
  return new Promise(resolve=>{
    let data='';

    req.on('data',c=>data+=c);

    req.on('end',()=>{
      try{
        resolve(JSON.parse(data||'{}'));
      }catch{
        resolve({});
      }
    });

    req.on('error',()=>resolve({}));
  });
}

// Same-origin image proxy. The browser loads the authoritative asset artwork
// (media.valorant-api.com) through Nightfall so external-image hotlink/CORS/CDN
// rules can never produce a broken browser image. Only the authoritative
// VALORANT media hosts are allowed; everything else is rejected.
//
// Validation is strict: the target must be an https URL whose parsed hostname
// exactly matches an allow-listed host (case-insensitive). This blocks http,
// localhost, bare IPs, private/internal hosts, and look-alike subdomains such
// as "media.valorant-api.com.evil.example". Keep this list minimal.
const ALLOWED_IMG_HOSTS = new Set([
  'media.valorant-api.com',
  'valorant-api.com',
]);

function isAllowedProxyTarget(target) {
  if (typeof target !== 'string' || !target) return false;
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return false;
  }
  // Only explicit, unambiguous https URLs are ever proxied.
  if (parsed.protocol !== 'https:') return false;
  // Reject embedded credentials (https://user:pass@host) outright.
  if (parsed.username || parsed.password) return false;
  // Reject bare IP addresses (v4 or v6) — hostnames only.
  if (net.isIP(parsed.hostname) !== 0) return false;
  // Exact hostname match (lowercased). No subdomains, no trailing-dot tricks,
  // no look-alike hosts like "media.valorant-api.com.evil.example".
  return ALLOWED_IMG_HOSTS.has(parsed.hostname.toLowerCase());
}

async function serveImage(req, res, url) {
  const target = url.searchParams.get('url') || '';
  if (!isAllowedProxyTarget(target)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad image URL');
    return;
  }
  try {
    const remote = await fetch(target, { headers: { Accept: 'image/*,image/png,*/*' } });
    if (!remote.ok) {
      res.writeHead(remote.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Image unavailable');
      return;
    }
    const buf = Buffer.from(await remote.arrayBuffer());
    res.writeHead(200, {
      'Content-Type': remote.headers.get('content-type') || 'image/png',
      'Cache-Control': 'public, max-age=600',
    });
    res.end(buf);
  } catch {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Proxy error');
  }
}

http.createServer(async(req,res)=>{
  const url=new URL(
    req.url,
    `http://${req.headers.host}`
  );

  if(url.pathname==='/api/img'){
    return await serveImage(req, res, url);
  }

  if(url.pathname==='/api/status'){
    return json(res,200,{
      configured:configured(),
      henrikConfigured:Boolean(henrikKey),
      platform,
      requiresRSO:true
    });
  }

  if(url.pathname==='/api/summary'){
    try{
      return json(res,200,await liveSummary());
    }catch(error){
      return json(res,503,{error:error.message});
    }
  }

  if(
    url.pathname==='/api/live'||
    url.pathname==='/api/live/status'
  ){
    try{
      return json(
        res,
        200,
        url.pathname==='/api/live'
          ?await buildLive()
          :await snapshotClient()
      );
    }catch(error){
      return json(res,503,{error:error.message});
    }
  }

  if(url.pathname==='/api/agents'){
    let maps={};
    try{ maps=await valorantAssets.getMapAssets(); }catch{}
    return json(res,200,{agents:agentList(), catalog: agentCatalog(), maps});
  }

  if(url.pathname==='/api/queue/mode' && req.method==='POST'){
    const body=await readBody(req);
    const result=await queueMode(body&&body.queueId);
    return json(res,result.ok?200:400,result);
  }

  if(url.pathname==='/api/queue/start' && req.method==='POST'){
    const body=await readBody(req);
    const result=await queueStart(body&&body.queueId);
    return json(res,result.ok?200:400,result);
  }

  if(url.pathname==='/api/queue/cancel' && req.method==='POST'){
    const result=await queueCancel();
    return json(res,result.ok?200:400,result);
  }

  if(url.pathname==='/api/queue/status' && req.method==='GET')
    return json(res,200,await queueStatus());

  if(url.pathname==='/api/profile-summary'){
    try{
      return json(res,200,await buildProfileSummary());
    }catch(error){
      return json(res,503,{error:error.message});
    }
  }

  if(url.pathname==='/api/match-history'){
    try{
      return json(res,200,await buildMatchHistory());
    }catch(error){
      return json(res,503,{error:error.message});
    }
  }

  if(url.pathname==='/api/match-detail'){
    try{
      const matchId=url.searchParams.get('matchId')||'';
      return json(res,200,await buildMatchDetail(matchId));
    }catch(error){
      return json(res,503,{error:error.message});
    }
  }

  if(url.pathname==='/api/controls')
    return json(res,200,await controlsStatus());

  if(url.pathname==='/api/loadouts'){
    try{
      return json(res,200,await buildLoadouts());
    }catch(error){
      return json(res,503,{error:error.message});
    }
  }

  if(url.pathname==='/api/loadouts/equip'&&req.method==='POST'){
    try{
      const result=await equipLoadoutSkin(await readBody(req));
      return json(res,result.status,result.body);
    }catch(error){
      return json(res,502,{ok:false,message:'Riot loadout update failed.'});
    }
  }

  if(url.pathname==='/api/loadout-skins'&&req.method==='GET'){
    try{return json(res,200,await loadoutSkins());}
    catch(error){return json(res,502,{source:'error',weapons:[],message:'Could not read owned skins from Riot Client.'});}
  }

  if(url.pathname==='/api/player-lookup'){
    try{
      const riotId=url.searchParams.get('riotId')||'';

      return json(
        res,
        200,
        await playerLookup(riotId)
      );
    }catch(error){
      return json(res,503,{
        source:'henrikdev',
        found:false,
        message:error.message
      });
    }
  }

  if(
    url.pathname==='/api/controls/instalock'&&
    req.method==='POST'
  ){
    const body=await readBody(req);

    return json(
      res,
      200,
      body?.action==='stop'
        ?await instalockStop()
        :await instalockStart(body||{})
    );
  }

  if(
    url.pathname==='/api/controls/dodge'&&
    req.method==='POST'
  ){
    const body=await readBody(req);

    return json(
      res,
      200,
      await controlsDodge(body||{})
    );
  }

  if(url.pathname==='/api/party/status'){
    try{
      return json(res,200,await partyStatus());
    }catch(error){
      return json(res,503,{error:error.message});
    }
  }

  if(
    url.pathname==='/api/party/invite'&&
    req.method==='POST'
  ){
    const body=await readBody(req);

    return json(
      res,
      200,
      await partyInvite(body||{})
    );
  }

  if(
    url.pathname==='/api/party/generate-code'&&
    req.method==='POST'
  )
    return json(res,200,await generateCode());

  if(
    url.pathname==='/api/party/disable-code'&&
    req.method==='POST'
  )
    return json(res,200,await disableCode());

  if(
    url.pathname==='/api/party/join-code'&&
    req.method==='POST'
  ){
    const body=await readBody(req);

    return json(
      res,
      200,
      await joinByCode(body||{})
    );
  }

  if(url.pathname==='/api/friends'){
    return json(res,200,await friendsList());
  }

  if(url.pathname==='/api/friends/messages'){
    const pid=url.searchParams.get('pid')||'';
    return json(res,200,await friendMessages(pid));
  }

  if(
    url.pathname==='/api/friends/message'&&
    req.method==='POST'
  ){
    const body=await readBody(req);
    return json(
      res,
      200,
      await sendFriendMessage(
        body&&body.pid,
        body&&body.message
      )
    );
  }

  if(url.pathname==='/api/store'){
    return json(res,200,await storefront());
  }

  const requested=
    url.pathname==='/'?
    '/index.html':
    url.pathname;

  const file=path.resolve(
    __dirname,
    `.${requested}`
  );

  if(!file.startsWith(__dirname))
    return json(res,403,{error:'Forbidden'});

  try{
    const data=await fs.readFile(file);

    res.writeHead(200,{
      'Content-Type':
        types[path.extname(file)]||
        'application/octet-stream'
    });

    res.end(data);
  }catch{
    json(res,404,{error:'Not found'});
  }
}).listen(
  port,
  ()=>console.log(
    `Nightfall is running at http://localhost:${port}`
  )
);