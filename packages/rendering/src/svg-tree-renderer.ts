/**
 * W64 — SvgTreeRenderer: paints the tree as SVG markup into a container.
 *
 * Implements the same `TreeRenderer` interface as Canvas / Headless (TDD §15.3
 * — replaceable rendering). SVG is CSS-styleable + accessible (each
 * branch/leaf is a DOM node) but slower than Canvas for hundreds of animated
 * leaves, so the layout is cached (rebuilt only when the structural signature
 * changes) + the SVG markup is regenerated per render.
 *
 * Intended for the deferred / post-launch backend slot; the production
 * renderer stays Canvas. Shares the exact layout (`buildTreeLayout`) with
 * Canvas + WebGL so every backend paints the same geometry — no drift.
 *
 * Mutability contract (rule 6): render() does NOT mutate `tree` or `env`.
 */
import type {
  TreeRenderer,
  TreeRenderData,
  EnvironmentRenderData,
} from './types.js';
import { buildTreeLayout, treeStructureSignature } from './tree-layout.js';
import type { TreeLayout } from './tree-layout.js';
import {
  seasonalFoliageColorHex,
  leafSizeForTier,
  TRUNK_COLOR,
  SKY_COLOR,
  GROUND_COLOR,
} from './render-colors.js';
import {
  PROVISIONAL_RENDER_SVG_TARGET_KIND,
  PROVISIONAL_RENDER_CANVAS_DEFAULT_WIDTH_PX,
  PROVISIONAL_RENDER_CANVAS_DEFAULT_HEIGHT_PX,
  PROVISIONAL_RENDER_TREE_BASELINE_FRACTION,
} from './constants/rendering.js';

/** A DOM-like container with a settable `innerHTML` (real HTMLElement satisfies
 * this structurally; tests pass a plain object). */
export interface SvgContainer {
  innerHTML: string;
}

/** Constructor options for {@link SvgTreeRenderer}. */
export interface SvgTreeRendererOptions {
  readonly container: SvgContainer;
  readonly width?: number;
  readonly height?: number;
}

/**
 * SVG TreeRenderer implementation (W64). Renders the tree as an inline `<svg>`
 * document fragment set on the container's `innerHTML`.
 *
 * - `render()` rebuilds the cached `TreeLayout` only when the structural
 *   signature changes, then regenerates the SVG markup (sky, ground, branches,
 *   leaves, damage markers) + assigns it to `container.innerHTML`.
 * - `resize()` updates the viewport + invalidates the cache.
 * - `dispose()` marks the renderer disposed; further renders are no-ops.
 *
 * NEVER throws inside `render()` for malformed input — defensive guards match
 * the Canvas renderer's contract (TDD §15.3: render never throws).
 */
export class SvgTreeRenderer implements TreeRenderer {
  public readonly targetKind: 'svg' = PROVISIONAL_RENDER_SVG_TARGET_KIND;

  private readonly _container: SvgContainer;
  private _width: number;
  private _height: number;
  private _disposed = false;
  private _cachedLayout: TreeLayout | null = null;
  private _cachedSignature: string | null = null;

  constructor(options: SvgTreeRendererOptions) {
    this._container = options.container;
    this._width = options.width ?? PROVISIONAL_RENDER_CANVAS_DEFAULT_WIDTH_PX;
    this._height = options.height ?? PROVISIONAL_RENDER_CANVAS_DEFAULT_HEIGHT_PX;
  }

  render(
    tree: TreeRenderData,
    env: EnvironmentRenderData,
    frameTimeMs: number,
  ): void {
    if (this._disposed) return;
    if (!Number.isFinite(frameTimeMs) || frameTimeMs < 0) return; // Defensive.

    // Rebuild the cached layout only when the structural signature changes.
    const sig = treeStructureSignature(tree, this._width, this._height);
    if (!this._cachedLayout || this._cachedSignature !== sig) {
      this._cachedLayout = buildTreeLayout(tree, this._width, this._height, sig);
      this._cachedSignature = sig;
    }

    // Defensive: if the container has no settable innerHTML, no-op (render
    // never throws — TDD §15.3).
    const container = this._container as { innerHTML?: string };
    if (container === null || typeof container !== 'object') return;
    try {
      container.innerHTML = this._buildSvgMarkup(tree, env, this._cachedLayout);
    } catch {
      // A malformed tree/env could produce NaN coordinates — silently no-op
      // rather than crash the frame loop.
    }
  }

