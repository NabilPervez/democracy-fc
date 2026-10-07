import { describe, expect, it } from 'vitest';

/** PRD §B12: no borrowed names, terms or cast archetypes may ship in code, content or UI. */
const files = {
  ...import.meta.glob('../content/**/*.json', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../src/**/*.{ts,tsx,css}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../index.html', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

const BANNED = [/blue\s*lock/i, /egoist/i, /\bego\b/i, /neo\s*egoist/i, /blaseball/i, /jinpachi/i, /isagi/i, /bachira/i, /itoshi/i];

describe('IP review (§B12)', () => {
  it('no banned names or terms anywhere in shipped code, content or HTML', () => {
    expect(Object.keys(files).length).toBeGreaterThan(30);
    for (const [file, text] of Object.entries(files)) for (const re of BANNED) expect(re.test(text), `${file} matches ${re}`).toBe(false);
  });
});
