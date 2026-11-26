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
import { SvgTreeRenderer } from './svg-tree-renderer.js';
import type { SvgContainer } from './svg-tree-renderer.js';
import { WebGlTreeRenderer } from './webgl-tree-renderer.js';
import type { WebGlLike } from './webgl-tree-renderer.js';

/**
 * Factory: create a TreeRenderer implementation for the requested target.
 *
 * P4a shipped `kind: 'headless'`. P4b adds `kind: 'canvas'`. W64 adds
 * `kind: 'svg'` + W65 adds `kind: 'webgl'` (deferred / post-launch backends).
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

    case 'svg': {
      // W64: SvgTreeRenderer. The factory accepts the container as `unknown`
      // (per CreateTreeRendererTarget's shape) and casts through to
      // SvgContainer — the settable-innerHTML surface SvgTreeRenderer needs.
      // Real HTMLElement satisfies this structurally; tests pass a mock.
      const container = target.container as unknown as SvgContainer;
      if (!container || typeof container !== 'object') {
        throw new Error(
          "createTreeRenderer({ kind: 'svg' }) requires a container element with a settable innerHTML.",
        );
      }
      return new SvgTreeRenderer({ container });
    }

    case 'webgl': {
      // W65: WebGlTreeRenderer. The factory accepts the canvas as `unknown`
      // and casts through to WebGlLike — the getContext('webgl') surface.
      const canvas = target.canvas as unknown as WebGlLike;
      if (!canvas || typeof canvas.getContext !== 'function') {
        throw new Error(
          "createTreeRenderer({ kind: 'webgl' }) requires a canvas with a getContext('webgl') method.",
        );
      }
      return new WebGlTreeRenderer({ canvas });
    }

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
