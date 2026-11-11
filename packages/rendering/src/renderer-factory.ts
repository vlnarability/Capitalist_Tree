/**
 * TreeRenderer factory (TDD §15.3 — replaceable rendering).
 *
 * `createTreeRenderer(target)` returns a `TreeRenderer` implementation
 * chosen by the discriminated `target.kind`. P4a ships only the headless
 * stub; P4b adds the Canvas renderer; later phases may add SVG / WebGL.
 *
 * Consumers (the React wrapper in P4d) call this once on mount and dispose
 * on unmount. Switching backends at runtime is supported — the wrapper
 * disposes the old renderer and creates a new one with a different `kind`.
 */
import type { TreeRenderer, CreateTreeRendererTarget } from './types.js';
import { HeadlessTreeRenderer } from './headless-renderer.js';

/**
 * Factory: create a TreeRenderer implementation for the requested target.
 *
 * P4a ships only `kind: 'headless'`. The 'canvas', 'svg', and 'webgl'
 * variants throw an explicit error pointing at P4b+ — this makes it obvious
 * which sub-task still needs to land when a consumer tries to mount a visual
 * renderer in P4a.
 *
 * The factory is intentionally NOT a class — it's a function returning an
 * object that satisfies the TreeRenderer interface. This keeps the surface
 * small and makes it trivial to add new backends (P4b will append a case).
 */
export function createTreeRenderer(target: CreateTreeRendererTarget): TreeRenderer {
  switch (target.kind) {
    case 'headless':
      return new HeadlessTreeRenderer();

    case 'canvas':
      // P4b will land `CanvasRenderer` here. Until then, throw so a
      // misconfigured consumer (e.g. a P4d React wrapper that defaults to
      // canvas) fails loudly instead of silently rendering nothing.
      throw new Error(
        "createTreeRenderer({ kind: 'canvas' }) is not implemented yet — landed in P4b.",
      );

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
