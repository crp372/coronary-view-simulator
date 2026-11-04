// Screenshot checks of the standard views: `npm run check`, or `npm run check:update` after an intended change.
// Serves the folder with Python, as for normal use. Reduced motion freezes the image: no preset tweens, the
// automatic brightness settles at once, and the quantum noise uses one fixed frame.
import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  timeout: 120_000,
  workers: 1,
  reporter: [['list'], ['html', {open: 'never'}]],
  expect: {toHaveScreenshot: {maxDiffPixelRatio: 0.002, threshold: 0.12, animations: 'disabled', caret: 'hide'}},
  use: {
    baseURL: 'http://localhost:8767/',
    viewport: {width: 1280, height: 900},
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  },
  webServer: {command: 'python3 -m http.server 8767', url: 'http://localhost:8767/', reuseExistingServer: true},
});
