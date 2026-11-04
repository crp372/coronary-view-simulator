// Screenshot checks: every standard view, the overlays and the room, compared against tests/baselines/.
// One page per file: loading the CT takes a few seconds, so the views are shown one after another on it.
// WebGL runs in SwiftShader (software), so the images are the same on any machine.
import {test, expect} from '@playwright/test';

test.describe.configure({mode: 'serial'});
test.use({launchOptions: {args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']}});

// the presets as the page lists them (index.html PRESETS); file names say side, then the view
const PRESETS = [
  ['L', 'RAO caudal'], ['L', 'AP caudal'], ['L', 'LAO caudal (spider)'], ['L', 'RAO cranial'], ['L', 'AP cranial'],
  ['L', 'LAO cranial'], ['L', 'Left lateral'], ['R', 'LAO'], ['R', 'RAO'], ['R', 'LAO cranial'],
];
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let page;
const errors = [];

// opens a page and waits until its DRR (or fallback) is running and the fonts have loaded; hook: the page's
// window.sim (index.html) or window.drr (drr.html)
async function open(browser, path, hook = 'sim') {
  const p = await browser.newPage();
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(path);
  await p.waitForFunction(hook => window[hook] && window[hook].ready, hook);
  await p.evaluate(hook => Promise.all([window[hook].ready, document.fonts.ready]), hook);
  p.hook = hook;
  return p;
}
// renders one frame at a fixed clock, so noise and motion are the same every run
const frame = (p, at = 0) => p.evaluate(([hook, at]) => window[hook].frame(at), [p.hook, at]);
async function pressPreset(p, side, name) {
  await p.locator(`#presets${side} .pre`).filter({has: p.locator('.pn', {hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`)})}).click();
  await frame(p);
}
async function setToggle(p, id, on) {
  const b = p.locator('#' + id);
  if ((await b.getAttribute('aria-pressed')) !== String(on)) await b.click();
}

test.describe('index.html, CT image', () => {
  test.beforeAll(async ({browser}) => { page = await open(browser, '/'); });
  test.afterAll(async () => { await page.close(); expect(errors).toEqual([]); });

  test('starts in DRR mode', async () => {
    expect(await page.evaluate(() => window.sim.mode)).toBe('drr');
  });

  for (const [side, name] of PRESETS) {
    test(`preset ${side} ${name}`, async () => {
      await pressPreset(page, side, name);
      await expect(page.locator('#nowName')).toHaveText(name);
      await expect(page.locator('#monitor')).toHaveScreenshot(`index-${side}-${slug(name)}.png`);
    });
  }

  test('overlays, left', async () => {
    await pressPreset(page, 'L', 'RAO caudal');
    for (const id of ['tOvV', 'tOvC', 'tSegN']) await setToggle(page, id, true);
    await frame(page);
    await expect(page.locator('#monitor')).toHaveScreenshot('index-overlays-L-rao-caudal.png');
    await expect(page.locator('#ovLegend')).toHaveScreenshot('index-overlays-legend.png');
  });

  test('overlays, right', async () => {
    await pressPreset(page, 'R', 'LAO');
    await frame(page);
    await expect(page.locator('#monitor')).toHaveScreenshot('index-overlays-R-lao.png');
    for (const id of ['tOvV', 'tOvC', 'tSegN']) await setToggle(page, id, false);
  });

  // a cine run, stepped at 15 pulses/s like the real loop: filling at 1 s (heart in systole), full at 3 s
  test('cine run with heart motion', async () => {
    await pressPreset(page, 'L', 'RAO caudal');
    const runTo = (from, to) => page.evaluate(([from, to]) => {
      for (let k = from; k < to; k++) window.sim.advanceCine(k * 1000 / 15);
      window.sim.frame(to * 1000 / 15);
    }, [from, to]);
    await page.evaluate(() => { window.sim.pause(); window.sim.runCine(0); });
    await runTo(0, 15);
    await expect(page.locator('#monitor')).toHaveScreenshot('index-cine-L-rao-caudal-1s.png');
    await runTo(16, 45);
    await expect(page.locator('#monitor')).toHaveScreenshot('index-cine-L-rao-caudal-3s.png');
    await page.evaluate(() => { window.sim.runCine(null); window.sim.pause(false); });
    await frame(page);
  });

  test('room view', async () => {
    await pressPreset(page, 'L', 'LAO caudal (spider)');
    await expect(page.locator('#room')).toHaveScreenshot('index-room-whole.png');
    await page.locator('#roomViewSeg [data-rv=heart]').click();
    await frame(page);
    await expect(page.locator('#room')).toHaveScreenshot('index-room-heart.png');
    await page.locator('#roomViewSeg [data-rv=room]').click();
  });
});

test.describe('index.html, model heart (?model)', () => {
  test.beforeAll(async ({browser}) => { page = await open(browser, '/?model'); });
  test.afterAll(async () => { await page.close(); expect(errors).toEqual([]); });

  test('falls back to the model', async () => {
    expect(await page.evaluate(() => window.sim.mode)).toBe('model');
  });
  for (const [side, name] of [['L', 'RAO caudal'], ['R', 'LAO']]) {
    test(`preset ${side} ${name}`, async () => {
      await pressPreset(page, side, name);
      await expect(page.locator('#monitor')).toHaveScreenshot(`model-${side}-${slug(name)}.png`);
    });
  }
  test('chamber overlay', async () => {
    await pressPreset(page, 'L', 'LAO caudal (spider)');
    await setToggle(page, 'tOvC', true);
    await frame(page);
    await expect(page.locator('#monitor')).toHaveScreenshot('model-chambers-L-lao-caudal-spider.png');
  });
});

test.describe('drr.html', () => {
  test.beforeAll(async ({browser}) => { page = await open(browser, '/drr.html', 'drr'); });
  test.afterAll(async () => { await page.close(); expect(errors).toEqual([]); });

  for (const [side, name] of [['L', 'RAO caudal'], ['R', 'LAO']]) {
    test(`preset ${side} ${name}`, async () => {
      await pressPreset(page, side, name);
      await expect(page.locator('#monitor')).toHaveScreenshot(`drr-${side}-${slug(name)}.png`);
    });
  }
  test('centrelines', async () => {
    await pressPreset(page, 'L', 'RAO cranial');
    await setToggle(page, 'tLines', true);
    await frame(page);
    await expect(page.locator('#monitor')).toHaveScreenshot('drr-lines-L-rao-cranial.png');
  });
});
