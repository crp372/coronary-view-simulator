// Screenshot checks: every standard view, the overlays and the room, compared against tests/baselines/.
// One page per file: loading the CT takes a few seconds, so the views are shown one after another on it.
// WebGL runs in SwiftShader (software), so the images are the same on any machine.
import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

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
  // Display starts collapsed: open the group holding the button first
  await b.evaluate(e => { const d = e.closest('details'); if (d) d.open = true; });
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

// While the CT loads, the monitor shows a status, not the model heart; the room has no model on the table
test('loading screen', async ({browser}) => {
  const p = await browser.newPage();
  let release;
  const held = new Promise(r => { release = r; });
  await p.route('**/ct.u8.gz', async route => { await held; await route.continue(); });
  await p.goto('/?heart=905');
  await p.waitForFunction(() => window.sim);
  await expect(p.locator('#monStatTxt')).toHaveText('Loading ImageCAS scan 905…');
  await expect(p.locator('#monitor')).toHaveClass(/loading/);
  await expect(p.locator('#fluoro')).toBeHidden();
  await expect(p.locator('#labels .lbl:not([hidden])')).toHaveCount(0);
  expect(await p.evaluate(() => window.sim.mode)).toBe('loading');
  release();
  await p.evaluate(() => window.sim.ready);
  await expect(p.locator('#monStat')).toBeHidden();
  expect(await p.evaluate(() => window.sim.mode)).toBe('drr');
  await p.close();
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

// The layout: one screen with nothing cut off, at common laptop and desktop sizes (phones scroll in one column)
test.describe('layout', () => {
  test.beforeAll(async ({browser}) => { page = await open(browser, '/'); });
  test.afterAll(async () => { await page.close(); expect(errors).toEqual([]); });

  for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 800], [1180, 740], [1024, 768]]) {
    test(`fits ${w}×${h} without scrolling`, async () => {
      await page.setViewportSize({width: w, height: h});
      const m = await page.evaluate(() => {
        const over = s => { const e = document.querySelector(s); return e.scrollHeight - e.clientHeight; };
        return {page: document.documentElement.scrollHeight - innerHeight, wide: document.documentElement.scrollWidth - innerWidth,
          rail: over('.rail'), side: over('.side'), mon: document.getElementById('monitor').getBoundingClientRect().width};
      });
      expect(m).toMatchObject({page: 0, wide: 0});
      expect(m.rail).toBeLessThanOrEqual(1);
      expect(m.side).toBeLessThanOrEqual(1);
      expect(m.mon).toBeGreaterThan(Math.min(w, h) * 0.6);
    });
  }

  test('whole page, 1440×900', async () => {
    await page.setViewportSize({width: 1440, height: 900});
    await frame(page);
    await expect(page).toHaveScreenshot('layout-1440x900.png');
  });

  test('phone: one column, no sideways scroll', async () => {
    await page.setViewportSize({width: 375, height: 812});
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.setViewportSize({width: 1280, height: 900});
  });

  test('groups collapse, and stay so after a reload', async () => {
    const table = page.locator('details[data-grp=table]');
    await expect(table).toHaveJSProperty('open', false);
    await table.locator('summary').click();
    await expect(table).toHaveJSProperty('open', true);
    // the toggle event (which saves the state) runs as a task of its own, so let it happen before reloading
    await page.waitForFunction(() => (localStorage.getItem('cvs.groups') || '').includes('"table":true'));
    await page.reload();
    await page.evaluate(() => window.sim.ready);
    await expect(page.locator('details[data-grp=table]')).toHaveJSProperty('open', true);
    await page.locator('details[data-grp=table] summary').click();
  });

  test('full screen: the button and F', async () => {
    const fs = () => page.evaluate(() => !!document.fullscreenElement);
    await page.locator('#fsBtn').click();
    await expect.poll(fs).toBe(true);
    await expect(page.locator('#fsBtn')).toHaveText('Exit full screen');
    await page.keyboard.press('f');
    await expect.poll(fs).toBe(false);
  });

  test('How to use dialog, and its link to About', async () => {
    await page.locator('#helpBtn').click();
    await expect(page.locator('#help')).toBeVisible();
    await page.locator('#help [data-about]').click();
    await expect(page.locator('#help')).toBeHidden();
    await expect(page.locator('#about')).toBeVisible();
    await page.locator('#about button[type=submit]').click();
    await expect(page.locator('#about')).toBeHidden();
  });

  test('About dialog', async () => {
    await page.locator('#aboutBtn').click();
    await expect(page.locator('#about')).toBeVisible();
    await expect(page.locator('#srcNote')).toContainText('ImageCAS scan 814');
    await page.locator('#about button[type=submit]').click();
    await expect(page.locator('#about')).toBeHidden();
  });

  test('heart list: the CT hearts and the model; choosing reloads', async () => {
    const sel = page.locator('#heartSel');
    const hearts = JSON.parse(readFileSync(new URL('../data/web/hearts.json', import.meta.url))).hearts;
    await expect(sel.locator('option')).toHaveText([...hearts.map(h => h.name), 'Simplified model heart']);
    await expect(sel).toHaveValue('814');
    await sel.selectOption('model');
    await page.waitForURL(/\?model$/);
    await page.evaluate(() => window.sim.ready);
    expect(await page.evaluate(() => window.sim.mode)).toBe('model');
    await expect(sel).toHaveValue('model');
    await sel.selectOption('814');
    await page.waitForURL(/\?heart=814$/);
    await page.evaluate(() => window.sim.ready);
    expect(await page.evaluate(() => window.sim.mode)).toBe('drr');
  });
});
