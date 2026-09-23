/**
 * Differential growth on a polyline.
 *
 * The curve is an ordered list of nodes. Node i's neighbours are i-1 and i+1;
 * on a closed curve those indices wrap. That ordering IS the shape — shuffle
 * the list and you have the same points describing a different curve.
 *
 * Each step runs three phases, in this order:
 *
 *   1. split   — insert a node in the middle of any edge past maxDistance
 *   2. prune   — drop nodes that have crowded closer than minDistance
 *   3. forces  — sum every active force, then move all nodes at once
 *
 * Forces are accumulated into a displacement buffer and applied only after
 * every force has been evaluated. Moving nodes as you go would make the
 * result depend on the order they happen to be stored in.
 */

export const DEFAULTS = {
  maxDistance: 1.0,        // split an edge once it reaches this length
  minPerMax: 0.5,          // prune threshold, as a fraction of maxDistance
  repulsionRadius: 2.0,    // nodes repel each other within this distance
  repulsionForce: 0.05,
  attractionForce: 0.05,
  alignmentForce: 0.01,
  brownianRange: 0.15,
  maxNodes: 7000,
};

export class DifferentialGrowth {
  constructor(params = {}) {
    this.params = { ...DEFAULTS, ...params };
    this.rules = { repulsion: true, attraction: true, alignment: true, brownian: true };
    this.nodes = [];
    this.closed = true;
    this.iteration = 0;
  }

  /** Replace the curve. `points` is [{x, y}, ...] in curve order. */
  seed(points, closed = true) {
    this.nodes = points.map((p) => ({ x: p.x, y: p.y }));
    this.closed = closed;
    this.iteration = 0;
  }

  get minDistance() {
    return this.params.maxDistance * this.params.minPerMax;
  }

  step() {
    this.#split();
    this.#prune();
    this.#applyForces();
    this.iteration++;
  }

  /** Longest edge on the curve — the number subdivision is gated on. */
  longestEdge() {
    const n = this.nodes.length;
    if (n < 2) return 0;
    const last = this.closed ? n : n - 1;
    let longest = 0;
    for (let i = 0; i < last; i++) {
      const d = distance(this.nodes[i], this.nodes[(i + 1) % n]);
      if (d > longest) longest = d;
    }
    return longest;
  }

  /* ----------------------------------------------------------- *
   * 1. Subdivision — the only thing that adds nodes.
   * ----------------------------------------------------------- */
  #split() {
    const { maxDistance, maxNodes } = this.params;
    const nodes = this.nodes;
    const n = nodes.length;
    const last = this.closed ? n : n - 1;
    const out = [];

