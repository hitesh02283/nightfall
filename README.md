# Nightfall

1. Copy `.env.example` to `.env`.
2. Add your approved `RIOT_API_KEY` and player-authorized `RIOT_RSO_ACCESS_TOKEN`.
3. Run `npm start`, then open `http://localhost:3000`.

VALORANT player data requires production access and Riot Sign On (RSO). Never expose or commit either secret. The server calls Riot’s official account and match-list APIs; rank remains in demo mode because the public VALORANT API has no general current-rank endpoint.

See [Riot's VALORANT developer policy](https://developer.riotgames.com/docs/valorant).
