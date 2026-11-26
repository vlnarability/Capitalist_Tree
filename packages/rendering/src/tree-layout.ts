/**
 * W64/W65 — shared tree layout (pure state → geometry).
 *
 * `buildTreeLayout` is the pure layout function: it reads a `TreeRenderData`
 * snapshot + viewport dimensions + a structural signature, and produces the
 * pre-computed geometry (trunk, branches, leaf slots, damage markers) that
 * every drawing backend consumes. It was extracted from the Canvas renderer's
 * `_buildStructure` so the SVG (W64) + WebGL (W65) renderers share the exact
 * same layout as Canvas — no per-backend drift.
 *
 * Pure: never mutates `tree`. Deterministic: the same (tree, width, height,
 * signature) always produces the same layout (LCG-seeded from the signature).
 *
 * Layout field derivation mirrors `buildTreeRenderData` (TDD §15.1) — every
 * biological/economic decision was already made by the sim before this runs;
 * this function only decides pixel geometry.
 */
import type { TreeRenderData, SpeciesShape } from './types.js';
import {
  PROVISIONAL_RENDER_TREE_BASELINE_FRACTION,
  PROVISIONAL_RENDER_TREE_HEIGHT_SCALE_PX_PER_M,
  PROVISIONAL_RENDER_TRUNK_DIAMETER_SCALE_PX_PER_M,
  PROVISIONAL_RENDER_MIN_TREE_HEIGHT_PX,
  PROVISIONAL_RENDER_MAX_TREE_HEIGHT_PX,
  PROVISIONAL_RENDER_MAX_BRANCH_DEPTH,
  PROVISIONAL_RENDER_BRANCH_ANGLE_SPREAD_DEG,
  PROVISIONAL_RENDER_BRANCH_CHILD_COUNT,
  PROVISIONAL_RENDER_BRANCH_LENGTH_DECAY,
  PROVISIONAL_RENDER_BRANCH_DIAMETER_DECAY,
} from './constants/rendering.js';

// ============================================================================
// Layout types (shared across Canvas / SVG / WebGL backends).
// ============================================================================

/** A pre-computed branch segment in the cached layout. */
export interface BranchSegment {
  /** Start point (canvas px, origin top-left). */
  readonly x0: number;
  readonly y0: number;
  /** End point (canvas px). */
  readonly x1: number;
  readonly y1: number;
  /** Recursion depth from the trunk (0 = trunk itself). */
  readonly depth: number;
  /** Diameter in px. */
  readonly diameter: number;
}

/** A pre-computed leaf attachment slot. */
export interface LeafSlot {
  /** Position (canvas px). */
  readonly x: number;
  readonly y: number;
  /** Currency denomination tier (0..2). */
  readonly tier: number;
  /** Per-slot sway phase offset (radians). */
  readonly phaseOffset: number;
  /** Per-slot size jitter multiplier (~1.0). */
  readonly sizeJitter: number;
}

/** A pre-computed damage marker placement. */
export interface DamageMarkerPlacement {
  readonly x: number;
  readonly y: number;
  readonly severity: number;
  readonly type: string;
}

/**
 * Pre-computed tree layout (recomputed only when the structural signature
 * changes). The drawing backend caches this + paints it each frame.
 */
export interface TreeLayout {
  readonly signature: string;
  readonly branches: readonly BranchSegment[];
  readonly leafSlots: readonly LeafSlot[];
  readonly damageMarkers: readonly DamageMarkerPlacement[];
  /** True when the tree is dead (alive=false) — renderer draws a stump only. */
  readonly stump: boolean;
  /** Trunk base (canvas px, origin top-left). */
  readonly baseX: number;
  readonly baseY: number;
  /** Rendered tree height (px, clamped to MIN/MAX). */
  readonly treeHeightPx: number;
  /** Trunk length (px). */
  readonly trunkLengthPx: number;
  /** Trunk diameter (px). */
  readonly trunkDiameterPx: number;
}

