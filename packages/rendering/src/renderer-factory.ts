/**
 * TreeRenderer factory (TDD §15.3 — replaceable rendering).
 *
 * `createTreeRenderer(target)` returns a `TreeRenderer` implementation
 * chosen by the discriminated `target.kind`. P4a shipped the headless stub;
 * P4b adds the Canvas renderer; later phases may add SVG / WebGL.
 *
 * Consumers (the React wrapper in P4d) call this once on mount and dispose
 * on unmount. Switching backends at runtime is supported — the wrapper
 * disposes the old renderer and creates a new one with a different `kind`.
 */
import type { TreeRenderer, CreateTreeRendererTarget } from './types.js';
import { HeadlessTreeRenderer } from './headless-renderer.js';
import { CanvasTreeRenderer } from './canvas-tree-renderer.js';
import type { CanvasLike } from './canvas-tree-renderer.js';

/**
 * Factory: create a TreeRenderer implementation for the requested target.
 *
 * P4a shipped `kind: 'headless'`. P4b adds `kind: 'canvas'`. The 'svg' and
 * 'webgl' variants still throw — they're future phases.
 *
 * The factory is intentionally NOT a class — it's a function returning an
 * object that satisfies the TreeRenderer interface. This keeps the surface
 * small and makes it trivial to add new backends (P4c/P4d will append a
 * case).
 */
export function createTreeRenderer(target: CreateTreeRendererTarget): TreeRenderer {
  switch (target.kind) {
    case 'headless':
      return new HeadlessTreeRenderer();

    case 'canvas': {
      // P4b: CanvasTreeRenderer. The factory accepts the canvas as `unknown`
      // (per CreateTreeRendererTarget's P4a shape) and casts through to
      // CanvasLike — the duck-typed surface CanvasTreeRenderer needs. Real
      // HTMLCanvasElement satisfies this structurally; tests pass a mock.
      const canvas = target.canvas as unknown as CanvasLike;
      if (!canvas || typeof canvas.getContext !== 'function') {
        throw new Error(
          "createTreeRenderer({ kind: 'canvas' }) requires a canvas with a getContext('2d') method.",
        );
      }
      return new CanvasTreeRenderer({ canvas });
    }

    case 'svg':
      throw new Error(
        "createTreeRenderer({ kind: 'svg' }) is not implemented yet — future phase.",
      );

    case 'webgl':
      throw new Error(
        "createTreeRenderer({ kind: 'webgl' }) is not implemented yet — future phase.",
      );

    default: {
      // Exhaustiveness guard — if CreateTreeRendererTarget gains a new
      // variant without a case above, TypeScript flags it here.
      const _exhaustive: never = target;
      throw new Error(
        `createTreeRenderer: unknown target kind ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
