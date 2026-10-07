import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const icon = (src: string, sizes: string, purpose?: string, type = 'image/png') => ({ src, sizes, type, ...(purpose ? { purpose } : {}) });

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Ask before swapping in a new version, so a player is never reloaded mid-game.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        id: '/',
        name: 'Democracy FC — Vote Chaos',
        short_name: 'Democracy FC',
        description: 'A sealed soccer facility whose league plays itself. Watch, predict, and vote on how it is played — free, offline, in your browser.',
        lang: 'en',
        dir: 'ltr',
        start_url: '/?source=pwa',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'any',
        theme_color: '#F7F5F0',
        background_color: '#F7F5F0',
        categories: ['games', 'sports', 'entertainment'],
        prefer_related_applications: false,
        launch_handler: { client_mode: ['focus-existing', 'auto'] },
        icons: [
          icon('/icons/icon-72.png', '72x72'),
          icon('/icons/icon-96.png', '96x96'),
          icon('/icons/icon-128.png', '128x128'),
          icon('/icons/icon-144.png', '144x144'),
          icon('/icons/icon-152.png', '152x152'),
          icon('/icons/icon-192.png', '192x192'),
          icon('/icons/icon-256.png', '256x256'),
          icon('/icons/icon-384.png', '384x384'),
          icon('/icons/icon-512.png', '512x512'),
          icon('/icons/icon.svg', 'any', 'any', 'image/svg+xml'),
          icon('/icons/maskable-192.png', '192x192', 'maskable'),
          icon('/icons/maskable-512.png', '512x512', 'maskable'),
          icon('/icons/monochrome-512.png', '512x512', 'monochrome'),
        ],
        shortcuts: [
          { name: 'Bulletin', short_name: 'Bulletin', description: 'The Director, your Matchday Ballot and your coins', url: '/?tab=bulletin&source=shortcut', icons: [icon('/icons/shortcut-today.png', '96x96')] },
          { name: 'Matches', short_name: 'Matches', description: 'Watch a match live', url: '/?tab=matches&source=shortcut', icons: [icon('/icons/shortcut-games.png', '96x96')] },
          { name: 'Vote', short_name: 'Vote', description: 'The current facility election', url: '/?tab=vote&source=shortcut', icons: [icon('/icons/shortcut-vote.png', '96x96')] },
          { name: 'Archive', short_name: 'Archive', description: 'Seasons, the timeline and the Sub-Level Archive', url: '/?tab=archive&source=shortcut', icons: [icon('/icons/shortcut-history.png', '96x96')] },
        ],
        screenshots: [
          { src: '/screenshots/phone-bulletin.png', sizes: '1170x2532', type: 'image/png', form_factor: 'narrow', label: 'The Bulletin: the Director, your Matchday Ballot and predictions' },
          { src: '/screenshots/phone-match.png', sizes: '1170x2532', type: 'image/png', form_factor: 'narrow', label: 'Watch 5-a-side matches live in a walled arena' },
          { src: '/screenshots/phone-facility.png', sizes: '1170x2532', type: 'image/png', form_factor: 'narrow', label: 'The table, the Ejection line and every club' },
          { src: '/screenshots/phone-vote.png', sizes: '1170x2532', type: 'image/png', form_factor: 'narrow', label: 'Vote on the facility rules with every other fan base' },
          { src: '/screenshots/desktop-bulletin.png', sizes: '1920x1200', type: 'image/png', form_factor: 'wide', label: 'Democracy FC on desktop' },
          { src: '/screenshots/desktop-match.png', sizes: '1920x1200', type: 'image/png', form_factor: 'wide', label: 'Live pitch and play log' },
        ],
      },
      workbox: {
        // The app shell and icons are precached. Launch screens and store screenshots are large
        // and only needed once, so they're fetched on demand instead.
        globPatterns: ['**/*.{js,css,html,svg,ico,webmanifest}', 'icons/*.png', 'apple-touch-icon.png'],
        globIgnores: ['splash/**', 'screenshots/**', 'og-image.png'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/(splash|screenshots|icons)\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Google Fonts, so text keeps its look offline.
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/splash/'),
            handler: 'CacheFirst',
            options: { cacheName: 'launch-screens', expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  // Season-length simulation tests (baseball and soccer) run in parallel; 5s is too tight under load.
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
});
