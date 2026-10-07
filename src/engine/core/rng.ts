/**
 * Seeded, deterministic randomness. The only source of randomness allowed in the engine
 * (Math.random is banned by lint). Uses integer math only, so results are identical across JS engines.
 */

/** cyrb128-style string hash → four 32-bit seeds. */
export function hashSeed(...parts: (string | number)[]): [number, number, number, number] {
  const str = parts.join('|');
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export interface Rng {
  /** Raw unsigned 32-bit integer. */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number;
  /** True with probability perMille / 1000. */
  chance(perMille: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/** sfc32 PRNG. */
export function createRng(...seedParts: (string | number)[]): Rng {
  let [a, b, c, d] = hashSeed(...seedParts);
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return r >>> 0;
  };
  // Warm up so similar seeds diverge quickly.
  for (let i = 0; i < 15; i++) next();
  const int = (n: number) => (n <= 0 ? 0 : next() % n);
  return {
    next,
    int,
    range: (min, max) => min + int(max - min + 1),
    chance: (perMille) => int(1000) < perMille,
    pick: (items) => items[int(items.length)],
  };
}
