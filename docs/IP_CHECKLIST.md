# IP review checklist (PRD §B12)

Last reviewed: 2026-10-07, at the end of Sprint 8.

| Item | Status | How it's checked |
|---|---|---|
| No Blue Lock names, character archetypes named after its cast, or facility terms | ✅ | `tests/ip.test.ts` scans every file in `src/`, `content/` and `index.html` for banned terms (Blue Lock, Ego/egoist, Neo Egoist, cast names) on every test run. Drives, Signature Moves and the facility (The Assembly, Wings, Sub-Levels, The Director) are original. |
| No anime art style copy; procedural geometric art only | ✅ | Crests are generated geometric shapes with the club's abbreviation (`Crest` in `src/ui/soccer/bits.tsx`); the pitch is schematic SVG. No illustrations ship. |
| No real clubs, leagues, crests, kits, players | ✅ | Club cities/names and player first/last names come only from `content/soccer/names.json` (invented). Colours are generic palette pairs. |
| Trademark search on "Democracy FC" | ⬜ **Needs a person** | Not something code can do. Search USPTO/EUIPO/UKIPO (and app stores) before any public launch. |
| Faction and club names generated from original lists only | ✅ | Factions: The Analysts, The Loyal End, The Chaos Choir, The Purists, The Lore Hunters, The Casuals. Clubs: `content/soccer/names.json`. |
| No Blaseball names (inherited rule from the Blastball PRD) | ✅ | Same scan in `tests/ip.test.ts`. |

Also before launch:
- The PWA icons, splash screens and `og-image.png` are still Blastball artwork, and `og:url` points at the Blastball site. Replace them with Democracy FC assets once a deploy URL exists.
- Run Lighthouse (PWA + performance) against a production build.
