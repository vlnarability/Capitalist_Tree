'use client';

/**
 * TreeView — React wrapper around CanvasTreeRenderer (P4d, TDD §15.3).
 *
 * This is the public React surface for the rendering package. The simulation
 * (or a fixture) produces `TreeRenderData` + `EnvironmentRenderData` snapshots
 * via the pure `buildTreeRenderData` / `buildEnvironmentRenderData` mappers;
 * this component owns the canvas element + animation frame loop + lifecycle
 * for one `CanvasTreeRenderer` instance and feeds it the latest snapshots each
 * frame.
 *
 * Architecture (10 Capitalist Tree rules — see docs/GDD.txt §16):
 *
 *   - Rule 6 (TDD §15.1, GDD §6.1): rendering reads state, NEVER writes.
 *     TreeView treats `tree` + `environment` as opaque read-only inputs. It
 *     never calls back into the simulation; it never mutates the props. The
 *     renderer's render() is invoked against the latest snapshot each frame
 *     but the snapshot itself is owned by the parent.
 *   - Decoupled frame loop (TDD §15.1 — "tree should be rendered independently
 *     of the simulation"): the parent re-renders React only when the
 *     simulation advances (typically once per `engine.advance` step); the
 *     canvas itself re-draws at the browser's native frame rate against the
 *     latest snapshot. This avoids tying the canvas to the sim's tick rate
 *     (the sim might tick once a second; the canvas redraws at ~60 fps).
 *   - Replaceable backend (TDD §15.3): the wrapper is hardcoded to
 *     CanvasTreeRenderer in P4d. Swapping to SVG / WebGL is a one-line change
 *     via the `createTreeRenderer` factory — the React surface stays the same.
 *   - Cosmetic currency (TDD §15.4): the `currency` prop is purely cosmetic —
 *     changing it (e.g. player picks "Gold Leaf" in the cosmetics panel) does
 *     NOT modify the underlying monetary value. The wrapper calls
 *     `renderer.setCurrency(...)` instead of recreating the renderer.
 *
 * Lifecycle:
 *   - On mount: create a CanvasTreeRenderer against the canvas ref, set the
 *     backing-store size, start a requestAnimationFrame loop, observe the
 *     canvas with a ResizeObserver so the renderer's viewport tracks the
 *     canvas's CSS box.
 *   - On each rAF tick: compute dt since last tick, call
 *     `renderer.render(tree, env, dt)` against the latest props (read via a
 *     ref so the loop always sees fresh values without re-subscribing).
 *   - On prop change (currency): call `renderer.setCurrency(...)` — no
 *     renderer recreation, no canvas flicker.
 *   - On prop change (width/height): resize the canvas + renderer.
 *   - On unmount: cancel the rAF, disconnect the ResizeObserver, dispose
 *     the renderer. All idempotent — safe under React StrictMode's
 *     mount-unmount-mount cycle in dev.
 *
 * Public surface (TreeViewProps) is declared in
 * `packages/rendering/src/types.ts` so the contract is stable across P4a–P4d.
 * P4a declared the shape; P4d (this file) implements it.
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import {
  CanvasTreeRenderer,
  getDefaultCurrencyVisual,
} from '@capitalist-tree/rendering';
import type { TreeViewProps } from '@capitalist-tree/rendering';

// Re-export TreeViewProps so consumers can `import { TreeView, type TreeViewProps }`
// from one place. P4a declared the type; P4d wires the component.
export type { TreeViewProps } from '@capitalist-tree/rendering';

// ----------------------------------------------------------------------------
// Defaults — kept here (NOT in packages/rendering) because they're web-layer
// concerns. The rendering package's defaults (PROVISIONAL_RENDER_CANVAS_*)
// live in the rendering constants; P4d picks viewport defaults suitable for
// the demo page and lets callers override via props.
// ----------------------------------------------------------------------------

/** Default canvas backing-store width (px). Matches PROVISIONAL_RENDER_CANVAS_DEFAULT_WIDTH_PX. */
const DEFAULT_WIDTH_PX = 600;
/** Default canvas backing-store height (px). Matches PROVISIONAL_RENDER_CANVAS_DEFAULT_HEIGHT_PX. */
const DEFAULT_HEIGHT_PX = 480;

/**
 * TreeView — renders one procedural tree to a <canvas> element.
 *
 * See the file header for the full architecture. The component is a pure
 * function of its props; it owns no state outside of refs and effects.
 *
 * @example
 *   <TreeView
 *     tree={buildTreeRenderData(treeState, { season })}
 *     environment={buildEnvironmentRenderData(world, clock)}
 *     currency={LEAF_BANKNOTE}
 *     width={600}
 *     height={480}
 *     className="rounded-lg border border-slate-800"
 *   />
 */
