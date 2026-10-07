import { useState } from 'react';
import { getArena, getSignature } from '../../engine/soccer/arenas';
import { soccerStars } from '../../engine/soccer/sport';
import type { SoccerPlayer, SoccerStarGroup } from '../../engine/soccer/types';
import {
  ageRatingOffset, cardRarity, careerPhase, clubBio, clubPerk, initialAge, PHASE_LABEL, pitchPerk, playerFlavor, TIER_LABEL, type Tier,
} from '../../world/soccer/identity';
import { combosWith, soccerMod } from '../../world/soccer/weird';
import { BACK_SLOTS, clubOf, FADE_SLOTS, pickError, PICK_RATES, type SoccerUniverse } from '../../world/soccer/universe';
import { Crest, DRIVE_INFO, POSITION_LABEL, Stars, Tip } from './bits';
import { HELP } from './help';
import { useAssembly } from './store';

/**
 * Player and club profiles (ideas from Blastball, rebuilt): rarity-framed cards with career arcs,
 * traits and combos; clubs with a bio, power-ups, championships and legends; a card collection.
 */

const STYLE_LABEL: Record<string, string> = {
  allOutAttack: 'All-Out Attack', counterPunch: 'Counter-Punch', possessionWall: 'Possession Wall', longBallSiege: 'Long-Ball Siege', parkTheBus: 'Park the Bus',
};

const GROUP_LABEL: Record<SoccerStarGroup, string> = { attack: 'Attack', playmaking: 'Playmaking', defense: 'Defense', engine: 'Engine', keeping: 'Keeping' };

/** What each star group is built from and what it does in a match (§B4). */
export const GROUP_HELP: Record<SoccerStarGroup, string> = {
  attack: 'Finishing, Dribbling and First Touch. Decides shot quality, beating a defender one-on-one, and keeping the ball under pressure.',
  playmaking: 'Passing and Vision. Moves the ball up the floor, threads passes through a block, and makes teammates’ shots better.',
  defense: 'Tackling, Positioning and Aerial. Wins the ball back, blocks shots, and deals with long balls and headers.',
  engine: 'Pace, Stamina and Composure. Breakaways and counters, legs late in a half (tired players get subbed), and nerve in big moments and penalties.',
  keeping: 'Reflexes and Handling. Stops shots, and holds on to them instead of parrying into a scramble. Keepers only.',
};

const titlesOf = (u: SoccerUniverse, clubId: string) => u.archive.filter((a) => a.championId === clubId).map((a) => a.season);

export function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`tier ${tier}`}>{TIER_LABEL[tier]}</span>;
}

// ---------------------------------------------------------------------------
// Club

