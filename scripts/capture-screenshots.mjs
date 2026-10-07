// Captures the install-prompt screenshots (manifest `screenshots`) from the real production build.
// Usage: npm run build && node scripts/capture-screenshots.mjs   (set CHROME_PATH if Chrome isn't in the default place)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4181;
const URL = `http://localhost:${PORT}/`;
const OUT = 'public/screenshots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const server = spawn(`npx vite preview --port ${PORT} --strictPort`, { shell: true, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(URL)).ok) break;
  } catch {
    /* not up yet */
  }
  await sleep(500);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

/** Click the first button whose text matches. */
const click = (page, re) =>
  page.evaluate((src) => {
    const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent));
    b?.click();
    return !!b;
  }, re.source);

/** A fresh universe a week in, with a ballot open: through onboarding and creation like a new player. */
async function setUp(page) {
  await page.goto(URL, { waitUntil: 'networkidle0' });
  for (let i = 0; i < 4; i++) {
    await click(page, /^(Next|Pick a club)$/);
    await sleep(150);
  }
  await page.evaluate(() => {
    const name = document.querySelector('input');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(name, 'The Assembly');
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const seed = document.querySelectorAll('input')[1];
    set.call(seed, 'screens');
    seed.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  await page.evaluate(() => {
    const picks = document.querySelectorAll('.club-pick');
    picks[0].querySelectorAll('button')[0].click();
    picks[1].querySelectorAll('button')[2].click();
  });
  await sleep(200);
  await page.evaluate(() => document.querySelector('button[type=submit]').click());
  await sleep(1200);
  await click(page, /^Sim a week$/);
  await sleep(4000);
  await click(page, /^Got it$/);
  await sleep(300);
}

const tab = (page, label) => page.evaluate((l) => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes(l)).click(), label);

async function capture(name, viewport) {
  // A clean profile each time, so every capture starts as a brand-new player.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  await setUp(page);
  const shot = (file) => page.screenshot({ path: `${OUT}/${name}-${file}.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('bulletin');
  await click(page, /Watch your match/);
  await sleep(9000);
  await shot('match');
  await tab(page, 'Facility');
  await sleep(500);
  await shot('facility');
  await tab(page, 'Vote');
  await sleep(500);
  await shot('vote');
  await context.close();
}

await capture('phone', { width: 390, height: 844, deviceScaleFactor: 3 });
await capture('desktop', { width: 1920, height: 1200, deviceScaleFactor: 1 });

await browser.close();
server.kill();
console.log('screenshots written to', OUT);
process.exit(0);