    for (let i = 0; i < n; i++) {
      out.push(nodes[i]);
      if (i >= last || out.length >= maxNodes) continue;

      const next = nodes[(i + 1) % n];
      if (distance(nodes[i], next) >= maxDistance) {
        // Appending the node first and the midpoint second puts the new node
        // in the right place with no insertion index to compute.
        out.push({ x: (nodes[i].x + next.x) / 2, y: (nodes[i].y + next.y) / 2 });
      }
    }
    this.nodes = out;
  }

  /* ----------------------------------------------------------- *
   * 2. Pruning — the inverse, so node count can fall as well as rise.
   * ----------------------------------------------------------- */
  #prune() {
    const nodes = this.nodes;
    if (nodes.length <= 4) return;

    const min = this.minDistance;
    const kept = [nodes[0]];

    for (let i = 1; i < nodes.length; i++) {
      // Measured against the last node KEPT, not the previous node in the
      // input, so a whole cluster collapses to one rather than alternating.
      if (distance(nodes[i], kept[kept.length - 1]) >= min) kept.push(nodes[i]);
    }

    // The main loop never sees the edge that closes the loop, so check it here.
    if (this.closed && kept.length > 4 && distance(kept[kept.length - 1], kept[0]) < min) {
      kept.pop();
    }
    this.nodes = kept;
  }

  /* ----------------------------------------------------------- *
   * 3. Forces.
   * ----------------------------------------------------------- */
  #applyForces() {
    const nodes = this.nodes;
    const n = nodes.length;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);

    if (this.rules.repulsion && this.params.repulsionForce > 0) this.#repel(dx, dy);
    if (this.rules.attraction || this.rules.alignment) this.#neighbourForces(dx, dy);
    if (this.rules.brownian && this.params.brownianRange > 0) this.#jitter(dx, dy);

    for (let i = 0; i < n; i++) {
      nodes[i].x += dx[i];
      nodes[i].y += dy[i];
    }
  }

  /**
   * Every node pushes away from every other node inside repulsionRadius —
   * including nodes far away along the curve that have folded round next to
   * it, which is what stops the curve passing through itself.
   *
   * Checking every pair is O(n^2). Bucketing nodes into a grid of cells the
   * size of the radius means each node only tests the nine cells around it,
   * which is roughly O(n) for the near-uniform spacing subdivision produces.
   */
  #repel(dx, dy) {
    const nodes = this.nodes;
    const n = nodes.length;
    const radius = this.params.repulsionRadius;
    const force = this.params.repulsionForce;
    const inv = 1 / radius;

    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(nodes[i].x * inv)},${Math.floor(nodes[i].y * inv)}`;
      const cell = grid.get(key);
      if (cell) cell.push(i);
      else grid.set(key, [i]);
    }

    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      const gx = Math.floor(node.x * inv);
      const gy = Math.floor(node.y * inv);

      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const cell = grid.get(`${gx + ox},${gy + oy}`);
          if (!cell) continue;

          for (let k = 0; k < cell.length; k++) {
            const j = cell[k];
            if (j === i) continue;

            const ax = node.x - nodes[j].x;
            const ay = node.y - nodes[j].y;
            const d = Math.sqrt(ax * ax + ay * ay);
            if (d <= 0 || d >= radius) continue;

            // Linear falloff: full strength touching, nothing at the radius.
            // Dividing by d normalises the direction in the same step.
            const m = ((radius - d) * force) / d;
            dx[i] += ax * m;
            dy[i] += ay * m;
          }
        }
      }
    }
  }

  /**
   * Attraction pulls a node toward its neighbours; alignment pulls it toward
   * their midpoint. Both read the same two neighbours, so they share a loop.
   *
   * On an open curve the endpoints have only one neighbour. They still
   * attract to it, but alignment is skipped — there is no midpoint to aim at.
   */
  #neighbourForces(dx, dy) {
    const nodes = this.nodes;
    const n = nodes.length;
    const attract = this.rules.attraction ? this.params.attractionForce : 0;
    const align = this.rules.alignment ? this.params.alignmentForce : 0;
    if (attract === 0 && align === 0) return;

    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? i - 1 : this.closed ? n - 1 : -1;
      const next = i < n - 1 ? i + 1 : this.closed ? 0 : -1;
      const node = nodes[i];

      if (attract > 0) {
        if (prev >= 0) {
          dx[i] += attract * (nodes[prev].x - node.x);
          dy[i] += attract * (nodes[prev].y - node.y);
        }
        if (next >= 0) {
          dx[i] += attract * (nodes[next].x - node.x);
          dy[i] += attract * (nodes[next].y - node.y);
        }
      }

      if (align > 0 && prev >= 0 && next >= 0) {
        dx[i] += align * ((nodes[prev].x + nodes[next].x) / 2 - node.x);
        dy[i] += align * ((nodes[prev].y + nodes[next].y) / 2 - node.y);
      }
    }
  }

  /**
   * A small random nudge. The starting shapes are symmetric enough that every
   * node feels near-identical forces, and the curve settles just under the
   * split threshold. This keeps knocking edges back over it.
   */
  #jitter(dx, dy) {
    const half = this.params.brownianRange / 2;
    for (let i = 0; i < dx.length; i++) {
      dx[i] += (Math.random() * 2 - 1) * half;
      dy[i] += (Math.random() * 2 - 1) * half;
    }
  }
}

export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Rule sets for the numbered build stages. */
export const STAGES = {
  1: { repulsion: false, attraction: false, alignment: false, brownian: false },
  2: { repulsion: true, attraction: false, alignment: false, brownian: false },
  3: { repulsion: true, attraction: true, alignment: false, brownian: false },
  4: { repulsion: true, attraction: true, alignment: true, brownian: false },
  5: { repulsion: true, attraction: true, alignment: true, brownian: true },
};

export const STAGE_NOTES = {
  1: 'Subdivision only. Nodes multiply but nothing moves — the shape is identical in every frame.',
  2: 'Repulsion on. Edges stretch back past the split threshold, so subdivision keeps firing. This alone is the whole algorithm.',
  3: 'Attraction added. It counters repulsion and holds the curve together, and the two settle near equilibrium.',
  4: 'Alignment added. Corners round off. Still a symmetric force, so it cannot break the balance by itself.',
  5: 'All rules active. Jitter keeps knocking edges back over the split threshold, so growth compounds.',
};