// ============================================================================
// Deterministic RNG (LCG) + string-hash seed.
//
// Linear-congruential generator (Numerical Recipes constants). Deterministic
// across JS engines (unlike Math.random) — the same seed always produces the
// same sequence, so the same TreeRenderData always produces the same tree.
// ============================================================================

function createLcg(seed: number): () => number {
  let s = seed >>> 0;
  // Avoid the degenerate seed=0 case (the LCG would stay at 0 for one step).
  if (s === 0) s = 0xdeadbeef;
  return () => {
    // a = 1664525, c = 1013904223, m = 2^32 (Numerical Recipes).
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** FNV-1a string hash → uint32 seed. */
function hashStringToSeed(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ============================================================================
// W63: per-shape canopy geometry — varies the leaf-slot distribution + canopy
// dimensions by SpeciesShape so each silhouette renders distinctly:
//   broadleaf-round — spreading rounded canopy (oak, live oak, baobab).
//   broadleaf-oval  — taller/oval canopy (beech, kapok, mahogany).
//   conical         — narrowing upward (spruce, hemlock, pine, redwood).
//   columnar        — tall + narrow (lodgepole pine, poplar, cypress).
//   palm            — frond crown radiating from the trunk apex (date palm).
//   unknown         — fallback to broadleaf-round (the baseline).
// See tree-render-data.ts SPECIES_SHAPE_BY_ID for the species→shape mapping.
// ============================================================================

/** Distribution mode the leaf-slot loop uses for a given shape. */
export type CanopyMode = 'disc' | 'cone' | 'fan';

/** Per-shape canopy geometry: radii (px), center-Y offset above the trunk top
 * (px, positive = up), + the distribution mode. */
export interface CanopyGeometry {
  readonly radiusX: number;
  readonly radiusY: number;
  readonly centerYAboveTrunkTop: number;
  readonly mode: CanopyMode;
}

/**
 * Resolve a SpeciesShape to its canopy geometry. Pure — a function of shape +
 * tree height. Used by `buildTreeLayout`'s leaf-slot loop.
 */
export function canopyGeometryForShape(
  shape: SpeciesShape,
  treeHeightPx: number,
): CanopyGeometry {
  switch (shape) {
    case 'broadleaf-oval': // taller, slightly narrower (maple/birch/beech/kapok)
      return { radiusX: treeHeightPx * 0.30, radiusY: treeHeightPx * 0.42, centerYAboveTrunkTop: treeHeightPx * 0.25, mode: 'disc' };
    case 'conical': // narrowing upward (spruce/fir/hemlock/pine/redwood)
      return { radiusX: treeHeightPx * 0.35, radiusY: treeHeightPx * 0.45, centerYAboveTrunkTop: treeHeightPx * 0.22, mode: 'cone' };
    case 'columnar': // narrow + tall (lodgepole pine/poplar/cypress)
      return { radiusX: treeHeightPx * 0.18, radiusY: treeHeightPx * 0.45, centerYAboveTrunkTop: treeHeightPx * 0.25, mode: 'disc' };
    case 'palm': // fronds radiating from the trunk apex (downward fan)
      return { radiusX: treeHeightPx * 0.40, radiusY: treeHeightPx * 0.30, centerYAboveTrunkTop: 0, mode: 'fan' };
    case 'broadleaf-round': // rounded spreading canopy (oak) — the baseline
    case 'unknown':
    default:
      return { radiusX: treeHeightPx * 0.35, radiusY: treeHeightPx * 0.35, centerYAboveTrunkTop: treeHeightPx * 0.20, mode: 'disc' };
  }
}

// ============================================================================
// treeStructureSignature — the cache key for buildTreeLayout.
//
// Only fields that affect the LAYOUT (branch positions, leaf-slot positions)
// are included. Cosmetic per-frame fields (foliage density, damage list,
// seasonal appearance) do NOT trigger a rebuild — they're applied at draw
// time against the cached layout. This keeps per-frame cost low: a tree
// growing slowly rebuilds only when height crosses an integer metre, not on
// every animation frame.
// ============================================================================

/**
 * Derive the structural signature for a tree + viewport. Used by every
 * drawing backend (Canvas / SVG / WebGL) to decide when to rebuild the cached
 * `TreeLayout`. Pure.
 */
export function treeStructureSignature(
  tree: TreeRenderData,
  width: number,
  height: number,
): string {
  return [
    tree.speciesId,
    tree.speciesShape,
    // Quantise height to 0.1 m to avoid thrashing the cache during slow growth.
    Math.round(tree.height * 10) / 10,
    // Quantise trunk diameter to 0.01 m.
    Math.round(tree.trunkDiameter * 100) / 100,
    // Quantise branchDevelopment to nearest 0.5 unit (0..100 → 200 buckets).
    Math.round(tree.branchDevelopment * 2) / 2,
    tree.alive ? 'alive' : 'dead',
    // ageDays affects trunk texture (sapling vs mature) but is a coarse driver.
    Math.floor(tree.ageDays / 10),
    width,
    height,
  ].join('|');
}

// ============================================================================
// buildTreeLayout — pure TreeRenderData → TreeLayout.
// ============================================================================

/**
 * Build the procedural tree layout from a `TreeRenderData` snapshot (TDD §15.1).
 *
 * Pure: the input `tree` is never mutated. The output is a fresh `TreeLayout`.
 * Deterministic: seeded from `signature` (the structural signature from
 * `treeStructureSignature`) so the same tree always produces the same layout.
 *
 * Geometry:
 *   - `baseX` = width/2; `baseY` = height × TREE_BASELINE_FRACTION.
 *   - `treeHeightPx` = clamp(height × SCALE, [MIN, MAX]).
 *   - `trunkDiameterPx` = max(2, trunkDiameter × SCALE).
 *   - Dead (`alive=false`) → stump only (no branches/leaves/damage).
 *   - `trunkLengthPx` = treeHeightPx × 0.45; branches grow recursively from
 *     the trunk top (depth derived from `branchDevelopment`).
 *   - Palms (`speciesShape === 'palm'`) → `branchDepth = 0` (trunk only; the
 *     frond crown is the leaf slots, distributed in a downward fan).
 *   - Leaf slots: `canopyGeometryForShape` picks the distribution mode
 *     (disc/ellipse, cone narrowing upward, fan from the apex).
 *   - Damage markers: placed along the trunk by `appliedAt` timestamp.
 */
export function buildTreeLayout(
  tree: TreeRenderData,
  width: number,
  height: number,
  signature: string,
): TreeLayout {
  const baseX = width / 2;
  const baseY = height * PROVISIONAL_RENDER_TREE_BASELINE_FRACTION;

  // Rendered tree height: clamp height × scale into [MIN, MAX] px.
  const treeHeightPx = Math.min(
    PROVISIONAL_RENDER_MAX_TREE_HEIGHT_PX,
    Math.max(
      PROVISIONAL_RENDER_MIN_TREE_HEIGHT_PX,
      tree.height * PROVISIONAL_RENDER_TREE_HEIGHT_SCALE_PX_PER_M,
    ),
  );

  // Trunk diameter in px. Floor at 2 px so saplings still have a visible trunk.
  const trunkDiameterPx = Math.max(
    2,
    tree.trunkDiameter * PROVISIONAL_RENDER_TRUNK_DIAMETER_SCALE_PX_PER_M,
  );

  // Dead tree → stump only.
  if (!tree.alive) {
    const stumpHeightPx = Math.min(treeHeightPx * 0.18, 50);
    const stump: BranchSegment = {
      x0: baseX,
      y0: baseY,
      x1: baseX,
      y1: baseY - stumpHeightPx,
      depth: 0,
      diameter: trunkDiameterPx * 1.3, // Stumps are stubby + thick.
    };
    return {
      signature,
      branches: [stump],
      leafSlots: [],
      damageMarkers: [], // Damage markers are not drawn on a stump.
      stump: true,
      baseX,
      baseY,
      treeHeightPx: stumpHeightPx,
      trunkLengthPx: stumpHeightPx,
      trunkDiameterPx: stump.diameter,
    };
  }

  // Trunk length: ~45% of tree height (canopy occupies the remaining 55%).
  const trunkLengthPx = treeHeightPx * 0.45;

  // Branch recursion depth: derived from branchDevelopment (0..100 → 1..MAX).
  // W63: palms have no branches — just the trunk + a frond crown (leaf slots).
  // branchDepth = 0 so `grow` pushes only the trunk segment (no recursion).
  const branchDepth =
    tree.speciesShape === 'palm'
      ? 0
      : Math.max(
          1,
          Math.min(
            PROVISIONAL_RENDER_MAX_BRANCH_DEPTH,
            1 + Math.floor(tree.branchDevelopment / 25),
          ),
        );

  // LCG seeded from the structural signature.
  const rng = createLcg(hashStringToSeed(signature));

  // Recursive branch generator.
  const branches: BranchSegment[] = [];
  const angleSpreadRad = (PROVISIONAL_RENDER_BRANCH_ANGLE_SPREAD_DEG * Math.PI) / 180;

  const grow = (
    x0: number,
    y0: number,
    angle: number, // 0 = straight up; positive = clockwise.
    length: number,
    diameter: number,
    depth: number,
  ): void => {
    const x1 = x0 + Math.sin(angle) * length;
    const y1 = y0 - Math.cos(angle) * length;
    branches.push({ x0, y0, x1, y1, depth, diameter });

    if (depth >= branchDepth) return;

    const childCount = PROVISIONAL_RENDER_BRANCH_CHILD_COUNT;
    const childLen = length * PROVISIONAL_RENDER_BRANCH_LENGTH_DECAY;
    const childDia = Math.max(0.5, diameter * PROVISIONAL_RENDER_BRANCH_DIAMETER_DECAY);

    for (let i = 0; i < childCount; i++) {
      // Even fan distribution across [-1, +1] when there are multiple
      // children; falls back to straight-ahead when only one. Using a
      // `Math.max(1, ...)` denom avoids divide-by-zero without tripping
      // TS2367 (which would flag a `childCount === 1` literal-type check
      // against the constant `2`).
      const denom = Math.max(1, childCount - 1);
      const t = (i / denom) * 2 - 1;
      const jitter = (rng() * 2 - 1) * 0.4; // ±40% jitter.
      const childAngleOffset = (t + jitter) * angleSpreadRad;
      // Children fan outward from the parent's direction.
      let childAngle = angle + childAngleOffset;

      // Constrain: children must not bend backward below the parent's start.
      // (Prevents branches that grow back down into the ground.)
      if (childAngle > Math.PI / 2) childAngle = Math.PI / 2;
      if (childAngle < -Math.PI / 2) childAngle = -Math.PI / 2;

      // Slight upward bias so the canopy stays round, not drooping.
      const upwardBias = (1 - depth / branchDepth) * 0.15;
      const biasedAngle = childAngle * (1 - upwardBias * 0.2);

      grow(x1, y1, biasedAngle, childLen, childDia, depth + 1);
    }
  };

  grow(baseX, baseY, 0, trunkLengthPx, trunkDiameterPx, 0);

  // ----- Leaf slots -----
  // Distribute leaf slots around the canopy. Each slot's tier is picked from a
  // deterministic distribution: ~70% tier 0, ~20% tier 1, ~10% tier 2.
  // W63: per-shape canopy geometry — varies the leaf-slot distribution by
  // SpeciesShape (round oak vs oval maple vs conical spruce vs columnar poplar
  // vs palm frond crown).
  const geo = canopyGeometryForShape(tree.speciesShape, treeHeightPx);
  const canopyCenterX = baseX;
  const trunkTopY = baseY - trunkLengthPx;
  const canopyCenterY = trunkTopY - geo.centerYAboveTrunkTop;

  // Cap the total slot count to keep per-frame draw cost bounded.
  const maxSlots = 120;
  const densityFactor = Math.min(1, Math.max(0, tree.foliageDensity));
  const slotCount = Math.max(0, Math.round(maxSlots * densityFactor));

  const leafSlots: LeafSlot[] = [];
  for (let i = 0; i < slotCount; i++) {
    // W63: distribution varies by shape mode.
    //   disc — ellipse (broadleaf-round/oval, columnar): uniform-in-ellipse.
    //   cone — narrowing upward (conical): radius shrinks linearly with height.
    //   fan  — fronds from the apex (palm): downward semicircle radiating out.
    const theta = rng() * Math.PI * 2;
    let x: number;
    let y: number;
    if (geo.mode === 'fan') {
      // Palm: fronds radiate from the trunk apex outward + downward.
      // Lower hemisphere (theta in [0,π] → sin ≥ 0 → downward).
      const fanTheta = rng() * Math.PI;
      const fanR = (0.2 + rng() * 0.8) * geo.radiusX;
      x = canopyCenterX + Math.cos(fanTheta) * fanR;
      y = canopyCenterY + Math.sin(fanTheta) * fanR;
    } else if (geo.mode === 'cone') {
      // Conical: radius shrinks linearly from base (t=0) to apex (t=1).
      const t = rng(); // 0=base of canopy, 1=top
      const coneR = Math.sqrt(rng()) * (1 - t) * geo.radiusX;
      x = canopyCenterX + Math.cos(theta) * coneR;
      y = canopyCenterY + (t - 0.5) * 2 * geo.radiusY; // base..top
    } else {
      // Disc/ellipse: uniform-in-ellipse (broadleaf-round, -oval, columnar).
      const er = Math.sqrt(rng());
      x = canopyCenterX + Math.cos(theta) * er * geo.radiusX;
      y = canopyCenterY + Math.sin(theta) * er * geo.radiusY;
    }
    // Pick tier: 0 (70%), 1 (20%), 2 (10%).
    const tierRoll = rng();
    const tier = tierRoll < 0.7 ? 0 : tierRoll < 0.9 ? 1 : 2;
    // Per-slot sway phase offset + size jitter (drives variety at draw time).
    const phaseOffset = rng() * Math.PI * 2;
    const sizeJitter = 0.8 + rng() * 0.4; // 0.8..1.2
    leafSlots.push({ x, y, tier, phaseOffset, sizeJitter });
  }

  // ----- Damage markers -----
  // Place each damage entry along the trunk at a height derived from its
  // appliedAt timestamp (so distinct events sit at distinct heights).
  const damageMarkers: DamageMarkerPlacement[] = [];
  for (const d of tree.damage) {
    const t = (d.appliedAt % 1000) / 1000; // 0..1 — wraps so multiple events spread.
    const yOffset = trunkLengthPx * (0.1 + t * 0.8); // 10%..90% up the trunk.
    const xOffset = (trunkDiameterPx / 2 + 2) * (d.appliedAt % 2 === 0 ? 1 : -1);
    damageMarkers.push({
      x: baseX + xOffset,
      y: baseY - yOffset,
      severity: Math.min(1, Math.max(0, d.severity)),
      type: d.type,
    });
  }

  return {
    signature,
    branches,
    leafSlots,
    damageMarkers,
    stump: false,
    baseX,
    baseY,
    treeHeightPx,
    trunkLengthPx,
    trunkDiameterPx,
  };
}
