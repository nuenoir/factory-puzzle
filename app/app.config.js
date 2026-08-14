/**
 * Expo config. Replaces app.json so the web base URL can come from the
 * environment.
 *
 * GitHub Pages serves a project site from `/<repo>/`, not from the root, so
 * every asset path needs that prefix — but only in the deployed build. Local
 * dev and `npm run web` leave EXPO_BASE_URL unset and serve from `/`.
 */
module.exports = {
  expo: {
    name: 'Factory Puzzle',
    slug: 'factory-puzzle',
    version: '0.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    platforms: ['web', 'android'],
    web: {
      bundler: 'metro',
      output: 'single',
    },
    android: {
      package: 'com.bagus.factorypuzzle',
      // Play orders releases by this integer, not by `version`. It must rise on
      // every upload and can never be reused, even after a rejected build.
      versionCode: 1,
      /**
       * Declared empty on purpose, not left to inference: the app uses no
       * camera, location, storage or anything else Play asks about.
       *
       * The React Native template still adds INTERNET, which this app never
       * uses — it makes no requests, bundles its puzzles, and computes the daily
       * mapping on device. Removing it via `blockedPermissions` is the right end
       * state and is *not* done here, because it cannot be verified without a
       * real device build and a config that breaks the runtime is worse than one
       * that over-declares. See docs/release-checklist.md.
       */
      permissions: [],
    },
    experiments: {
      baseUrl: process.env.EXPO_BASE_URL ?? '',
    },
  },
}
