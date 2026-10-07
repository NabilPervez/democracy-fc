/**
 * Plain-language explanations shown in "?" tooltips across the game, for fans who skip the intro.
 * One place, so the wording stays consistent.
 */
export const HELP = {
  coins: 'Coins are earned, never bought. You get some every day, more when your club wins, and from good predictions, backed players and captains who deliver. Spend them on extra votes.',
  director: 'The Director runs The Assembly. Their announcements tell you what the facility just changed: rules the fans voted in, strange events, players taken to the Sub-Levels.',
  ballot: 'Every club is run by its fans. Before each of your club’s matches you vote on how they play (tactic) and who leads them (captain). Skip it and the other fans decide.',
  tactic: 'A one-match game plan. Each boosts some ratings and weakens others. Some tactics counter others (shown as “Beats …”) for an extra edge. Your first vote is free; more votes cost coins.',
  scouting: 'What the other club’s fans are leaning toward. Pick a tactic that beats theirs.',
  leanBar: 'The bar shows how your club’s other fans are voting right now. The option with the most votes at kickoff wins.',
  captain: 'The captain gets +6 composure, their personality is amplified, and they take penalties. If they score, assist or keep a clean sheet, fans who backed them earn coins.',
  prediction: 'Stake coins on the result. The % is the chance the facility gives it; the × is what a correct call pays back (10 coins at 2.00× returns 20).',
  morePredictions: 'Extra markets: will both teams score, will there be more or fewer than 5.5 goals, and who scores first. Riskier picks pay more.',
  election: 'Every week the fans of every club vote on the facility’s rules. Each club votes for what helps it. Your votes join your club’s bloc.',
  helpsHurts: 'Whether this rule suits your club’s players and style. Rules that help your club are worth pushing.',
  coalition: 'Which clubs and fan factions are leaning toward this proposal. The one with the most votes when the week ends wins.',
  voteCost: 'Votes get pricier the more you buy on one proposal: 1 vote costs 2 coins, 2 cost 8, 3 cost 18. A few votes go a long way in a close race.',
  picks: 'Back players to earn coins when they score, assist or keep clean sheets. Fade players to earn when they flop. Open any player from a club page to pick them.',
  table: 'Clubs above the gold line reach the playoffs. Clubs below the red dashed line are Ejected from the facility at the end of the season.',
  style: 'A club’s long-term identity: how it likes to attack and defend. It only changes through events and elections. Tactics that fit the Style avoid a small penalty.',
  fanBase: 'How many fans the club has. Bigger fan bases cast more votes in elections and on matchday ballots.',
  arena: 'Every club has a home arena with its own walls and quirks — some make banked shots stronger, some tire players faster.',
  bracket: 'The playoffs: knockout matches, best seed against worst. Draws go to a penalty shootout. The last club standing is champion.',
  speed: 'How fast the match plays. Key Moments skips to shots, goals, cards and facility events. Instant jumps to the final whistle.',
  phases: 'What each side is doing right now. The team with the ball builds up, progresses and creates chances; the other defends in a high, mid or low block. Transitions happen the moment the ball changes hands.',
  fouls: 'Team fouls this half. From a team’s 6th foul, every foul gives the other side a Spot Kick from 10 metres with no wall.',
  possession: 'Each possession starts with a kick-off, a keeper restart or a turnover. Tap any log line to jump the arena there.',
  momentum: 'Momentum swings after goals, big saves and cards, and gives the side that has it a small boost. It fades over time.',
  subLevels: 'Players who vanished into the facility’s lower levels. They can only return if the fans vote them back — and they come back changed.',
  awakening: 'A rare moment when a player scores under pressure and permanently changes: a big rating jump and sometimes a new personality.',
  checklist: 'A few things to try in your first games. Each one ticks itself off when you do it anywhere in the game.',
  persona: 'Your fan type. Each gives one small perk, like better rewards backing your own club or cheaper election votes. Change it in Settings.',
} as const;
