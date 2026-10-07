// Democracy FC brand artwork as code, so every icon, splash and share card comes from one design.
// Mark: a gold club shield on pitch green, carrying a ballot check whose tip is a ball — vote + football club.

export const COLORS = {
  base: '#F7F5F0',
  surface: '#0C1D13',
  green: '#1E9E57',
  greenDeep: '#0B3D23',
  gold: '#F2C230',
  goldDeep: '#B8860B',
  text: '#1B1F2A',
  muted: '#5F6675',
};

const SHIELD = 'M256 92 L388 136 C388 252 352 344 256 412 C160 344 124 252 124 136 Z';
const CHECK = 'M186 250 L238 300 L318 196';

/**
 * The app icon.
 * - rounded: rounded-square badge (favicons, "any" icons)
 * - maskable: full-bleed background, artwork inside the 80% safe zone
 * - mono: single-colour silhouette on transparent (monochrome / themed icons)
 */
export function iconSvg({ rounded = true, maskable = false, mono = false } = {}) {
  const scale = maskable ? 0.8 : 1;
  const t = (256 * (1 - scale)).toFixed(2);
  if (mono) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <defs><mask id="m"><rect width="512" height="512" fill="black"/><path d="${SHIELD}" fill="white"/>
      <path d="${CHECK}" fill="none" stroke="black" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="330" cy="182" r="26" fill="black"/></mask></defs>
    <rect width="512" height="512" fill="#FFFFFF" mask="url(#m)"/>
  </svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <defs>
      <linearGradient id="pitch" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${COLORS.green}"/><stop offset="1" stop-color="${COLORS.greenDeep}"/>
      </linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFE07A"/><stop offset="0.55" stop-color="${COLORS.gold}"/><stop offset="1" stop-color="${COLORS.goldDeep}"/>
      </linearGradient>
      <clipPath id="clip"><rect width="512" height="512" ${rounded && !maskable ? 'rx="112"' : ''}/></clipPath>
    </defs>
    <g clip-path="url(#clip)">
      <rect width="512" height="512" fill="url(#pitch)"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="0" y="${i * 86}" width="512" height="43" fill="#ffffff" opacity="0.05"/>`).join('')}
    </g>
    <g transform="translate(${t} ${t}) scale(${scale})">
      <path d="${SHIELD}" fill="#000" opacity="0.3" transform="translate(0 10)"/>
      <path d="${SHIELD}" fill="url(#gold)"/>
      <path d="${SHIELD}" fill="none" stroke="#FFF3C4" stroke-opacity="0.6" stroke-width="6" transform="translate(256 252) scale(0.9) translate(-256 -252)"/>
      <path d="${CHECK}" fill="none" stroke="${COLORS.greenDeep}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="330" cy="182" r="26" fill="#FFFFFF" stroke="${COLORS.greenDeep}" stroke-width="8"/>
      <path d="M330 168 L342 177 L337 191 L323 191 L318 177 Z" fill="${COLORS.greenDeep}"/>
    </g>
  </svg>`;
}

