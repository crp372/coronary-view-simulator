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

// the analytics beacon can't report from localhost, and its failures would count as page errors: serve it empty
// the first-run tour would cover the views: mark it seen, except in its own check
const noTour = p => p.addInitScript(() => { try { if (!location.search.includes('tour')) localStorage.setItem('cvs.tour', '1'); } catch (e) {} });
const noBeacon = p => p.route('**/*cloudflareinsights.com/**', r => r.fulfill({contentType: 'application/javascript', body: ''}));
// opens a page and waits until its DRR (or fallback) is running and the fonts have loaded; hook: the page's
// window.sim (index.html) or window.drr (drr.html)
async function open(browser, path, hook = 'sim') {
  const p = await browser.newPage();
  await noBeacon(p);
  await noTour(p);
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

  // vessel labels start off; the view checks turn them on, so they also check where the labels sit
  test('starts in DRR mode, with labels off', async () => {
    expect(await page.evaluate(() => window.sim.mode)).toBe('drr');
    await expect(page.locator('#tLabels')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#labels .lbl:not([hidden])')).toHaveCount(0);
    await setToggle(page, 'tLabels', true);
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
    // from the detector: the heart as the image shows it; it follows the C-arm, so the orbit is off
    await page.locator('#roomViewSeg [data-rv=det]').click();
    await frame(page);
    await expect(page.locator('#room .hint')).toContainText('follows the C-arm');
    await expect(page.locator('#room')).toHaveScreenshot('index-room-detector.png');
    // the room shows the trees the image shows: the injected one, or both with the coronary overlay. In RAO caudal
    // the left tree is behind the heart, so it's drawn dashed
    await pressPreset(page, 'L', 'RAO caudal');
    await expect(page.locator('#roomLegend [data-sys=L]')).toBeVisible();
    await expect(page.locator('#roomLegend [data-sys=R]')).toBeHidden();
    await expect(page.locator('#room')).toHaveScreenshot('index-room-detector-rao-caudal.png');
    await setToggle(page, 'tOvV', true);
    await frame(page);
    await expect(page.locator('#roomLegend [data-sys=R]')).toBeVisible();
    await setToggle(page, 'tOvV', false);
    await pressPreset(page, 'R', 'LAO');
    await expect(page.locator('#roomLegend [data-sys=L]')).toBeHidden();
    await expect(page.locator('#room')).toHaveScreenshot('index-room-detector-R-lao.png');
    await page.locator('#roomViewSeg [data-rv=heart]').click();
    await frame(page);
  });

  // the room's heart: solid or see-through, and the chest's bones on or off
  test('room view: see-through heart, no skeleton', async () => {
    await setToggle(page, 'tSolid', false);
    await setToggle(page, 'tSkel', false);
    await frame(page);
    await expect(page.locator('#room')).toHaveScreenshot('index-room-heart-see-through.png');
    await setToggle(page, 'tSolid', true);
    await setToggle(page, 'tSkel', true);
    await page.locator('#roomViewSeg [data-rv=room]').click();
    await frame(page);
  });
});

