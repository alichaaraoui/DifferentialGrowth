/**
 * UI wiring. Owns the simulation, the renderer and every control.
 */

import { DifferentialGrowth, STAGES, STAGE_NOTES, distance } from './growth.js';
import { SEEDS, fromStroke } from './seeds.js';
import { Renderer, Sparkline } from './renderer.js';

const $ = (id) => document.getElementById(id);

const sim = new DifferentialGrowth();
const renderer = new Renderer($('stage'));
const spark = new Sparkline($('spark'));

const state = {
  running: true,
  speed: 2,
  cap: Infinity,
  seed: 'circle',
  strokeSeed: null,
  drawMode: false,
};

/* ---------------- theme colours straight from the stylesheet ------------- */
const readVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const colors = () => ({
  curve: readVar('--curve'),
  node: readVar('--node'),
  accent: readVar('--accent'),
  hair: readVar('--hair'),
  ground: readVar('--ground'),
});

/* ---------------- seeding ------------------------------------------------ */
function loadSeed(name) {
  const { points, closed } = SEEDS[name]();
  sim.seed(points, closed);
  state.seed = name;
  state.strokeSeed = null;
  renderer.resetView();
  spark.clear();
  setPressed('t-closed', closed);
}

function restart() {
  if (state.seed === 'stroke' && state.strokeSeed) {
    sim.seed(state.strokeSeed.points, state.strokeSeed.closed);
    renderer.resetView();
    spark.clear();
  } else {
    loadSeed(state.seed);
  }
  setRunning(true);
}

/* ---------------- main loop ---------------------------------------------- */
let lastReadout = 0;

function frame(now) {
  if (state.running && !state.drawMode) {
    for (let i = 0; i < state.speed; i++) {
      if (sim.iteration >= state.cap) {
        setRunning(false);
        break;
      }
      sim.step();
      if (sim.iteration % 4 === 0) renderer.captureTrail(sim.nodes);
      if (sim.iteration % 5 === 0) spark.push(sim.nodes.length);
    }
  }

  const c = colors();
  renderer.draw(sim, c);

  if (now - lastReadout > 130) {
    lastReadout = now;
    $('r-nodes').textContent = sim.nodes.length;
    $('r-iter').textContent =
      state.cap === Infinity ? sim.iteration : `${sim.iteration}/${state.cap}`;
    $('r-edge').textContent = sim.longestEdge().toFixed(2);
    spark.draw(c);
  }
  requestAnimationFrame(frame);
}

/* ---------------- transport ---------------------------------------------- */
const PAUSE_ICON = '<rect x="6.5" y="5" width="4" height="14" rx="1.4"/><rect x="13.5" y="5" width="4" height="14" rx="1.4"/>';
const PLAY_ICON = '<path d="M7 5.2v13.6c0 .8.9 1.3 1.6.9l10.2-6.8c.6-.4.6-1.4 0-1.8L8.6 4.3C7.9 3.9 7 4.4 7 5.2z"/>';

function setRunning(on) {
  state.running = on;
  $('play-icon').innerHTML = on ? PAUSE_ICON : PLAY_ICON;
  const label = on ? 'Pause' : 'Play';
  $('play').title = `${label}  (Space)`;
  $('play').setAttribute('aria-label', label);
}

$('play').addEventListener('click', () => setRunning(!state.running));
$('step').addEventListener('click', () => {
  setRunning(false);
  sim.step();
  spark.push(sim.nodes.length);
});
$('reset').addEventListener('click', restart);
$('clear').addEventListener('click', clearAndDraw);

/* ---------------- panel -------------------------------------------------- */
function setPressed(id, on) {
  $(id)?.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function selectOne(container, target) {
  for (const b of container.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', b === target ? 'true' : 'false');
  }
}

$('seeds').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  selectOne($('seeds'), btn);
  if (btn.dataset.seed === 'draw') {
    enterDrawMode();
  } else {
    exitDrawMode();
    loadSeed(btn.dataset.seed);
    setRunning(true);
  }
});

$('stages').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  selectOne($('stages'), btn);
  const rules = STAGES[btn.dataset.stage];
  for (const [key, on] of Object.entries(rules)) {
    sim.rules[key] = on;
    $(`w-${key}`).checked = on;
  }
  $('stage-caption').textContent = STAGE_NOTES[btn.dataset.stage];
  restart();
});

for (const key of ['repulsion', 'attraction', 'alignment', 'brownian']) {
  $(`w-${key}`).addEventListener('change', (e) => {
    sim.rules[key] = e.target.checked;
    selectOne($('stages'), null);
    $('stage-caption').textContent = 'Custom rule set.';
  });
}

function bindSlider(id, out, apply, format) {
  const el = $(id);
  const label = $(out);
  const handle = () => {
    const value = parseFloat(el.value);
    apply(value);
    label.innerHTML = format(value);
  };
  el.addEventListener('input', handle);
  handle();
}

