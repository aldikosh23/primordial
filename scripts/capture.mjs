/**
 * Records the README media and the social preview with headless Chrome:
 *   docs/hero.gif      the whole app running at 3× speed
 *   docs/closeup.png   zoomed in on a hunter with the inspector open
 *   public/og.png      1200×630 link preview for social networks
 *
 * Needs a production build served locally, plus Chrome and ffmpeg:
 *   npm run build && npx vite preview --port 4174 &
 *   node scripts/capture.mjs [http://localhost:4174]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:4174';
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const seed = 'jade-grove-555';
mkdirSync('docs', { recursive: true });

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--hide-scrollbars'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open the app fast-forwarded to `warmup` ticks and wait until it gets there. */
async function open(viewport, warmup) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(`${base}/?seed=${seed}&warmup=${warmup}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    (n) => document.getElementById('warmup').hidden && window.primordial.world.tick >= n,
    { timeout: 120_000 },
    warmup,
  );
  await page.evaluate(() => document.getElementById('hint').classList.add('gone'));
  return page;
}

/** Centre the camera on the liveliest spot, zoom in, and return a hunter there (if any). */
function focusBusiestSpot(zoom) {
  const { world, camera } = window.primordial;
  let best = world.creatures[0];
  let bestCount = -1;
  for (const c of world.creatures) {
    let n = 0;
    for (const o of world.creatures) if ((o.x - c.x) ** 2 + (o.y - c.y) ** 2 < 160 ** 2) n++;
    if (n > bestCount) {
      bestCount = n;
      best = c;
    }
  }
  // A well-fed, not-too-old hunter near the action: it should still be alive when we shoot.
  const healthy = (c) => c.energyFraction > 0.5 && c.age < c.lifespan * 0.6;
  const dist = (c) => (c.x - best.x) ** 2 + (c.y - best.y) ** 2;
  const hunter = world.creatures
    .filter((c) => c.canHunt && healthy(c) && dist(c) < 500 ** 2)
    .sort((a, b) => b.genome.size - a.genome.size)[0];
  const target = hunter ?? best;
  camera.x = target.x;
  camera.y = target.y;
  camera.zoomAt(camera.viewW / 2, camera.viewH / 2, zoom / camera.zoom);
  return target.id;
}

// ---- hero.gif
{
  const page = await open({ width: 1280, height: 760, deviceScaleFactor: 1 }, 9000);
  await page.keyboard.press('Digit2'); // 3× speed
  const webm = 'docs/hero.webm';
  const recorder = await page.screencast({ path: webm });
  await sleep(9000);
  await recorder.stop();
  await page.close();
  // Two-pass palette keeps the GIF small and the colours clean.
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-ss', '0.5', '-t', '7', '-i', webm,
    '-vf', 'fps=10,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
    'docs/hero.gif',
  ]);
  if (!process.env.KEEP_WEBM) rmSync(webm);
}

// ---- closeup.png
{
  const page = await open({ width: 1280, height: 760, deviceScaleFactor: 2 }, 14000);
  const id = await page.evaluate(focusBusiestSpot, 2.6);
  await page.evaluate((id) => {
    const { world, select } = window.primordial;
    select(world.creatures.find((c) => c.id === id) ?? null);
  }, id);
  await page.click('#insp-follow');
  await page.keyboard.press('Space'); // pause, so the star of the shot can't get eaten
  await sleep(1500); // the camera keeps easing onto it while paused
  await page.screenshot({ path: 'docs/closeup.png' });
  await page.close();
}

// ---- og.png (the stage only: 1560 − 360 px panel = 1200 px wide)
{
  const page = await open({ width: 1560, height: 630, deviceScaleFactor: 1 }, 12000);
  await page.evaluate(focusBusiestSpot, 1.1);
  // A title card over the world instead of the controls.
  await page.evaluate(() => {
    document.querySelector('.toolbar').style.display = 'none';
    const card = document.createElement('div');
    card.style.cssText =
      'position:absolute;left:0;right:0;bottom:0;padding:120px 56px 48px;' +
      'background:linear-gradient(transparent,rgba(4,6,10,.92) 55%);pointer-events:none';
    card.innerHTML =
      '<div style="font:700 64px/1 Space Grotesk,system-ui;color:#fff;letter-spacing:.01em">Primordial</div>' +
      '<div style="margin-top:12px;font:400 26px/1.3 system-ui;color:#a9b1bb">' +
      'Predators and prey evolving in real time, in your browser</div>';
    document.getElementById('stage').append(card);
  });
  await sleep(1500);
  const stage = await page.$('#stage');
  await stage.screenshot({ path: 'public/og.png' });
  await page.close();
}

await browser.close();
console.log('saved docs/hero.gif, docs/closeup.png and public/og.png');
