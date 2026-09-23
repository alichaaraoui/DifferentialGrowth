# Differential Growth

An interactive differential growth simulator. Seed a shape or draw your own, switch
the rules on one at a time, and watch a curve fold itself.

**[Live demo →](https://alichaaraoui.github.io/DifferentialGrowth/)**

---

## What it does

The curve is an ordered list of nodes. Two rules do all the work:

- **Subdivision** inserts a new node in the middle of any edge that stretches past a
  threshold. It is the only source of new nodes.
- **Repulsion** pushes every node away from any other node that comes too close —
  including nodes far away along the curve that have folded round next to it.

Subdivision supplies material; repulsion stretches the edges back past the threshold
so subdivision fires again. That feedback is the growth. The folds are what a curve
does when it is forced to get longer inside a space that is not getting bigger — the
same process behind cabbage leaves, coral, gut lining and cortical folding.

Three more rules shape the result without driving it: **attraction** holds neighbours
together, **alignment** rounds off corners, and **jitter** keeps knocking edges back
over the split threshold so growth does not stall.

## What is in here

```
notebook/           the original Python/NumPy implementation
index.html          the interface — markup and controls
src/growth.js       the algorithm: subdivision, pruning, the four forces
src/seeds.js        starting shapes, and resampling a freehand stroke into one
src/renderer.js     canvas drawing, the auto-fitting camera, the sparkline
src/slider.js       labelled slider with an optional enable LED
src/select.js       styled listbox over a native <select>
src/app.js          wiring between the controls and the simulation
src/styles.css      tokens and layout, light and dark
```

No dependencies and no build step. `src/growth.js` has no dependency on the browser
either — no DOM, no canvas — so it can be imported on its own:

```js
import { DifferentialGrowth } from './src/growth.js';

const sim = new DifferentialGrowth({ maxDistance: 1.0, repulsionRadius: 2.0 });
sim.seed([{ x: -5, y: 0 }, { x: 5, y: 0 }], false); // open curve
for (let i = 0; i < 200; i++) sim.step();
console.log(sim.nodes.length);
```

## The interface

- Seven seed shapes plus freehand drawing on the canvas
- **Open and closed curves.** `Line` and `Arc` seed an open curve, which grows outward
  from its tips rather than ruffling inward
- Numbered build stages that enable the rules one at a time, so each isolates a single
  contribution
- Every parameter live: split threshold, repulsion radius, all four force strengths,
  simulation speed and an iteration cap
- Growth rings — the last 34 curves stroked faintly underneath, as contour lines
- Export to PNG by download or clipboard

## The notebook

[`notebook/differential-growth.ipynb`](notebook/differential-growth.ipynb) is where the
algorithm was worked out, in Python and NumPy. It builds the rules up one at a time and
checks them by arithmetic rather than by eye — four nodes on a circle of radius 5 gives a
square with sides of exactly 5√2, so subdivision is predicted to go 4 → 8 → 16 → 32 with
edges halving each pass, and either it does or the code is wrong.

**The app does not run the notebook.** `src/growth.js` is a hand-written port, so the two
are independent implementations of the same rules. The names were kept deliberately:

| notebook | `src/growth.js` |
|---|---|
| `splitEdges` | `#split` |
| `pruneNodes` | `#prune` |
| `applyRepulsion` | `#repel` — same rule, spatially hashed |
| `applyAttraction`, `applyAlignment` | `#neighbourForces` — one pass, same two neighbours |
| `applyBrownianMotion` | `#jitter` |
| `getConnectedNode` | index wrapping, inline |
| `Particle`, `as_array` | plain `{ x, y }` objects; JavaScript needs no bridge to an array |

## Notes on the implementation

Three things differ from the notebook.

**Repulsion is spatially hashed.** Comparing every node against every other is
O(n²) — fine to about a thousand nodes and slow beyond it. Nodes are bucketed into a
grid of cells the size of the repulsion radius, so each node only tests the nine cells
around it. That is close to O(n) for the near-uniform spacing subdivision produces, and
holds sixty frames a second to twelve thousand nodes.

**Forces return displacements rather than moving nodes.** Every force is evaluated
against the same unchanged snapshot and applied in one pass at the end. Moving nodes
as you go makes the result depend on the order they happen to be stored in.

**Endpoints are handled explicitly** so open curves work. An endpoint attracts toward
its single neighbour and is skipped by alignment, since it has no midpoint to align to.
The closing edge is excluded from subdivision and pruning when the curve is open.

## Credits

Built by **Ali Chaaraoui** and **Jay Anupoju**.

- [Jason Webb — *2D Differential Growth in JS*](https://medium.com/@jason.webb/2d-differential-growth-in-js-1843fd51b0ce)
- [Kaspar — *Differential Growth*](https://www.kaspar.wtf/blog/differential-growth)
