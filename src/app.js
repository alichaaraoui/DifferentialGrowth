/**
 * UI wiring. Owns the simulation, the renderer and the control rack.
 */

import { DifferentialGrowth, STAGES, STAGE_NOTES, distance } from './growth.js';
import { SEEDS, fromStroke } from './seeds.js';
import { Renderer, Sparkline } from './renderer.js';
import { Slider } from './slider.js';
import { enhanceSelect } from './select.js';

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

const readVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const colors = () => ({
  curve: readVar('--curve'),
  node: readVar('--node'),
  accent: readVar('--accent'),
  hair: readVar('--hair'),
  ground: readVar('--field'),
});

/* ---------------- knobs -------------------------------------------------- */
const decimals = (n) => (v) => v.toFixed(n);
const CAP_MAX = 2050;

const controls = {
  repulsion: new Slider($('k-rep'), {
    label: 'repulsion', min: 0, max: 0.15, step: 0.005, value: 0.05,
    format: decimals(3), onChange: (v) => (sim.params.repulsionForce = v),
    toggle: (on) => setRule('repulsion', on),
  }),
  attraction: new Slider($('k-att'), {
    label: 'attraction', min: 0, max: 0.15, step: 0.005, value: 0.05,
    format: decimals(3), onChange: (v) => (sim.params.attractionForce = v),
    toggle: (on) => setRule('attraction', on),
  }),
  alignment: new Slider($('k-ali'), {
    label: 'alignment', min: 0, max: 0.06, step: 0.002, value: 0.01,
    format: decimals(3), onChange: (v) => (sim.params.alignmentForce = v),
    toggle: (on) => setRule('alignment', on),
  }),
  jitter: new Slider($('k-brw'), {
    label: 'jitter', min: 0, max: 0.6, step: 0.01, value: 0.15,
    format: decimals(2), onChange: (v) => (sim.params.brownianRange = v),
    toggle: (on) => setRule('brownian', on),
  }),
  detail: new Slider($('k-detail'), {
    label: 'detail', min: 0.4, max: 3, step: 0.05, value: 1,
    format: decimals(2), onChange: (v) => (sim.params.maxDistance = v),
  }),
  radius: new Slider($('k-radius'), {
    label: 'radius', min: 0.5, max: 6, step: 0.1, value: 2,
    format: decimals(1), onChange: (v) => (sim.params.repulsionRadius = v),
  }),
  speed: new Slider($('k-speed'), {
    label: 'speed', min: 1, max: 8, step: 1, value: 2,
    format: (v) => `${v}x`, onChange: (v) => (state.speed = v),
  }),
  cap: new Slider($('k-cap'), {
    label: 'stop at', min: 50, max: CAP_MAX, step: 50, value: CAP_MAX,
    format: (v) => (v >= CAP_MAX ? '∞' : String(v)),
    onChange: (v) => {
      state.cap = v >= CAP_MAX ? Infinity : v;
    },
  }),
  weight: new Slider($('k-weight'), {
    label: 'line weight', min: 0.4, max: 4, step: 0.1, value: 1.2,
    format: decimals(1), onChange: (v) => (renderer.lineWeight = v),
  }),
};

/* ---------------- selects ------------------------------------------------ */
enhanceSelect($('seed-select'));
enhanceSelect($('closed-select'));

function setSelect(id, value) {
  const el = $(id);
  el.value = value;
  el._dd?.sync();
}

/* ---------------- seeding ------------------------------------------------ */
function loadSeed(name) {
  const { points, closed } = SEEDS[name]();
  sim.seed(points, closed);
  state.seed = name;
  state.strokeSeed = null;
  setSelect('seed-select', name);
  setSelect('closed-select', closed ? 'closed' : 'open');
  renderer.resetView();
  spark.clear();
}

function restart() {
  if (state.seed === 'stroke' && state.strokeSeed) {
    sim.seed(state.strokeSeed.points, state.strokeSeed.closed);
    renderer.resetView();
    spark.clear();
  } else {
    loadSeed(state.seed);
  }
}

/* ---------------- keep the drawing clear of the floating furniture ------- */
const GAP = 26;

function updateInset() {
  const rackEl = $('rack');
  const hidden = rackEl.getAttribute('data-hidden') === 'true';
  const transport = document.querySelector('.transport').getBoundingClientRect();
  const bottom = Math.max(GAP, window.innerHeight - transport.top + 14);

  if (hidden) {
    renderer.setInset({ left: GAP, right: GAP, top: GAP, bottom });
    return;
  }

  const rackBox = rackEl.getBoundingClientRect();
  if (window.innerWidth <= 900) {
    // the rack docks to the bottom on narrow screens
    renderer.setInset({
      left: GAP, right: GAP, top: GAP,
      bottom: Math.max(bottom, window.innerHeight - rackBox.top + 14),
    });
  } else {
    renderer.setInset({ left: rackBox.right + GAP, right: GAP, top: GAP, bottom });
  }
}

window.addEventListener('resize', updateInset);
new ResizeObserver(updateInset).observe($('rack'));

/* ---------------- loop --------------------------------------------------- */
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
const PAUSE_ICON = '<rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/>';
const PLAY_ICON = '<path d="M7 5.2v13.6c0 .8.9 1.3 1.6.9l10.2-6.8c.6-.4.6-1.4 0-1.8L8.6 4.3C7.9 3.9 7 4.4 7 5.2z"/>';

