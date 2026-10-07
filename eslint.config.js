import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Determinism: all randomness must come from the seeded RNG in src/engine/core/rng.ts
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded RNG (src/engine/core/rng.ts).' }],
    },
  },
  {
    files: ['scripts/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }, // scripts drive a headless browser
  },
  {
    // The engine and world generator are pure: no UI, storage, or worker imports.
    files: ['src/engine/**', 'src/world/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/ui/**', '**/storage/**', '**/worker/**', 'react', 'react-dom', 'zustand'] }],
    },
  },
);