export function TreeView({
  tree,
  environment,
  currency,
  width = DEFAULT_WIDTH_PX,
  height = DEFAULT_HEIGHT_PX,
  className,
}: TreeViewProps): ReactElement {
  // Refs:
  //   - canvasRef: the mounted <canvas> DOM element.
  //   - rendererRef: the CanvasTreeRenderer instance (created on mount).
  //   - rafRef: the requestAnimationFrame handle (so we can cancel on unmount).
  //   - lastFrameMsRef: wall-clock ms of the previous rAF tick (for dt).
  //   - latestPropsRef: the latest { tree, environment, currency } props, so
  //     the rAF closure always reads fresh values without re-subscribing.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CanvasTreeRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameMsRef = useRef<number>(0);
  const latestPropsRef = useRef<{
    tree: TreeViewProps['tree'];
    environment: TreeViewProps['environment'];
    currency: TreeViewProps['currency'] | undefined;
  }>({ tree, environment, currency });

  // Sync the latest-props ref every render. The rAF closure reads from this
  // ref — so it always sees the freshest values without us re-subscribing
  // (which would tear down + recreate the renderer every frame).
  latestPropsRef.current = { tree, environment, currency };

  // -------------------------------------------------------------------------
  // Mount effect — create the renderer + start the rAF loop + observe resize.
  //
  // Empty dep array: runs once on mount, cleans up on unmount. We read
  // width/height from a ref as well so the initial creation uses the latest
  // values without re-running this effect.
  // -------------------------------------------------------------------------
  const initialSizeRef = useRef({ width, height });
  initialSizeRef.current = { width, height };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return; // SSR / no canvas — render() will no-op.

    // Create the renderer with the current currency (or the default).
    const initialCurrency =
      latestPropsRef.current.currency ?? getDefaultCurrencyVisual();
    const initialSize = initialSizeRef.current;

    const renderer = new CanvasTreeRenderer({
      canvas,
      currency: initialCurrency,
      width: initialSize.width,
      height: initialSize.height,
    });
    rendererRef.current = renderer;

    // Sync the canvas backing store to the explicit size. The renderer's
    // constructor already does this when the canvas starts at 0×0; this
    // ensures it stays in sync if React re-renders the canvas element with
    // stale width/height attributes.
    canvas.width = initialSize.width;
    canvas.height = initialSize.height;

    // ResizeObserver: keep the renderer's viewport in sync with the canvas's
    // CSS box. The canvas's CSS is `width: 100%; height: auto; aspect-ratio:
    // width/height` (set inline below), so it scales fluidly with its
    // container. When the container resizes, the ResizeObserver fires and we
    // update the renderer's viewport (which in turn updates the backing store
    // to match — see CanvasTreeRenderer.resize()).
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          // contentRect is the canvas's content box in CSS px.
          const cr = entry.contentRect;
          const w = Math.max(1, Math.round(cr.width));
          const h = Math.max(1, Math.round(cr.height));
          renderer.resize(w, h);
        }
      });
      resizeObserver.observe(canvas);
    }

    // Animation frame loop. dt is wall-clock ms since the previous tick; the
    // renderer uses it for branch-sway + particle animation (TDD §15.3).
    // We clamp dt to a sane upper bound (250 ms) so a long tab-suspend
    // (e.g. laptop sleep) doesn't cause a single huge advance.
    const MAX_FRAME_DT_MS = 250;
    lastFrameMsRef.current = performance.now();

    const loop = (now: number): void => {
      const dt = Math.min(MAX_FRAME_DT_MS, now - lastFrameMsRef.current);
      lastFrameMsRef.current = now;

      const { tree: t, environment: e, currency: c } = latestPropsRef.current;

      // Hot-swap the currency if it changed since the last frame. Avoids
      // recreating the renderer (which would re-allocate particle pools + lose
      // the layout cache). Cosmetic only — does NOT touch the underlying
      // monetary value (TDD §15.4).
      if (c && renderer.currency.id !== c.id) {
        renderer.setCurrency(c);
      }

      renderer.render(t, e, dt);

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      // Cleanup: cancel the rAF, disconnect the observer, dispose the renderer.
      // All idempotent — safe under React StrictMode's mount-unmount-mount
      // cycle in dev (which calls this cleanup once between the two mounts).
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      renderer.dispose();
      rendererRef.current = null;
    };
    // Mount-once effect: the empty dep array is intentional. The rAF closure
    // reads fresh props from latestPropsRef instead of re-subscribing each
    // render — this avoids tearing down + recreating the renderer (which would
    // re-allocate particle pools + lose the layout cache) every frame.
  }, []);

  // -------------------------------------------------------------------------
  // Currency prop change — hot-swap via renderer.setCurrency().
  // -------------------------------------------------------------------------
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer && currency) {
      renderer.setCurrency(currency);
    }
  }, [currency]);

  // -------------------------------------------------------------------------
  // Width / height prop change — resize the canvas backing store + renderer.
  //
  // The ResizeObserver above is for *container-driven* resizes (CSS box
  // shrinks/grows); this effect is for *prop-driven* resizes (explicit
  // width/height change from the parent). Both paths are necessary because
  // the parent may swap width/height without the container resizing.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;
    // Only resize if the new dimensions actually differ — avoids spurious
    // cache invalidation when the parent re-renders with the same props.
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      renderer.resize(width, height);
    }
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{
        display: 'block',
        // Fluid sizing: the canvas scales to its container's width while
        // preserving the aspect ratio implied by the width/height props. The
        // ResizeObserver (above) keeps the renderer's backing store in sync
        // with the CSS box so the canvas renders crisply at any size.
        width: '100%',
        height: 'auto',
        aspectRatio: `${width} / ${height}`,
        maxWidth: `${width}px`,
      }}
      aria-label="Procedural capitalist-tree visualization"
      role="img"
    />
  );
}