function setRunning(on) {
  state.running = on;
  $('play-icon').innerHTML = on ? PAUSE_ICON : PLAY_ICON;
  $('play').title = on ? 'pause  (space)' : 'play  (space)';
  $('play').setAttribute('aria-label', on ? 'Pause' : 'Play');
  const led = $('led');
  led.dataset.state = on ? 'run' : 'hold';
  led.title = on ? 'running' : 'paused';
}

$('play').addEventListener('click', () => setRunning(!state.running));
$('step').addEventListener('click', () => {
  setRunning(false);
  sim.step();
  spark.push(sim.nodes.length);
});
$('reset').addEventListener('click', restart);
$('clear').addEventListener('click', clearAndDraw);

/* ---------------- rack --------------------------------------------------- */
$('seed-select').addEventListener('change', (e) => {
  exitDrawMode();
  $('draw-btn').setAttribute('aria-pressed', 'false');
  loadSeed(e.target.value);
});

$('closed-select').addEventListener('change', (e) => {
  sim.closed = e.target.value === 'closed';
});

$('draw-btn').addEventListener('click', clearAndDraw);

function selectStage(stage) {
  for (const b of $('stages').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', b.dataset.stage === stage ? 'true' : 'false');
  }
  for (const [key, on] of Object.entries(STAGES[stage])) {
    sim.rules[key] = on;
    setLed(key, on);
  }
  $('stage-note').textContent = STAGE_NOTES[stage].toLowerCase();
  restart();
}

$('stages').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn) selectStage(btn.dataset.stage);
});

const RULE_SLIDER = {
  repulsion: 'repulsion', attraction: 'attraction',
  alignment: 'alignment', brownian: 'jitter',
};

function setLed(rule, on) {
  controls[RULE_SLIDER[rule]]?.setEnabled(on);
}

/** Toggling a rule by hand leaves the numbered stages behind. */
function setRule(rule, on) {
  sim.rules[rule] = on;
  for (const b of $('stages').querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
  $('stage-note').textContent = 'custom rule set.';
}

$('t-nodes').addEventListener('click', () => {
  renderer.showNodes = !renderer.showNodes;
  $('t-nodes').setAttribute('aria-pressed', String(renderer.showNodes));
});
$('t-trails').addEventListener('click', () => {
  renderer.showTrail = !renderer.showTrail;
  if (!renderer.showTrail) renderer.clearTrail();
  $('t-trails').setAttribute('aria-pressed', String(renderer.showTrail));
});

$('reset-settings').addEventListener('click', () => {
  for (const control of Object.values(controls)) control.reset();
  selectStage('5');
  toast('settings reset');
});

const tabs = [
  [$('tab-controls'), $('view-controls')],
  [$('tab-about'), $('view-about')],
];
for (const [tab, view] of tabs) {
  tab.addEventListener('click', () => {
    for (const [t, v] of tabs) {
      const active = t === tab;
      t.setAttribute('aria-selected', String(active));
      v.hidden = !active;
    }
    view.scrollTop = 0;
  });
}

const rack = $('rack');
$('toggle-rack').addEventListener('click', toggleRack);

function toggleRack() {
  const hidden = rack.getAttribute('data-hidden') === 'true';
  rack.setAttribute('data-hidden', hidden ? 'false' : 'true');
  updateInset();
  $('toggle-rack').title = hidden ? 'hide rack  (h)' : 'show rack  (h)';
  $('toggle-rack').setAttribute('aria-label', hidden ? 'Hide rack' : 'Show rack');
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
      toast('clipboard unavailable — use download instead');
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('copied to clipboard');
    } catch {
      toast('clipboard blocked — use download instead');
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
    toast('saved png');
  }, 'image/png');
});

/* ---------------- drawing ------------------------------------------------ */
const canvas = $('stage');
let stroke = null;

function enterDrawMode() {
  state.drawMode = true;
  canvas.classList.add('drawing');
  $('hint').hidden = false;
  $('draw-btn').setAttribute('aria-pressed', 'true');
  sim.seed([], false);
  sim.closed = false;
  setSelect('closed-select', 'open');
  renderer.clearTrail();
  renderer.lockView();
  spark.clear();
}

function exitDrawMode() {
  state.drawMode = false;
  canvas.classList.remove('drawing');
  $('hint').hidden = true;
  renderer.view.locked = false;
}

function clearAndDraw() {
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
  $('draw-btn').setAttribute('aria-pressed', 'false');

  const seeded = fromStroke(raw, sim.params.maxDistance * 0.9);
  if (!seeded) {
    loadSeed('circle');
    return;
  }

  sim.seed(seeded.points, seeded.closed);
  state.seed = 'stroke';
  state.strokeSeed = seeded;
  setSelect('seed-select', 'stroke');
  setSelect('closed-select', seeded.closed ? 'closed' : 'open');
  renderer.resetView();
  spark.clear();
});

/* ---------------- keys --------------------------------------------------- */
window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.target.closest('.knob-dial')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key.toLowerCase()) {
    case ' ': e.preventDefault(); setRunning(!state.running); break;
    case 's': setRunning(false); sim.step(); break;
    case 'r': restart(); break;
    case 'd': clearAndDraw(); break;
    case 'h': toggleRack(); break;
    default: return;
  }
});

/* ---------------- start -------------------------------------------------- */
$('stage-note').textContent = STAGE_NOTES[5].toLowerCase();
updateInset();
loadSeed('circle');
// Open on a grown curve rather than a bare circle, but held — pressing play
// is the user's call, not ours.
for (let i = 0; i < 70; i++) {
  sim.step();
  if (i % 5 === 0) spark.push(sim.nodes.length);
}
setRunning(false);
requestAnimationFrame(frame);
