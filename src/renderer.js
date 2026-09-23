/**
 * Canvas rendering and the auto-fitting camera.
 *
 * The camera tracks the curve's bounding box and eases toward it, so the view
 * pulls back as the shape grows instead of the shape running off the edge.
 *
 * The grid texture is a CSS layer behind the canvas, not painted here — that
 * keeps exported images to just the curve on a flat ground.
 */

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = { cx: 0, cy: 0, scale: 20, locked: false };
    this.trail = [];
    this.trailMax = 34;
    this.showNodes = false;
    this.showTrail = false;
    this.lineWeight = 1.2;
  }

  resetView() {
    this.view.locked = false;
    this.trail = [];
  }

  /** Freeze the camera at a fixed frame — used while drawing. */
  lockView(scale) {
    this.view.cx = 0;
    this.view.cy = 0;
    this.view.scale = scale;
    this.view.locked = true;
  }

  captureTrail(nodes) {
    if (!this.showTrail) return;
    const flat = new Float64Array(nodes.length * 2);
    for (let i = 0; i < nodes.length; i++) {
      flat[i * 2] = nodes[i].x;
      flat[i * 2 + 1] = nodes[i].y;
    }
    this.trail.push(flat);
    if (this.trail.length > this.trailMax) this.trail.shift();
  }

  clearTrail() {
    this.trail = [];
  }

  #size() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    return { w, h, dpr };
  }

  #fit(nodes, w, h) {
    if (this.view.locked || !nodes.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }

    const bw = Math.max(maxX - minX, 4);
    const bh = Math.max(maxY - minY, 4);
    const target = Math.min(w / (bw * 1.3), h / (bh * 1.3));
    const tx = (minX + maxX) / 2;
    const ty = (minY + maxY) / 2;

    if (this.view.scale === 20 && this.view.cx === 0 && this.view.cy === 0) {
      this.view.scale = target;
      this.view.cx = tx;
      this.view.cy = ty;
      return;
    }
    const ease = 0.07;
    this.view.scale += (target - this.view.scale) * ease;
    this.view.cx += (tx - this.view.cx) * ease;
    this.view.cy += (ty - this.view.cy) * ease;
  }

  #trace(source, flat, closed, w, h) {
    const { cx, cy, scale } = this.view;
    const count = flat ? source.length / 2 : source.length;
    if (count < 2) return;

    for (let i = 0; i < count; i++) {
      const px = flat ? source[i * 2] : source[i].x;
      const py = flat ? source[i * 2 + 1] : source[i].y;
      const sx = (px - cx) * scale + w / 2;
      const sy = (py - cy) * scale + h / 2;
      if (i === 0) this.ctx.moveTo(sx, sy);
      else this.ctx.lineTo(sx, sy);
    }
    if (closed) this.ctx.closePath();
  }

  draw(sim, colors) {
    const { w, h, dpr } = this.#size();
    const ctx = this.ctx;

    this.#fit(sim.nodes, w, h);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (this.showTrail && this.trail.length) {
      ctx.strokeStyle = colors.curve;
      ctx.lineWidth = this.lineWeight * 0.6;
      for (let i = 0; i < this.trail.length; i++) {
        ctx.globalAlpha = 0.03 + 0.09 * (i / this.trail.length);
        ctx.beginPath();
        this.#trace(this.trail[i], true, sim.closed, w, h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = colors.curve;
    ctx.lineWidth = this.lineWeight;
    ctx.beginPath();
    this.#trace(sim.nodes, false, sim.closed, w, h);
    ctx.stroke();

    if (this.showNodes && sim.nodes.length <= 2600) {
      const { cx, cy, scale } = this.view;
      const r = Math.max(0.8, Math.min(2.2, scale * 0.09));
      ctx.fillStyle = colors.node;
      for (const n of sim.nodes) {
        ctx.beginPath();
        ctx.arc((n.x - cx) * scale + w / 2, (n.y - cy) * scale + h / 2, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Flatten onto an opaque background for export. */
  toExportCanvas(background) {
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(this.canvas, 0, 0);
    return out;
  }

  screenToWorld(clientX, clientY) {
    const { cx, cy, scale } = this.view;
    return {
      x: (clientX - window.innerWidth / 2) / scale + cx,
      y: (clientY - window.innerHeight / 2) / scale + cy,
    };
  }
}

/** Small node-count history plot under the readout. */
export class Sparkline {
  constructor(canvas, capacity = 90) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.capacity = capacity;
    this.values = [];
  }

  push(value) {
    this.values.push(value);
    if (this.values.length > this.capacity) this.values.shift();
  }

  clear() {
    this.values = [];
    this.draw({ accent: '#000', hair: '#000' });
  }

  draw(colors) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 184;
    const h = this.canvas.clientHeight || 46;
    if (this.canvas.width !== w * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // baseline
    ctx.strokeStyle = colors.hair;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();

    if (this.values.length < 2) return;

    const max = Math.max(...this.values, 1);
    const step = w / (this.capacity - 1);
    const pointAt = (i) => [i * step, h - 2 - (this.values[i] / max) * (h - 6)];

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < this.values.length; i++) ctx.lineTo(...pointAt(i));
    ctx.lineTo((this.values.length - 1) * step, h);
    ctx.closePath();
    ctx.fillStyle = colors.accent;
    ctx.globalAlpha = 0.12;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    for (let i = 0; i < this.values.length; i++) {
      const [x, y] = pointAt(i);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.3;
    ctx.stroke();

    const [lx, ly] = pointAt(this.values.length - 1);
    ctx.beginPath();
    ctx.arc(lx, ly, 2, 0, Math.PI * 2);
    ctx.fillStyle = colors.accent;
    ctx.fill();
  }
}