/** Small glyph icons for app shortcuts (Bulletin / Matches / Vote / Archive). */
export function shortcutSvg(glyph) {
  const g = COLORS.gold;
  const glyphs = {
    today: `<rect x="24" y="26" width="48" height="44" rx="6" fill="none" stroke="${g}" stroke-width="6"/><path d="M33 42 H63 M33 54 H55" stroke="${g}" stroke-width="6" stroke-linecap="round"/>`,
    games: `<circle cx="48" cy="48" r="24" fill="none" stroke="${g}" stroke-width="6"/><path d="M48 36 L59 44 L55 57 L41 57 L37 44 Z" fill="${g}"/>`,
    vote: `<path d="M28 50 L42 64 L68 32" fill="none" stroke="${g}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
    history: `<path d="M30 22 H66 M30 74 H66 M34 22 C34 44, 62 52, 62 74 M62 22 C62 44, 34 52, 34 74" fill="none" stroke="${g}" stroke-width="6" stroke-linecap="round"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
    <rect width="96" height="96" rx="22" fill="${COLORS.greenDeep}"/>${glyphs[glyph]}</svg>`;
}

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800&family=Inter:wght@400;600&display=block" rel="stylesheet">`;

const page = (w, h, body, extraCss = '') => `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${COLORS.base};color:${COLORS.text};font-family:Inter,system-ui,sans-serif}
  .word{font-family:'Barlow Condensed',sans-serif;font-weight:800;letter-spacing:.02em;line-height:.9}
  .word span{color:${COLORS.green}}
  .glow{position:absolute;inset:0;background:radial-gradient(60% 45% at 50% 42%, rgba(30,158,87,.35), transparent 70%)}
  ${extraCss}
</style></head><body>${body}</body></html>`;

const mark = (size) => iconSvg({ rounded: true }).replace('width="512" height="512"', `width="${size}" height="${size}"`);

/** iOS launch screen: icon, wordmark and tagline, centred. Sizes are in CSS pixels. */
export function splashHtml(w, h) {
  const icon = Math.round(Math.min(w, h) * 0.34);
  const word = Math.round(Math.min(w, h) * 0.12);
  return page(
    w,
    h,
    `<div class="glow"></div>
     <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(word * 0.35)}px">
       <div style="width:${icon}px;height:${icon}px">${mark(icon)}</div>
       <div class="word" style="font-size:${word}px">DEMOCRACY <span>FC</span></div>
       <div style="color:${COLORS.muted};font-size:${Math.round(word * 0.28)}px;letter-spacing:.06em">VOTE CHAOS</div>
     </div>`,
  );
}

/** Social share card (Open Graph / Twitter), 1200×630. */
export function ogHtml() {
  return page(
    1200,
    630,
    `<div class="glow" style="background:radial-gradient(50% 70% at 22% 50%, rgba(30,158,87,.4), transparent 70%)"></div>
     <div style="position:absolute;inset:0;display:flex;align-items:center;gap:56px;padding:0 90px">
       <div style="width:300px;height:300px;flex:none">${mark(300)}</div>
       <div>
         <div class="word" style="font-size:104px;white-space:nowrap">DEMOCRACY <span>FC</span></div>
         <div style="font-size:38px;margin-top:18px;font-weight:600">The fans run the club. The facility runs the fans.</div>
         <div style="font-size:28px;margin-top:14px;color:${COLORS.muted}">Watch · Predict · Vote on every rule. Free, offline, in your browser.</div>
       </div>
     </div>`,
  );
}

/** iOS devices that need their own launch image (portrait). width/height in CSS px. */
export const SPLASH_DEVICES = [
  { name: 'iphone-16-pro-max', w: 440, h: 956, dpr: 3 },
  { name: 'iphone-16-pro', w: 402, h: 874, dpr: 3 },
  { name: 'iphone-15-pro-max', w: 430, h: 932, dpr: 3 },
  { name: 'iphone-15-pro', w: 393, h: 852, dpr: 3 },
  { name: 'iphone-14-plus', w: 428, h: 926, dpr: 3 },
  { name: 'iphone-14', w: 390, h: 844, dpr: 3 },
  { name: 'iphone-13-mini', w: 375, h: 812, dpr: 3 },
  { name: 'iphone-11-pro-max', w: 414, h: 896, dpr: 3 },
  { name: 'iphone-11', w: 414, h: 896, dpr: 2 },
  { name: 'iphone-8-plus', w: 414, h: 736, dpr: 3 },
  { name: 'iphone-se', w: 375, h: 667, dpr: 2 },
  { name: 'iphone-se-1', w: 320, h: 568, dpr: 2 },
  { name: 'ipad-pro-13', w: 1032, h: 1376, dpr: 2 },
  { name: 'ipad-pro-12-9', w: 1024, h: 1366, dpr: 2 },
  { name: 'ipad-pro-11', w: 834, h: 1194, dpr: 2 },
  { name: 'ipad-air', w: 820, h: 1180, dpr: 2 },
  { name: 'ipad-10-2', w: 810, h: 1080, dpr: 2 },
  { name: 'ipad-mini', w: 744, h: 1133, dpr: 2 },
  { name: 'ipad-9-7', w: 768, h: 1024, dpr: 2 },
];

/** Google Play feature graphic, 1024×500. */
export function featureGraphicHtml() {
  return page(
    1024,
    500,
    `<div class="glow" style="background:radial-gradient(55% 75% at 20% 50%, rgba(30,158,87,.4), transparent 70%)"></div>
     <div style="position:absolute;inset:0;display:flex;align-items:center;gap:44px;padding:0 70px">
       <div style="width:250px;height:250px;flex:none">${mark(250)}</div>
       <div>
         <div class="word" style="font-size:104px">DEMOCRACY <span>FC</span></div>
         <div style="font-size:31px;margin-top:16px;font-weight:600">The fans run the club.</div>
         <div style="font-size:24px;margin-top:12px;color:${COLORS.muted}">Watch · Predict · Vote</div>
       </div>
     </div>`,
  );
}
