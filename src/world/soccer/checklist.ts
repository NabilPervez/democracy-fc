import type { SoccerUniverse } from './universe';

export type ChecklistTab = 'bulletin' | 'matches' | 'facility' | 'vote';

/**
 * "Before your first few games" checklist. Every step is read from the save itself, so it ticks
 * off the moment the fan does the thing — wherever they did it — and needs no tracking of its own.
 */

export interface ChecklistStep {
  id: string;
  title: string;
  why: string;
  done: boolean;
  /** Where "Show me" takes the fan. */
  tab: ChecklistTab;
}

export const CHECKLIST_REWARD = 50;

export function gettingStarted(u: SoccerUniverse): ChecklistStep[] {
  const ballots = Object.values(u.ballots);
  const votedTactic = ballots.some((b) => b.tactic.some((n) => n > 0));
  const votedCaptain = ballots.some((b) => b.captain.some((n) => n > 0));
  const predicted = u.bets.length > 0;
  const watched = u.started.length > 0;
  const backed = u.picks.back.length > 0;
  const faded = u.picks.fade.length > 0;
  const electionVote = u.elections.some((e) => e.playerVotes.some((n) => n > 0));
  return [
    { id: 'tactic', title: 'Vote on your club’s tactic', why: 'Before every match, fans pick how the club plays. Your first vote each match is free.', done: votedTactic, tab: 'bulletin' },
    { id: 'captain', title: 'Vote for a captain', why: 'The captain gets a composure boost and takes the penalties. If they deliver, you gain credibility.', done: votedCaptain, tab: 'bulletin' },
    { id: 'predict', title: 'Make a call', why: 'Call the result — it’s free. Right calls build credibility, the fan reputation you spend on votes.', done: predicted, tab: 'bulletin' },
    { id: 'watch', title: 'Watch a match', why: 'See the arena, the phases of play and the log. Key Moments speed skips the quiet bits.', done: watched, tab: 'matches' },
    { id: 'back', title: 'Back a player', why: 'Backed players build your credibility every time they score, assist or keep a clean sheet.', done: backed, tab: 'facility' },
    { id: 'fade', title: 'Fade a player', why: 'Faded players build your credibility when they flop. Pick someone you expect to have a bad week.', done: faded, tab: 'facility' },
    { id: 'elect', title: 'Vote in a facility election', why: 'Every club’s fans vote on the rules. Your votes join your club’s bloc — push the ones marked “Helps your club”.', done: electionVote, tab: 'vote' },
  ];
}

export const checklistDone = (u: SoccerUniverse) => gettingStarted(u).every((s) => s.done);
