const { henrik } = require('./henrik');

async function lookupPlayer(riotId) {
  const [name, tag] = riotId.split('#');

  if (!name || !tag) {
    return {
      found: false,
      message: 'Use Riot ID format Name#Tag'
    };
  }

  try {
    const account = await henrik(
      `/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`
    );

    return {
      found: true,
      account
    };

  } catch (err) {
    console.error('HenrikDev lookup:', err);

    return {
      found: false,
      message: 'Player not found'
    };
  }
}

module.exports = { lookupPlayer };