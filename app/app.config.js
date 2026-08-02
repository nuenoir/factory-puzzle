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
    },
    experiments: {
      baseUrl: process.env.EXPO_BASE_URL ?? '',
    },
  },
}
