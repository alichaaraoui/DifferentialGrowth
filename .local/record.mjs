/**
 * Records the two portfolio clips.
 *
 *   node scripts/record.mjs            both
 *   node scripts/record.mjs hero       the growth clip only
 *   node scripts/record.mjs interface  the walkthrough only
 *
 * The hero clip is captured frame by frame against a paused simulation, so the
 * framerate is exact and the result is identical on every run. The walkthrough
 * is recorded in real time while a script drives the actual controls.
 *
 * Output lands in media/ as H.264 mp4.
 */

import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'media');
const TMP = path.join(ROOT, '.record-tmp');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
};

/* ---------------- static server ------------------------------------------ */
function serve() {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, () => ok({ server, port: server.address().port })));
}

function ffmpeg(args) {
  return new Promise((ok, fail) => {
    const p = spawn(ffmpegPath, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}`))));
  });
}

/* ---------------- hero: deterministic frame capture ---------------------- */
async function recordHero(browser, url) {
  const FPS = 30;
  const FRAMES = 450;            // 15 seconds
  const frames = path.join(TMP, 'hero');
  await mkdir(frames, { recursive: true });

  // 16:9, matching .project-hero on the site. object-cover crops anything
  // that does not match, and a square source loses ~44% of its height there.
  const page = await browser.newPage({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 2,        // captures at 1920x1080
  });
  await page.goto(url, { waitUntil: 'networkidle' });

  // Strip every piece of furniture — the curve is the whole frame.
  await page.addStyleTag({
    content: `.rack,.transport,.meter,.hint,.dd-menu{display:none!important}`,
  });

  await page.evaluate(() => {
    const dg = window.__dg;
    dg.setRunning(false);
    // A 1.2px line is sub-pixel once H.264 has had it. Heavier strokes survive
    // the encode; this is a capture setting, not the app default.
    dg.renderer.lineWeight = 2.1;
    dg.loadSeed('circle');
    dg.updateInset();
    dg.renderer.resetView();
    // The site takes its poster frame one second in. Open on a curve that has
    // already found its folds, so the still is worth looking at.
    for (let i = 0; i < 150; i++) dg.sim.step();
  });

  console.log(`  hero: ${FRAMES} frames`);
  for (let i = 0; i < FRAMES; i++) {
    // Ramp the work per frame so it opens slowly and accelerates as the
    // curve gains detail, instead of exploding in the first second.
    const t = i / FRAMES;
    const steps = Math.max(1, Math.round(1 + t * t * 5));

    await page.evaluate((n) => {
      const { sim, renderer } = window.__dg;
      for (let k = 0; k < n; k++) sim.step();
      if (sim.iteration % 4 === 0) renderer.captureTrail(sim.nodes);
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, steps);

    await page.screenshot({
      path: path.join(frames, `${String(i).padStart(5, '0')}.png`),
      animations: 'disabled',
    });
    if (i % 60 === 0) process.stdout.write(`    ${i}/${FRAMES}\n`);
  }

  const nodes = await page.evaluate(() => window.__dg.sim.nodes.length);
  await page.close();

  await ffmpeg([
    '-framerate', String(FPS),
    '-i', path.join(frames, '%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14',
    '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    path.join(OUT, '01-growth.mp4'),
  ]);
  console.log(`  hero done — ${nodes} nodes at the final frame`);
}

/* ---------------- walkthrough: real-time, scripted ----------------------- */
const CURSOR = `
  const dot = document.createElement('div');
  dot.id = '__cursor';
  dot.style.cssText = \`position:fixed;z-index:9999;width:18px;height:18px;
    margin:-9px 0 0 -9px;border-radius:50%;pointer-events:none;
    background:rgba(46,75,255,.22);border:1.5px solid #2E4BFF;
    transition:transform .05s linear;left:0;top:0;\`;
  document.body.appendChild(dot);
  window.__cursorTo = (x, y) => { dot.style.transform = \`translate(\${x}px,\${y}px)\`; };
  window.__cursorTo(720, 800);
`;

async function recordInterface(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });

  // Playwright's own recordVideo captures well below the surface resolution.
  // A CDP screencast reads the full device-pixel-ratio surface instead.
  const shots = path.join(TMP, 'ui');
  await mkdir(shots, { recursive: true });
  const client = await context.newCDPSession(page);
  const stamps = [];
  const writes = [];
  let frameNo = 0;
  client.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    stamps.push(metadata.timestamp);
    const file = path.join(shots, `${String(frameNo++).padStart(5, '0')}.jpg`);
    writes.push(writeFile(file, Buffer.from(data, 'base64')));
  });
  await client.send('Page.startScreencast', {
    format: 'jpeg', quality: 96, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1,
  });
  await page.addInitScript(CURSOR);
  await page.evaluate(CURSOR);
  await page.waitForTimeout(700);

  /** Glide the pointer somewhere, then optionally click it. */
  async function to(selector, { click = true, settle = 520 } = {}) {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`no box for ${selector}`);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 26 });
    await page.evaluate(([px, py]) => window.__cursorTo(px, py), [x, y]);
    await page.waitForTimeout(240);
    if (click) {
      await page.mouse.down();
      await page.waitForTimeout(70);
      await page.mouse.up();
    }
    await page.waitForTimeout(settle);
  }

  async function drag(selector, fraction) {
    const box = await page.locator(selector).boundingBox();
    const y = box.y + box.height / 2;
    const from = box.x + box.width * 0.5;
    const target = box.x + box.width * fraction;
    await page.mouse.move(from, y, { steps: 18 });
    await page.evaluate(([px, py]) => window.__cursorTo(px, py), [from, y]);
    await page.mouse.down();
    const span = target - from;
    for (let i = 1; i <= 22; i++) {
      const x = from + (span * i) / 22;
      await page.mouse.move(x, y);
      await page.evaluate(([px, py]) => window.__cursorTo(px, py), [x, y]);
      await page.waitForTimeout(22);
    }
    await page.mouse.up();
    await page.waitForTimeout(620);
  }

  console.log('  walkthrough: press play');
  await to('#play', { settle: 2800 });

  console.log('  walkthrough: change the seed');
  await to('.dd-btn >> nth=0', { settle: 700 });
  await to('.dd-menu li[data-value="star"]', { settle: 500 });
  await to('#play', { settle: 3000 });

  console.log('  walkthrough: work the sliders');
  await drag('#k-detail input', 0.22);
  await page.waitForTimeout(1300);
  await drag('#k-rep input', 0.85);
  await page.waitForTimeout(1700);
  await drag('#k-detail input', 0.5);
  await page.waitForTimeout(1200);

  console.log('  walkthrough: switch a rule off');
  await to('#k-att .led-btn', { settle: 2300 });
  await to('#k-att .led-btn', { settle: 1400 });

  console.log('  walkthrough: step through the stages');
  await to('#stages button[data-stage="2"]', { settle: 2600 });
  await to('#stages button[data-stage="5"]', { settle: 2200 });

  // Back to defaults before drawing, or the demo above leaves the split
  // threshold high enough that the drawn curve stalls instead of growing.
  console.log('  walkthrough: reset the settings');
  await page.locator('#view-controls').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(450);
  await to('#reset-settings', { settle: 900 });
  await page.locator('#view-controls').evaluate((el) => el.scrollTo({ top: 0 }));
  await page.waitForTimeout(400);

  console.log('  walkthrough: draw a shape');
  await to('#draw-btn', { settle: 500 });
  const pts = [[620, 620], [700, 430], [860, 330], [1050, 380], [1130, 560], [1010, 700], [800, 720]];
  await page.mouse.move(...pts[0], { steps: 20 });
  await page.evaluate(([x, y]) => window.__cursorTo(x, y), pts[0]);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    for (let s = 1; s <= 16; s++) {
      const x = x0 + ((x1 - x0) * s) / 16;
      const y = y0 + ((y1 - y0) * s) / 16;
      await page.mouse.move(x, y);
      await page.evaluate(([px, py]) => window.__cursorTo(px, py), [x, y]);
      await page.waitForTimeout(12);
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
  await to('#play', { settle: 4600 });

  console.log('  walkthrough: clear the frame');
  await to('#toggle-rack', { settle: 4200 });

  await page.evaluate(() => document.getElementById('__cursor')?.remove());
  await page.waitForTimeout(1200);

  await client.send('Page.stopScreencast');
  await Promise.all(writes);
  await context.close();

  // Screencast frames arrive at whatever rate the page can manage. Feeding
  // ffmpeg the real per-frame durations keeps the pace true regardless.
  const name = (i) => path.join(shots, `${String(i).padStart(5, '0')}.jpg`);
  const lines = [];
  for (let i = 0; i < frameNo; i++) {
    const next = stamps[i + 1] ?? stamps[i] + 0.04;
    const dt = Math.min(0.5, Math.max(0.005, next - stamps[i]));
    lines.push(`file '${name(i)}'`, `duration ${dt.toFixed(4)}`);
  }
  lines.push(`file '${name(frameNo - 1)}'`);
  const list = path.join(TMP, 'ui-frames.txt');
  await writeFile(list, lines.join('\n'));

  await ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', list,
    '-fps_mode', 'cfr', '-r', '30',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
    '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    path.join(OUT, '02-interface.mp4'),
  ]);
  const secs = (stamps.at(-1) - stamps[0]).toFixed(1);
  console.log(`  walkthrough done — ${frameNo} frames over ${secs}s`);
}

/* ---------------- main --------------------------------------------------- */
const which = process.argv[2] ?? 'both';

await rm(TMP, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await mkdir(TMP, { recursive: true });

const { server, port } = await serve();
const url = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch();
console.log(`serving ${ROOT} on ${url}`);

try {
  if (which === 'both' || which === 'hero') await recordHero(browser, url);
  if (which === 'both' || which === 'interface') await recordInterface(browser, url);
} finally {
  await browser.close();
  server.close();
  await rm(TMP, { recursive: true, force: true });
}

await writeFile(
  path.join(OUT, 'README.md'),
  `# Media\n\nRegenerate with \`node scripts/record.mjs\`.\n\n` +
    `- \`01-growth.mp4\` — 1920x1080, 30fps, deterministic capture of a circle seed\n` +
    `- \`02-interface.mp4\` — 1440x860, scripted walkthrough of the controls\n\n` +
    `Both are masters. The portfolio's \`scripts/build-content.mjs\` transcodes and\n` +
    `generates poster frames, so drop them beside \`project.md\` as they are.\n`,
);

console.log(`\nwrote ${OUT}`);
