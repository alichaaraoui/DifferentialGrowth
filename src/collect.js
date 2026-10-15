/**
 * Collection mode — saves every run to a folder on this computer.
 *
 * Only active when the page is opened with ?collect in the URL, so ordinary
 * visitors never see it. Needs Chrome or Edge (File System Access API).
 *
 * A run is everything from one seed to the next: reset, a new seed shape, a
 * stage change or a fresh drawing all end the current run and start another.
 * Each run is written as
 *
 *     <chosen folder>/session_YYYY-MM-DD/run_001/
 *         parameters.json   parameters at the start, every change made during
 *                           the run, rules, seed shape, final counts
 *         nodes.csv         iteration, node_id, x, y — every 5th iteration
 *         preview.png       the final shape
 *         images/iter_000.png …  one image per recorded iteration
 *
 * matching the layout of the Python dataset generator. Images use a fixed
 * frame per run so every frame is framed identically.
 *
 * The open run is flushed every few seconds (parameters.json, preview.png and
 * nodes_latest.csv with the current curve), so a closed tab still leaves the
 * run's settings and final shape. nodes.csv and images/ are written when the
 * run ends; a run folder with "complete": false never got that far.
 */

const EVERY = 5;           // record a snapshot every N iterations
const MIN_ITERATIONS = 10; // shorter runs are not worth keeping
const FLUSH_MS = 8000;
const IMAGE_PX = 512;
const LINE_COLOR = '#1F6F5C';

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

/* ---------------- remembering the folder across reloads ----------------- */
const DB = 'dg-collect';

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const saveHandle = (h) => idb('readwrite', (s) => s.put(h, 'root'));
const loadHandle = () => idb('readonly', (s) => s.get('root')).catch(() => null);

/* ---------------- files ------------------------------------------------- */
async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

async function nextRunDir(session) {
  let max = 0;
  for await (const [name, h] of session.entries()) {
    const m = h.kind === 'directory' && /^run_(\d+)$/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return session.getDirectoryHandle(`run_${String(max + 1).padStart(3, '0')}`, { create: true });
}

/* ---------------- rendering, framed like the Python renderer ------------ */
function frameOf(snapshots) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { xy } of snapshots) {
    for (let i = 0; i < xy.length; i += 2) {
      if (xy[i] < minX) minX = xy[i];
      if (xy[i] > maxX) maxX = xy[i];
      if (xy[i + 1] < minY) minY = xy[i + 1];
      if (xy[i + 1] > maxY) maxY = xy[i + 1];
    }
  }
  const half = Math.max(maxX - minX, maxY - minY, 1e-6) / 2 * 1.08;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, half };
}

async function renderPng(xy, closed, frame) {
  const c = new OffscreenCanvas(IMAGE_PX, IMAGE_PX);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, IMAGE_PX, IMAGE_PX);
  const s = IMAGE_PX / (2 * frame.half);
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < xy.length; i += 2) {
    const x = (xy[i] - frame.cx) * s + IMAGE_PX / 2;
    const y = (xy[i + 1] - frame.cy) * s + IMAGE_PX / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if (closed) ctx.closePath();
  ctx.stroke();
  return c.convertToBlob({ type: 'image/png' });
}