// While the CT loads, the monitor shows a status, not the model heart; the room has no model on the table
test('loading screen', async ({browser}) => {
  const p = await browser.newPage();
  await noBeacon(p);
  await noTour(p);
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

    await setToggle(page, 'tLabels', true);
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

// The layout: one screen with nothing cut off, at common laptop and desktop sizes (phones scroll in one column),
// with the control groups as they start. Opening more groups scrolls the rail; the room view keeps its height.
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

  test('opening more groups scrolls the rail, and the room keeps its height', async () => {
    await page.setViewportSize({width: 1440, height: 900});
    const m = () => page.evaluate(() => ({room: document.getElementById('room').clientHeight, rail: (e => e.scrollHeight - e.clientHeight)(document.querySelector('.rail')),
      page: document.documentElement.scrollHeight - innerHeight}));
    const setAll = open => page.evaluate(open => document.querySelectorAll('details.grp').forEach(d => { if (open || !['carm', 'inj'].includes(d.dataset.grp)) d.open = open; }), open);
    const before = await m();
    await setAll(true);
    const after = await m();
    expect(Math.abs(after.room - before.room)).toBeLessThanOrEqual(3);
    expect(after.rail).toBeGreaterThan(100);
    expect(after.page).toBe(0);
    await setAll(false);
    expect((await m()).rail).toBeLessThanOrEqual(1);
  });

  // zoom in the room is by pinch only (a trackpad pinch arrives as a wheel event with Ctrl), so a plain wheel
  // over it is left to scroll the rail
  test('room view: a plain wheel does not zoom, a pinch does', async () => {
    // how far the room's camera is from the isocentre
    const dist = async () => { await frame(page); return page.evaluate(() => Math.hypot(...window.sim.roomCam.pos)); };
    const r = await page.locator('#room').boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    const a = await dist();
    await page.mouse.wheel(0, 300);
    expect(await dist()).toBeCloseTo(a, 3);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 300);
    await page.keyboard.up('Control');
    expect(await dist()).toBeGreaterThan(a * 1.1);
    await page.locator('#roomViewSeg [data-rv=room]').click();   // back to the whole room's own distance
    await frame(page);
    await page.mouse.move(5, 5);
  });

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

  // the room view and the image swap places (the button in the room's corner, or R), and still fit one screen
  test('room view swaps with the image', async () => {
    const sizes = () => page.evaluate(() => ({room: document.getElementById('room').clientWidth, mon: document.getElementById('monitor').clientWidth,
      inStage: !!document.querySelector('.stage #room'), page: document.documentElement.scrollHeight - innerHeight,
      rail: (e => e.scrollHeight - e.clientHeight)(document.querySelector('.rail'))}));
    const before = await sizes();
    expect(before.inStage).toBe(false);
    await page.locator('#swapBtn').click();
    const after = await sizes();
    expect(after).toMatchObject({inStage: true, page: 0});
    expect(after.rail).toBeLessThanOrEqual(1);
    expect(after.room).toBeGreaterThan(before.room * 1.1);
    expect(after.mon).toBeGreaterThan(200);
    await expect(page.locator('#swapBtn')).toHaveAttribute('aria-pressed', 'true');
    // the camera buttons go with the room, and the panel is named for the image it now holds
    await expect(page.locator('.roompanel h2')).toHaveText('Image');
    await expect(page.locator('.stage #room #roomViewSeg')).toBeVisible();
    await frame(page);
    await expect(page).toHaveScreenshot('layout-swapped-1280x900.png');
    await page.keyboard.press('r');
    expect((await sizes()).inStage).toBe(false);
    await expect(page.locator('.roompanel h2')).toHaveText('Room');
    await expect(page.locator('.roompanel .row #roomViewSeg')).toBeVisible();
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
    const btn = page.locator('#heartBtn'), lb = page.locator('#heartList');
    const hearts = JSON.parse(readFileSync(new URL('../data/web/hearts.json', import.meta.url))).hearts;
    await expect(lb.locator('[role=option]')).toHaveText([...hearts.map(h => h.name), 'Simplified model heart']);
    await expect(lb.locator('[aria-selected=true]')).toHaveAttribute('data-id', '814');
    await expect(lb).toBeHidden();
    // mouse: open, then choose the model
    await btn.click();
    await expect(lb).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await lb.locator('[data-id=model]').click();
    await page.waitForURL(/\?model$/);
    await page.evaluate(() => window.sim.ready);
    expect(await page.evaluate(() => window.sim.mode)).toBe('model');
    await expect(lb.locator('[aria-selected=true]')).toHaveAttribute('data-id', 'model');
    // keyboard: Escape closes without choosing; Home then Enter chooses the first heart
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(lb).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(lb).toBeHidden();
    await expect(btn).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp('\\?heart=' + hearts[0].id + '$'));
    await page.evaluate(() => window.sim.ready);
    expect(await page.evaluate(() => window.sim.mode)).toBe('drr');
  });
});

// The first-run tour: four steps on a first visit, then never again; "Show the tour" in How to use runs it again
test('first-run tour', async ({browser}) => {
  const p = await browser.newPage({viewport: {width: 1440, height: 900}});
  await noBeacon(p);
  await p.goto('/?tour');
  await p.waitForFunction(() => window.sim && window.sim.ready);
  await p.evaluate(() => Promise.all([window.sim.ready, document.fonts.ready]));
  const card = p.locator('#tour');
  await expect(card).toBeVisible();
  await expect(p.locator('#tourCount')).toHaveText('1 of 4');
  await expect(p.locator('#tourNext')).toBeFocused();
  await p.locator('#tourNext').click();
  // step 2 names a real artery, as hovering would
  await expect(p.locator('#tourTitle')).toHaveText('Name what you see');
  await expect(p.locator('#monTip')).toBeVisible();
  await p.evaluate(() => window.sim.frame(0));
  await expect(p).toHaveScreenshot('tour-step-2.png');
  await p.locator('#tourNext').click();
  // step 3 opens Display, where the overlays are
  await expect(p.locator('details[data-grp=disp]')).toHaveJSProperty('open', true);
  await expect(p.locator('#tOvV')).toBeInViewport();
  await p.locator('#tourNext').click();
  // step 4 points at How to use and About
  await expect(p.locator('#tourTitle')).toHaveText('Find out more');
  await expect(p.locator('#tourNext')).toHaveText('Done');
  await p.locator('#tourNext').click();
  await expect(card).toBeHidden();
  await expect(p.locator('#monTip')).toBeHidden();
  // seen: not on the next visit
  await p.reload();
  await p.evaluate(() => window.sim.ready);
  await expect(card).toBeHidden();
  // but How to use can run it again, and Escape ends it
  await p.locator('#helpBtn').click();
  await p.locator('#tourBtn').click();
  await expect(p.locator('#help')).toBeHidden();
  await expect(p.locator('#tourCount')).toHaveText('1 of 4');
  await p.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await p.close();
});