const fixed = (n) => (v) => v.toFixed(n);
bindSlider('p-max', 'v-max', (v) => (sim.params.maxDistance = v), fixed(2));
bindSlider('p-rad', 'v-rad', (v) => (sim.params.repulsionRadius = v), fixed(2));
bindSlider('p-rep', 'v-rep', (v) => (sim.params.repulsionForce = v), fixed(3));
bindSlider('p-att', 'v-att', (v) => (sim.params.attractionForce = v), fixed(3));
bindSlider('p-ali', 'v-ali', (v) => (sim.params.alignmentForce = v), fixed(3));
bindSlider('p-brw', 'v-brw', (v) => (sim.params.brownianRange = v), fixed(3));
bindSlider('p-spd', 'v-spd', (v) => (state.speed = v), (v) => String(v));
bindSlider('p-lw', 'v-lw', (v) => (renderer.lineWeight = v), fixed(1));
bindSlider(
  'p-cap',
  'v-cap',
  (v) => {
    // The top of the range means no cap.
    state.cap = v >= 2050 ? Infinity : v;
    if (sim.iteration < state.cap) setRunning(state.running);
  },
  (v) => (v >= 2050 ? '&#8734;' : String(v)),
);

$('t-nodes').addEventListener('click', () => {
  renderer.showNodes = !renderer.showNodes;
  setPressed('t-nodes', renderer.showNodes);
});
$('t-trails').addEventListener('click', () => {
  renderer.showTrail = !renderer.showTrail;
  if (!renderer.showTrail) renderer.clearTrail();
  setPressed('t-trails', renderer.showTrail);
});
$('t-closed').addEventListener('click', () => {
  sim.closed = !sim.closed;
  setPressed('t-closed', sim.closed);
});

/* tabs */
const tabs = [
  [$('tab-controls'), $('view-controls')],
  [$('tab-about'), $('view-about')],
];
for (const [tab, view] of tabs) {
  tab.addEventListener('click', () => {
    for (const [t, v] of tabs) {
      const active = t === tab;
      t.setAttribute('aria-selected', active ? 'true' : 'false');
      v.hidden = !active;
    }
    view.scrollTop = 0;
  });
}

const panel = $('panel');
$('toggle-panel').addEventListener('click', togglePanel);

function togglePanel() {
  const hidden = panel.getAttribute('data-hidden') === 'true';
  panel.setAttribute('data-hidden', hidden ? 'false' : 'true');
  const label = hidden ? 'Hide panel' : 'Show panel';
  $('toggle-panel').title = `${label}  (H)`;
  $('toggle-panel').setAttribute('aria-label', label);
}

/* ---------------- export ------------------------------------------------- */
let toastTimer = null;

function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

$('copy').addEventListener('click', () => {
  renderer.toExportCanvas(colors().ground).toBlob(async (blob) => {
    if (!blob || !navigator.clipboard || !window.ClipboardItem) {
      toast('Clipboard unavailable — use download instead');
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied to clipboard');
    } catch {
      toast('Clipboard blocked — use download instead');
    }
  }, 'image/png');
});

$('download').addEventListener('click', () => {
  renderer.toExportCanvas(colors().ground).toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `differential-growth-${sim.iteration}i-${sim.nodes.length}n.png`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Saved PNG');
  }, 'image/png');
});

/* ---------------- drawing ------------------------------------------------ */
const canvas = $('stage');
let stroke = null;

function enterDrawMode() {
  state.drawMode = true;
  canvas.classList.add('drawing');
  $('hint').hidden = false;
  sim.seed([], false);
  sim.closed = false;
  setPressed('t-closed', false);
  renderer.clearTrail();
  renderer.lockView(Math.min(window.innerWidth, window.innerHeight) / 46);
  spark.clear();
}

function exitDrawMode() {
  state.drawMode = false;
  canvas.classList.remove('drawing');
  $('hint').hidden = true;
  renderer.view.locked = false;
}

function clearAndDraw() {
  selectOne($('seeds'), $('seeds').querySelector('[data-seed="draw"]'));
  enterDrawMode();
}

canvas.addEventListener('pointerdown', (e) => {
  if (!state.drawMode) return;
  stroke = [renderer.screenToWorld(e.clientX, e.clientY)];
  sim.nodes = stroke.slice();
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!stroke) return;
  const p = renderer.screenToWorld(e.clientX, e.clientY);
  if (distance(p, stroke[stroke.length - 1]) > 0.25) {
    stroke.push(p);
    sim.nodes = stroke.slice();
  }
});

canvas.addEventListener('pointerup', () => {
  if (!stroke) return;
  const raw = stroke;
  stroke = null;
  exitDrawMode();

  const seeded = fromStroke(raw, sim.params.maxDistance * 0.9);
  if (!seeded) {
    loadSeed('circle');
    selectOne($('seeds'), $('seeds').querySelector('[data-seed="circle"]'));
    setRunning(true);
    return;
  }

  sim.seed(seeded.points, seeded.closed);
  state.seed = 'stroke';
  state.strokeSeed = seeded;
  setPressed('t-closed', seeded.closed);
  renderer.resetView();
  spark.clear();
  setRunning(true);
});

/* ---------------- keys --------------------------------------------------- */
window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key.toLowerCase()) {
    case ' ': e.preventDefault(); setRunning(!state.running); break;
    case 's': setRunning(false); sim.step(); break;
    case 'r': restart(); break;
    case 'c': clearAndDraw(); break;
    case 'h': togglePanel(); break;
  }
});

/* ---------------- start -------------------------------------------------- */
loadSeed('circle');
for (let i = 0; i < 70; i++) {
  sim.step();
  if (i % 5 === 0) spark.push(sim.nodes.length);
}
requestAnimationFrame(frame);