export function ClubPage({ clubId }: { clubId: string }) {
  const u = useAssembly((s) => s.u)!;
  const { showDetail, dispatch } = useAssembly();
  const club = clubOf(u, clubId);
  const [confirm, setConfirm] = useState(false);
  if (!club) return <p className="muted">That club has left the facility.</p>;
  const bio = clubBio(u.settings.seed, club);
  const perk = clubPerk(u.settings.seed, club.id);
  const pitch = pitchPerk(u.settings.seed, club.id);
  const arena = getArena(club.arenaId);
  const titles = titlesOf(u, club.id);
  // All-time league record from finished seasons plus this one.
  const rows = [...u.archive.map((a) => a.standings.find((r) => r.teamId === club.id)), undefined].filter(Boolean) as { wins: number; draws: number; losses: number; runsFor: number }[];
  const allTime = rows.reduce((t, r) => ({ w: t.w + r.wins, d: t.d + r.draws, l: t.l + r.losses, g: t.g + r.runsFor }), { w: 0, d: 0, l: 0, g: 0 });
  const best = u.archive.map((a) => ({ season: a.season, pos: a.standings.findIndex((r) => r.teamId === club.id) + 1 })).filter((x) => x.pos > 0).sort((a, b) => a.pos - b.pos)[0];
  const legends = Object.entries(u.careerStats)
    .filter(([id]) => u.league.players[id]?.teamId === club.id)
    .sort((a, b) => b[1].goals + b[1].assists - (a[1].goals + a[1].assists))
    .slice(0, 3);
  const retired = u.retired.filter((r) => r.teamId === club.id).slice(-3);
  const switchable = club.id !== u.favoriteClubId && u.lastClubSwitchSeason !== u.season;
  return (
    <section className="stack">
      <button className="link-btn" onClick={() => showDetail(null)}>
        ← Facility
      </button>
      <div className="hero-band">
        <Crest team={club} size={64} />
        <div className="hero-text">
          <p className="eyebrow">Est. {bio.founded} · “{bio.motto}”</p>
          <h1>{club.name}</h1>
          <p className="sub">
            {club.city} · {STYLE_LABEL[club.style]}
          </p>
        </div>
      </div>

      <div className="facts">
        <div className="fact">
          <b>{titles.length}</b>
          <span>Titles</span>
        </div>
        <div className="fact">
          <b>
            {allTime.w}-{allTime.d}-{allTime.l}
          </b>
          <span>Record</span>
        </div>
        <div className="fact">
          <b>{club.fanSize}</b>
          <span>
            <Tip label="Fan base" text={HELP.fanBase} />
          </span>
        </div>
      </div>

      <p className="muted" style={{ margin: 0 }}>{bio.text}</p>

      <div className="perk">
        <span className="ic">{perk.icon}</span>
        <div>
          <small>
            <Tip label="Club power-up" text={HELP.clubPerk} />
          </small>
          <strong>{perk.name}</strong>
          <p>{perk.description}</p>
        </div>
      </div>
      <div className="perk">
        <span className="ic">{pitch.icon}</span>
        <div>
          <small>
            <Tip label={`Pitch power-up · ${arena.name}`} text={`${HELP.pitchPerk} ${arena.traits[0]}`} />
          </small>
          <strong>{pitch.name}</strong>
          <p>{pitch.description}</p>
        </div>
      </div>

      <h2>Championships</h2>
      {titles.length ? (
        <div className="trophy-row">
          {titles.map((s) => (
            <span key={s} className="trophy">
              🏆 Season {s}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          No titles yet.{best ? ` Best finish: ${best.pos}${best.pos === 1 ? 'st' : best.pos === 2 ? 'nd' : best.pos === 3 ? 'rd' : 'th'} in season ${best.season}.` : ''}
        </p>
      )}

      <h2>Squad</h2>
      <div className="squad">
        {club.squad.map((id, i) => {
          const p = u.league.players[id];
          if (!p) return null;
          const { tier } = cardRarity(u, p);
          return (
            <button key={id} className="card squad-row" onClick={() => showDetail({ kind: 'player', id })}>
              <span className="muted small">{p.position}</span>
              <span>
                {p.name}
                {i >= 5 && <span className="muted small"> · reserve</span>}
                {u.picks.back.includes(id) && <span className="pick-tag back">BACKED</span>}
                {u.picks.fade.includes(id) && <span className="pick-tag fade">FADED</span>}
                {u.injuries[id] ? <span className="pick-tag fade">INJ {u.injuries[id]}</span> : null}
              </span>
              <TierBadge tier={tier} />
            </button>
          );
        })}
      </div>

      {(legends.length > 0 || retired.length > 0) && (
        <>
          <h2>Club legends</h2>
          <ul className="feed">
            {legends.map(([id, l]) => (
              <li key={id} className="feed-item">
                <button className="link-btn" onClick={() => showDetail({ kind: 'player', id })}>
                  {u.league.players[id].name}
                </button>{' '}
                <span className="muted small">
                  {l.goals}G {l.assists}A in {l.apps}
                </span>
              </li>
            ))}
            {retired.map((r) => (
              <li key={r.player.id} className="feed-item muted">
                {r.player.name} <span className="small">· retired season {r.season}, age {r.age}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {club.id !== u.favoriteClubId && (
        <div>
          {!confirm ? (
            <button className="btn" disabled={!switchable} onClick={() => setConfirm(true)}>
              {switchable ? `Support the ${club.name} instead` : 'You already switched clubs this season'}
            </button>
          ) : (
            <div className="card callout" role="alertdialog" aria-labelledby="switch-h" style={{ padding: 14 }}>
              <p id="switch-h" style={{ marginTop: 0 }}>
                <strong>Switch to the {club.name}?</strong> Your {u.coins} credibility stays with your old fan base, and you can't switch again this season.
              </p>
              <div className="row">
                <button className="btn primary" onClick={() => void dispatch({ type: 'clubSwitched', clubId: club.id })}>
                  Switch
                </button>
                <button className="btn" onClick={() => setConfirm(false)}>
                  Stay
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Player

const STAT_HELP = {
  apps: 'Appearances: matches they played in, starting or off the bench.',
  goals: 'Goals scored (Spot Kicks and penalties included).',
  assists: 'Assists: the pass or long ball right before a goal.',
  saves: 'Saves: shots on target the keeper stopped.',
  cleanSheets: 'Clean sheets: matches the keeper started without conceding.',
};

/** The career arc as bars from 17 to 36, with "now" highlighted. */
function CareerArc({ age }: { age: number }) {
  const ages = Array.from({ length: 20 }, (_, i) => 17 + i);
  return (
    <div>
      <div className="arc" aria-hidden="true">
        {ages.map((a) => (
          <span key={a} className={a === age ? 'now' : ''} style={{ height: `${30 + ageRatingOffset(a) * 7}%` }} />
        ))}
      </div>
      <div className="arc-labels">
        <span>17</span>
        <span>Prime 24–28</span>
        <span>36</span>
      </div>
    </div>
  );
}

export function PlayerCard({ p, u }: { p: SoccerPlayer; u: SoccerUniverse }) {
  const { dispatch, showDetail } = useAssembly();
  const groups: SoccerStarGroup[] = p.position === 'K' ? ['keeping', 'defense', 'playmaking', 'engine'] : ['attack', 'playmaking', 'defense', 'engine'];
  const sig = getSignature(p.signatureId);
  const traits = (u.mods[p.id] ?? []).map((m) => ({ m, def: soccerMod(m.id) })).filter((x) => x.def);
  const bonds = Object.entries(p.bonds ?? {}).filter(([, n]) => n >= 3).map(([id]) => u.league.players[id]?.name).filter(Boolean);
  const rivals = Object.entries(p.rivals ?? {}).filter(([, n]) => n >= 3).map(([id]) => u.league.players[id]?.name).filter(Boolean);
  const age = u.ages[p.id] ?? initialAge(p.id);
  const phase = careerPhase(age);
  const club = clubOf(u, p.teamId);
  const rarity = cardRarity(u, p);
  const flavor = playerFlavor(p.id);
  const collected = u.collection.some((c) => c.playerId === p.id);
  const seasons = [
    ...Object.entries(u.statsBySeason).map(([s, lines]) => ({ season: Number(s), line: lines[p.id] })),
    { season: u.season, line: u.seasonStats[p.id] },
  ].filter((x) => x.line);
  const career = u.careerStats[p.id];
  const cap = u.captaincy[p.id];
  return (
    <div className={`card pcard t-${rarity.tier} ${p.awakened ? 'awakened' : ''}`}>
      <div className="profile-hero">
        {club && <Crest team={club} size={52} />}
        <div className="hero-text">
          <p className="eyebrow">
            {POSITION_LABEL[p.position]} ·{' '}
            {club ? (
              <button className="link-btn" onClick={() => showDetail({ kind: 'club', id: club.id })}>
                {club.name}
              </button>
            ) : (
              'Unattached'
            )}
          </p>
          <h2>{p.name}</h2>
          {p.catchphrase && <p className="muted small" style={{ margin: '2px 0 0' }}>“{p.catchphrase}”</p>}
        </div>
      </div>

      <div className="row" style={{ alignItems: 'center' }}>
        <Tip label="Rarity" text={`${HELP.rarity} ${rarity.why.length ? `This card: ${rarity.why.join(', ')}.` : ''}${rarity.next ? ` ${rarity.next.at - rarity.score} more to ${TIER_LABEL[rarity.next.tier]}.` : ''}`}>
          <TierBadge tier={rarity.tier} />
        </Tip>
        <span className="drive-chip">
          {DRIVE_INFO[p.drive].icon} {DRIVE_INFO[p.drive].label}
        </span>
        <button className={`chip ${collected ? '' : ''}`} aria-pressed={collected} onClick={() => void dispatch({ type: 'cardToggled', playerId: p.id })}>
          {collected ? '★ In your collection' : '☆ Collect card'}
        </button>
      </div>

      <div className="facts">
        <div className="fact">
          <b>{age}</b>
          <span>Age</span>
        </div>
        <div className="fact">
          <b>{u.experience[p.id] ?? 0}</b>
          <span>Seasons</span>
        </div>
        <div className="fact">
          <b>{PHASE_LABEL[phase].replace('In their ', '')}</b>
          <span>
            <Tip label="Career" text={HELP.career} />
          </span>
        </div>
      </div>
      <CareerArc age={age} />

      <div className="star-groups">
        {groups.map((g) => (
          <span key={g} style={{ display: 'contents' }}>
            <span className="muted">
              <Tip label={GROUP_LABEL[g]} text={GROUP_HELP[g]} />
            </span>
            <Stars value={soccerStars(p, g)} label={GROUP_LABEL[g]} />
          </span>
        ))}
      </div>

      <p className="small muted" style={{ margin: 0 }}>
        {DRIVE_INFO[p.drive].text}{' '}
        <Tip label="Drive" text="A player's Drive is their personality on the floor: how often they shoot, pass or dribble, and when they're at their best. It only changes if they Awaken or return from the Sub-Levels." />
      </p>

      {sig && (
        <div className="trait">
          <span className="ic">★</span>
          <div>
            <strong>{sig.name}</strong>
            <p>Signature move: {sig.text}. Fires at most twice a match.</p>
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 6 }}>
        <Tip label={`Traits & gifts (${traits.length})`} text={HELP.traits} />
      </h3>
      {traits.length ? (
        <div className="stack">
          {traits.map(({ m, def }) => {
            const combos = combosWith(m.id);
            return (
              <div key={m.id + m.season} className="trait">
                <span className="ic">{def!.icon}</span>
                <div>
                  <strong>{def!.name}</strong> <span className="muted small">{m.untilDay === null ? '· permanent' : `· until day ${m.untilDay}`}</span>
                  <p>{def!.description}</p>
                  {combos.map((c) => {
                    const other = c.needs.find((x) => x !== m.id)!;
                    return (
                      <p key={c.result} className="combo">
                        ✦ With {soccerMod(other)?.name}: fuses into {soccerMod(c.result)?.name}
                      </p>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>No traits yet. The facility hands out gifts as the season goes on.</p>
      )}
      {p.awakened && <p style={{ margin: 0, color: 'var(--gold)' }}>✷ Awakened in season {p.awakened.seasonId}.</p>}
      {bonds.length > 0 && <p className="small" style={{ margin: 0 }}>Bonds: {bonds.join(', ')}</p>}
      {rivals.length > 0 && <p className="small" style={{ margin: 0 }}>Rivals: {rivals.join(', ')}</p>}
      {cap && <p className="small muted" style={{ margin: 0 }}>Captained {cap.total}× {cap.streak >= 5 ? '· Fan Favorite' : ''}</p>}

      <h3 style={{ marginTop: 6 }}>Career stats</h3>
      {seasons.length ? (
        <table className="season-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>
                <Tip label="Apps" text={STAT_HELP.apps} />
              </th>
              <th>{p.position === 'K' ? <Tip label="Saves" text={STAT_HELP.saves} /> : <Tip label="G" text={STAT_HELP.goals} />}</th>
              <th>{p.position === 'K' ? <Tip label="CS" text={STAT_HELP.cleanSheets} /> : <Tip label="A" text={STAT_HELP.assists} />}</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map(({ season, line }) => (
              <tr key={season}>
                <td>S{season}</td>
                <td>{line!.apps}</td>
                <td>{p.position === 'K' ? line!.saves : line!.goals}</td>
                <td>{p.position === 'K' ? line!.cleanSheets : line!.assists}</td>
              </tr>
            ))}
            {career && seasons.length > 1 && (
              <tr>
                <td><strong>Career</strong></td>
                <td>{career.apps}</td>
                <td>{p.position === 'K' ? career.saves : career.goals}</td>
                <td>{p.position === 'K' ? career.cleanSheets : career.assists}</td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>No matches yet.</p>
      )}

      <p className="small muted" style={{ margin: 0 }}>
        {flavor.dorm} {flavor.fact}
      </p>

      <PickButtons p={p} u={u} />
    </div>
  );
}

/** Back or fade a player: credibility when a backed player delivers, or a faded one flops. */
function PickButtons({ p, u }: { p: SoccerPlayer; u: SoccerUniverse }) {
  const { dispatch } = useAssembly();
  const backed = u.picks.back.includes(p.id);
  const faded = u.picks.fade.includes(p.id);
  const keeper = p.position === 'K';
  const backText = keeper
    ? `Each match: +${PICK_RATES.cleanSheet} for a clean sheet, +${PICK_RATES.save} per save, +${PICK_RATES.goal} per goal.`
    : `Each match: +${PICK_RATES.goal} per goal, +${PICK_RATES.assist} per assist.`;
  const fadeText = keeper ? `Each match they concede 4 or more: +${PICK_RATES.fadeLeaky} for every goal past 3.` : `Each match they play without a goal or assist: +${PICK_RATES.fadeBlank}.`;
  const backErr = backed ? null : pickError(u, p.id, 'back');
  const fadeErr = faded ? null : pickError(u, p.id, 'fade');
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="pick-btns">
        <button className="chip" aria-pressed={backed} disabled={!!backErr} title={backErr ?? undefined} onClick={() => void dispatch({ type: 'pickSet', playerId: p.id, kind: backed ? null : 'back' })}>
          {backed ? '★ Backed' : 'Back'}
        </button>
        <button className="chip fade" aria-pressed={faded} disabled={!!fadeErr} title={fadeErr ?? undefined} onClick={() => void dispatch({ type: 'pickSet', playerId: p.id, kind: faded ? null : 'fade' })}>
          {faded ? '✕ Faded' : 'Fade'}
        </button>
        <Tip label="Picks" text={`Back up to ${BACK_SLOTS} players and fade up to ${FADE_SLOTS}. Credibility for being right: Back — ${backText} Fade — ${fadeText}`} />
      </div>
      <span className="small muted">
        Backing {u.picks.back.length}/{BACK_SLOTS} · Fading {u.picks.fade.length}/{FADE_SLOTS}
      </span>
    </div>
  );
}

export function PlayerPage({ playerId }: { playerId: string }) {
  const u = useAssembly((s) => s.u)!;
  const { showDetail } = useAssembly();
  const p = u.league.players[playerId] ?? u.vanished.find((v) => v.player.id === playerId)?.player ?? u.retired.find((r) => r.player.id === playerId)?.player;
  return (
    <section className="stack">
      <button className="link-btn" onClick={() => showDetail(p && clubOf(u, p.teamId) ? { kind: 'club', id: p.teamId } : null)}>
        ← Back
      </button>
      {p ? <PlayerCard p={p} u={u} /> : <p className="muted">No record of this player.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Collection

export function Collection() {
  const u = useAssembly((s) => s.u)!;
  const { showDetail } = useAssembly();
  if (!u.collection.length) {
    return (
      <p className="muted small">
        Open any player and tap “Collect card”. <Tip label="About the collection" text={HELP.collection} />
      </p>
    );
  }
  return (
    <div className="collection">
      {u.collection.map((c) => {
        const live = u.league.players[c.playerId];
        const p = live ?? u.retired.find((r) => r.player.id === c.playerId)?.player ?? u.vanished.find((v) => v.player.id === c.playerId)?.player;
        if (!p) return null;
        const { tier } = cardRarity(u, p);
        const club = clubOf(u, p.teamId);
        return (
          <button key={c.playerId} className={`mini-card t-${tier} ${live ? '' : 'gone'}`} onClick={() => showDetail({ kind: 'player', id: p.id })}>
            <TierBadge tier={tier} />
            <span className="name">{p.name}</span>
            <span className="club">
              {POSITION_LABEL[p.position]} · {club?.name ?? (u.retired.some((r) => r.player.id === p.id) ? 'Retired' : 'Sub-Levels')}
            </span>
            <span className="small muted">
              {DRIVE_INFO[p.drive].icon} {DRIVE_INFO[p.drive].label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
