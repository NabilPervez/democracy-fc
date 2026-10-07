// Generates every PWA graphic from scripts/brand.mjs using headless Chrome:
//   icons (any / maskable / monochrome / apple-touch / favicons + .ico), shortcut icons,
//   iOS launch screens (and their <link> tags in index.html), and the social share image.
// Usage: node scripts/make-pwa-assets.mjs   (set CHROME_PATH if Chrome isn't in the default place)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { iconSvg, ogHtml, shortcutSvg, SPLASH_DEVICES, splashHtml } from './brand.mjs';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const tab = await browser.newPage();

async function renderSvg(svg, size, file, { transparent = false } = {}) {
  await tab.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await tab.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`).replace('width="96" height="96"', `width="${size}" height="${size}"`)}</body></html>`);
  return tab.screenshot({ path: file, type: 'png', omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
}

// Fonts are downloaded once and inlined, so rendering never waits on the network.
async function fontCss() {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  const css = await (await fetch('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=block', { headers: { 'User-Agent': ua } })).text();
  let out = css;
  for (const url of new Set(css.match(/https:[^)]+.woff2/g) ?? [])) {
    const b64 = Buffer.from(await (await fetch(url)).arrayBuffer()).toString('base64');
    out = out.split(url).join(`data:font/woff2;base64,${b64}`);
  }
  return out;
}
const FONT_CSS = await fontCss();

async function renderHtml(html, w, h, dpr, file) {
  await tab.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
  const inlined = html.replace(/<link[^>]*fonts.g[^>]*>/g, '').replace('</head>', `<style>${FONT_CSS}</style></head>`);
  await tab.setContent(inlined, { waitUntil: 'load' });
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: file, type: 'png' });
}

mkdirSync('public/icons', { recursive: true });
mkdirSync('public/splash', { recursive: true });

// Master SVGs (also served, e.g. as the favicon).
writeFileSync('public/favicon.svg', iconSvg({ rounded: true }));
writeFileSync('public/icons/icon.svg', iconSvg({ rounded: true }));
writeFileSync('public/icons/icon-maskable.svg', iconSvg({ maskable: true }));
writeFileSync('public/icons/icon-mono.svg', iconSvg({ mono: true }));

// App icons.
for (const size of [72, 96, 128, 144, 152, 192, 256, 384, 512]) await renderSvg(iconSvg({ rounded: true }), size, `public/icons/icon-${size}.png`, { transparent: true });
for (const size of [192, 512]) await renderSvg(iconSvg({ maskable: true }), size, `public/icons/maskable-${size}.png`);
await renderSvg(iconSvg({ mono: true }), 512, 'public/icons/monochrome-512.png', { transparent: true });
// Apple touch icon: iOS adds its own rounding, so use the full-bleed variant.
await renderSvg(iconSvg({ maskable: true }), 180, 'public/apple-touch-icon.png');
for (const size of [16, 32, 48]) await renderSvg(iconSvg({ rounded: true }), size, `public/icons/favicon-${size}.png`, { transparent: true });

// favicon.ico: an ICO container holding the 16/32/48 PNGs.
{
  const pngs = [16, 32, 48].map((s) => [s, readFileSync(`public/icons/favicon-${s}.png`)]);
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(([size, buf], i) => {
    const o = 6 + i * 16;
    header.writeUInt8(size, o);
    header.writeUInt8(size, o + 1);
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(buf.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  writeFileSync('public/favicon.ico', Buffer.concat([header, ...pngs.map(([, b]) => b)]));
}

// Shortcut icons.
for (const g of ['today', 'games', 'vote', 'history']) await renderSvg(shortcutSvg(g), 96, `public/icons/shortcut-${g}.png`);

// Social share card.
await renderHtml(ogHtml(), 1200, 630, 1, 'public/og-image.png');

// iOS launch screens + their <link> tags.
const links = [];
for (const d of SPLASH_DEVICES) {
  const file = `splash/${d.name}-${d.w * d.dpr}x${d.h * d.dpr}.png`;
  await renderHtml(splashHtml(d.w, d.h), d.w, d.h, d.dpr, `public/${file}`);
  links.push(
    `    <link rel="apple-touch-startup-image" href="/${file}" media="(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)" />`,
  );
}
const index = readFileSync('index.html', 'utf8');
const start = '    <!-- splash:start -->';
const end = '    <!-- splash:end -->';
const before = index.slice(0, index.indexOf(start) + start.length);
const after = index.slice(index.indexOf(end));
if (index.includes(start) && index.includes(end)) writeFileSync('index.html', `${before}\n${links.join('\n')}\n${after}`);
else console.warn('index.html has no splash markers; launch screen links not written');

await browser.close();
console.log(`assets written: ${SPLASH_DEVICES.length} launch screens, icons, favicon.ico, og-image.png`);
