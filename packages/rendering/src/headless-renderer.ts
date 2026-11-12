/**
 * HeadlessTreeRenderer — a no-op TreeRenderer for tests + SSR (TDD §15.3).
 *
 * The headless renderer draws nothing — it implements the full
 * `TreeRenderer` interface so consumer code paths work unchanged in
 * non-visual contexts (vitest unit tests, server-side rendering, headless
 * screenshots that capture metrics instead of pixels). P4b's CanvasRenderer
 * shares the same interface; consumers swap by passing a different
 * `kind` to `createTreeRenderer`.
 *
 * The headless renderer ALSO exposes a `lastRender` snapshot — useful for
 * unit tests that want to assert what was passed to `render(...)` without
 * having to inspect the canvas pixel buffer.
 */
import type { TreeRenderData, EnvironmentRenderData, TreeRenderer } from './types.js';
import { PROVISIONAL_RENDER_HEADLESS_TARGET_KIND } from './constants/rendering.js';

/**
 * Snapshot of the last `render(...)` call. Useful for unit tests asserting
 * that the renderer received the expected TreeRenderData / EnvironmentRenderData.
 */
export interface HeadlessRenderSnapshot {
  readonly tree: TreeRenderData;
  readonly env: EnvironmentRenderData;
  readonly frameTimeMs: number;
  readonly timestamp: number;
}

/**
 * Headless TreeRenderer implementation (P4a). P4b adds the CanvasRenderer
 * alongside this; both implement the same `TreeRenderer` interface.
 *
 * The headless renderer:
 *   - Implements every method of `TreeRenderer`.
 *   - `render()` records a snapshot for inspection (tests, debug overlays).
 *   - `resize()` records the new dimensions; no actual surface exists.
 *   - `dispose()` clears the snapshot and marks the renderer disposed; safe
 *     to call multiple times.
 *   - `targetKind` is the readonly 'headless' discriminator.
 *
 * It NEVER mutates its `tree` or `env` arguments (rule 6: rendering reads
 * state, never writes — TDD §15.1). The snapshot references the caller's
 * objects, so callers must not mutate them either after calling `render()`.
 */
export class HeadlessTreeRenderer implements TreeRenderer {
  public readonly targetKind: 'headless' = PROVISIONAL_RENDER_HEADLESS_TARGET_KIND;

  private _width = 0;
  private _height = 0;
  private _disposed = false;
  private _lastSnapshot: HeadlessRenderSnapshot | null = null;
  private _renderCount = 0;

  constructor(initialWidth = 0, initialHeight = 0) {
    this._width = initialWidth;
    this._height = initialHeight;
  }

  render(tree: TreeRenderData, env: EnvironmentRenderData, frameTimeMs: number): void {
    if (this._disposed) return;
    this._lastSnapshot = {
      tree,
      env,
      frameTimeMs,
      timestamp: Date.now(),
    };
    this._renderCount += 1;
  }

  resize(width: number, height: number): void {
    if (this._disposed) return;
    this._width = width;
    this._height = height;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._lastSnapshot = null;
  }

  // --- Headless-specific inspection API (not part of TreeRenderer interface) ---

  /** The most recent render snapshot, or null if no render has occurred. */
  get lastSnapshot(): HeadlessRenderSnapshot | null {
    return this._lastSnapshot;
  }

  /** Number of `render()` calls since construction. Resets on dispose. */
  get renderCount(): number {
    return this._renderCount;
  }

  /** Current viewport width (px). 0 until resize() is called. */
  get width(): number {
    return this._width;
  }

  /** Current viewport height (px). 0 until resize() is called. */
  get height(): number {
    return this._height;
  }

  /** True after dispose() has been called. */
  get disposed(): boolean {
    return this._disposed;
  }
}
