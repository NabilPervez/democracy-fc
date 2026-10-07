/** Prediction markets: chances in per mille, reward multipliers in thousandths (1900 = 1.90×) with a 5% margin. */
export interface Odds {
  homePm: number;
  awayPm: number;
  drawPm: number;
  homeMult: number;
  awayMult: number;
  drawMult: number;
}

export const multiplierFor = (pm: number) => Math.floor(950_000 / Math.max(1, pm));

export const formatMult = (milli: number) => `${(milli / 1000).toFixed(2)}×`;
