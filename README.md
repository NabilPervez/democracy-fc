# Democracy FC — Vote Chaos

A sealed soccer facility, The Assembly, runs a 5-a-side league in glass-walled arenas that plays itself.
You're a fan outside the walls: pick a club, vote on its tactic and captain before every match, make
predictions with earn-only coins, and vote with every other fan base on the facility's rules.

Live at **https://democracy-fc.netlify.app**. Started from the [Blastball](https://github.com/NabilPervez/blastball) shell; the baseball game has been removed.

- Product spec: [`prd.md`](prd.md)
- Sprint plan, definitions of done and progress log: [`SPRINT_PLAN_DFC.md`](SPRINT_PLAN_DFC.md)
- IP review: [`docs/IP_CHECKLIST.md`](docs/IP_CHECKLIST.md)

## Where things live

| Path | What |
|---|---|
| `src/engine/core` | RNG and the `SportEngine` interface + registry |
| `src/engine/soccer` | 5v5 match engine: possession chains, walls, phases, set pieces, tactics, arenas |
| `src/engine/baseball` | Blastball engine (legacy saves) |
| `src/world/soccer` | The Assembly: universe reducer, elections, Matchday Ballot, weirdness, recaps |
| `src/ui/soccer`, `src/ui/pitch` | Democracy FC screens, live pitch view |
| `content/soccer` | Names, arenas, signatures, tactics, proposals, templates, rule pack — all original |

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # engine + determinism tests
npm run lint       # includes the Math.random ban and engine import boundary
npm run build      # static output in dist/
```

## Deploy

Static site, no backend. Netlify reads `netlify.toml` (build `npm run build`, publish `dist`).