  resize(width: number, height: number): void {
    if (this._disposed) return;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    if (width < 0 || height < 0) return;
    this._width = Math.round(width);
    this._height = Math.round(height);
    // Layout depends on viewport size — invalidate the cache.
    this._cachedLayout = null;
    this._cachedSignature = null;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._cachedLayout = null;
    this._cachedSignature = null;
  }

  // --- SvgTreeRenderer-specific inspection API (not part of TreeRenderer) ---

  /** Current viewport width (px). */
  get width(): number {
    return this._width;
  }

  /** Current viewport height (px). */
  get height(): number {
    return this._height;
  }

  /** True after dispose() has been called. */
  get disposed(): boolean {
    return this._disposed;
  }

  // -------------------------------------------------------------------------
  // SVG markup generation.
  // -------------------------------------------------------------------------

  /**
   * Build the SVG markup string for one frame. Pure (given the layout + env).
   * The SVG uses a `viewBox` so it scales to the container size responsively.
   */
  private _buildSvgMarkup(
    tree: TreeRenderData,
    _env: EnvironmentRenderData,
    layout: TreeLayout,
  ): string {
    const w = this._width;
    const h = this._height;
    const groundY = layout.baseY;
    const parts: string[] = [];

    // Root <svg> — viewBox scales the drawing to the container.
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%">`,
    );

    // Sky background.
    parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${SKY_COLOR}"/>`);

    // Ground (from the tree's base down).
    parts.push(
      `<rect x="0" y="${groundY}" width="${w}" height="${Math.max(0, h - groundY)}" fill="${GROUND_COLOR}"/>`,
    );

    // Branches — each segment is a <line> with stroke-width = diameter (scaled
    // up for visibility; SVG strokes are thinner than canvas fills at the same
    // width). Stumps (dead trees) have a single trunk segment.
    for (const b of layout.branches) {
      const sw = Math.max(1, b.diameter * 0.8);
      parts.push(
        `<line x1="${fmt(b.x0)}" y1="${fmt(b.y0)}" x2="${fmt(b.x1)}" y2="${fmt(b.y1)}" stroke="${TRUNK_COLOR}" stroke-width="${fmt(sw)}" stroke-linecap="round"/>`,
      );
    }

    // Leaves — winter-bare trees have no foliage (matches the canvas's
    // seasonalCanopyFactor=0 for winter). Each leaf is a <circle> colored by
    // the seasonal foliage color, sized by currency tier × jitter.
    if (tree.seasonalAppearance !== 'winter-bare') {
      const foliageColor = seasonalFoliageColorHex(tree.seasonalAppearance);
      for (const slot of layout.leafSlots) {
        const r = leafSizeForTier(slot.tier) * slot.sizeJitter;
        if (!(r > 0)) continue; // Defensive — skip degenerate slots.
        parts.push(
          `<circle cx="${fmt(slot.x)}" cy="${fmt(slot.y)}" r="${fmt(r)}" fill="${foliageColor}"/>`,
        );
      }
    }

    // Damage markers — small red circles on the trunk.
    for (const d of layout.damageMarkers) {
      parts.push(
        `<circle cx="${fmt(d.x)}" cy="${fmt(d.y)}" r="4" fill="#b22222" opacity="${fmt(0.4 + d.severity * 0.5)}"/>`,
      );
    }

    parts.push('</svg>');
    return parts.join('');
  }
}

/** Format a number for SVG attribute output — 2 dp, no trailing zeros. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  // Round to 2 dp + trim trailing zeros (keeps the markup compact).
  return (Math.round(n * 100) / 100).toString();
}