/* ---------------- the collector ----------------------------------------- */
export function startCollector(sim, getSeedName) {
  if (!new URLSearchParams(location.search).has('collect')) return null;

  const badge = document.createElement('div');
  badge.className = 'collect';
  document.body.appendChild(badge);

  let root = null;        // chosen folder
  let saved = 0;          // runs saved this page load
  let armed = false;      // ignore the page's own warm-up steps
  let run = null;
  let queue = Promise.resolve();

  const supported = 'showDirectoryPicker' in window;

  function show() {
    badge.innerHTML = '';
    if (!supported) {
      badge.textContent = 'collect mode needs Chrome or Edge';
      badge.dataset.state = 'off';
      return;
    }
    if (!root) {
      const b = document.createElement('button');
      b.textContent = 'choose save folder';
      b.onclick = pick;
      badge.append(b);
      badge.dataset.state = 'off';
      return;
    }
    badge.dataset.state = 'on';
    badge.textContent = `recording · ${root.name}/session_${today()} · ${saved} saved`;
  }

  async function pick() {
    try {
      const stored = await loadHandle();
      // Reuse the folder from last time if the browser still allows it.
      if (stored && (await stored.requestPermission({ mode: 'readwrite' })) === 'granted') {
        root = stored;
      } else {
        root = await window.showDirectoryPicker({ mode: 'readwrite', id: 'dg-collect' });
        await saveHandle(root);
      }
    } catch {
      return; // picker dismissed
    }
    show();
  }

  function snapshot() {
    const xy = new Float32Array(sim.nodes.length * 2);
    sim.nodes.forEach((n, i) => { xy[2 * i] = n.x; xy[2 * i + 1] = n.y; });
    return { iteration: sim.iteration, xy };
  }

  const settings = () => JSON.stringify({ params: sim.params, rules: sim.rules, closed: sim.closed });

  function begin() {
    run = {
      dir: null,
      started: new Date().toISOString(),
      seed: getSeedName(),
      params: { ...sim.params },
      rules: { ...sim.rules },
      closed: sim.closed,
      changes: [],
      last: settings(),
      snapshots: [snapshot()],
      userSteps: 0,
      dirty: false,
    };
  }

  function record() {
    const now = settings();
    if (now !== run.last) {
      run.last = now;
      run.changes.push({ iteration: sim.iteration, ...JSON.parse(now) });
    }
    run.snapshots.push(snapshot());
    run.dirty = true;
  }

  function worthKeeping(r) {
    const last = r.snapshots[r.snapshots.length - 1];
    return r.userSteps > 0 && last.iteration >= MIN_ITERATIONS;
  }

  async function write(r, { final }) {
    if (!root || !worthKeeping(r)) return;
    const session = await root.getDirectoryHandle(`session_${today()}`, { create: true });
    if (!r.dir) {
      r.dir = await nextRunDir(session);
      saved++;
      show();
    }

    const snaps = r.snapshots;
    const last = snaps[snaps.length - 1];
    const frame = frameOf(snaps);

    const meta = {
      session: session.name,
      run: r.dir.name,
      started: r.started,
      updated: new Date().toISOString(),
      complete: final,
      seed_shape: r.seed,
      closed: r.closed,
      parameters: r.params,
      rules: r.rules,
      changes_during_run: r.changes,
      n_iterations_run: last.iteration,
      final_node_count: last.xy.length / 2,
      snapshot_every: EVERY,
      frame: frame,
      image_size_px: IMAGE_PX,
    };
    await writeFile(r.dir, 'parameters.json', JSON.stringify(meta, null, 2));

    // The full history is large, so a flush only writes the current curve;
    // the whole nodes.csv is written once, when the run ends.
    const csv = (list) => new Blob(['iteration,node_id,x,y\n', ...list.map(({ iteration, xy }) => {
      let s = '';
      for (let i = 0; i < xy.length; i += 2) {
        s += `${iteration},${i / 2},${xy[i].toFixed(6)},${xy[i + 1].toFixed(6)}\n`;
      }
      return s;
    })]);
    if (final) {
      await writeFile(r.dir, 'nodes.csv', csv(snaps));
      await r.dir.removeEntry('nodes_latest.csv').catch(() => {});
    } else {
      await writeFile(r.dir, 'nodes_latest.csv', csv([last]));
    }
    await writeFile(r.dir, 'preview.png', await renderPng(last.xy, r.closed, frame));

    if (final) {
      const images = await r.dir.getDirectoryHandle('images', { create: true });
      for (const { iteration, xy } of snaps) {
        const name = `iter_${String(iteration).padStart(4, '0')}.png`;
        await writeFile(images, name, await renderPng(xy, r.closed, frame));
      }
    }
    r.dirty = false;
  }

  function enqueue(r, opts) {
    queue = queue.then(() => write(r, opts)).catch((err) => {
      console.error('collect: write failed', err);
      badge.textContent = `save failed — ${err.message}`;
      badge.dataset.state = 'off';
    });
  }

  function end() {
    if (!run) return;
    const r = run;
    const last = r.snapshots[r.snapshots.length - 1];
    if (last.iteration !== sim.iteration && sim.nodes.length) r.snapshots.push(snapshot());
    enqueue(r, { final: true });
  }

  // Wrap the two calls every run goes through, so the rest of the app is
  // untouched: seed() ends one run and starts the next, step() records.
  const seed = sim.seed.bind(sim);
  sim.seed = (points, closed) => {
    end();
    seed(points, closed);
    begin();
  };

  const step = sim.step.bind(sim);
  sim.step = () => {
    step();
    if (!run) return;
    if (armed) run.userSteps++;
    if (sim.iteration % EVERY === 0) record();
  };

  setInterval(() => {
    if (run?.dirty) {
      // Flush a copy of the current tail so the record survives a closed tab.
      const r = run;
      const tail = r.snapshots[r.snapshots.length - 1];
      if (tail.iteration !== sim.iteration) record();
      enqueue(r, { final: false });
    }
  }, FLUSH_MS);

  // Finish the open run when the tab is hidden (switching away, closing).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && run?.dirty) enqueue(run, { final: false });
  });

  loadHandle().then(async (stored) => {
    if (stored && (await stored.queryPermission({ mode: 'readwrite' })) === 'granted') root = stored;
    show();
  });
  show();

  return { arm: () => (armed = true) };
}
