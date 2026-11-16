/**
 * TreeView smoke test (P4d).
 *
 * Mounts the React wrapper, asserts the canvas is in the document with the
 * right accessibility attributes, then unmounts and asserts the rAF loop is
 * cleaned up. This is a SMOKE test — it does not assert what the renderer
 * drew (that's covered by packages/rendering/tests/canvas-tree-renderer.test.ts).
 * It only verifies the React lifecycle wires up without throwing.
 *
 * Environment: happy-dom (per-file override). The default vitest environment
 * is `node` (see vitest.config.ts) — most tests don't need a DOM. This file
 * mounts a real React component, so it needs happy-dom's `HTMLCanvasElement`,
 * `requestAnimationFrame`, and `ResizeObserver` globals.
 *
 * The CanvasTreeRenderer's contract says: if `canvas.getContext('2d')`
 * returns null (which is what happy-dom returns — it doesn't implement a
 * real 2D context), `render()` is a silent no-op rather than throwing
 * (TDD §15.3: render never throws). So the smoke test exercises the
 * null-context code path. A real browser would acquire a real context and
 * actually draw; both are valid mount outcomes.
 */
// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TreeView } from './TreeView';
import type {
  TreeRenderData,
  EnvironmentRenderData,
} from '@capitalist-tree/rendering';

// ----------------------------------------------------------------------------
// Minimal fixtures — valid TreeRenderData + EnvironmentRenderData shapes. The
// TreeView component is a pure consumer of these types; it doesn't care how
// they were built. Using inline fixtures avoids coupling this smoke test to
// the rendering package's test helpers (which live under packages/rendering/tests/
// and aren't part of the public surface).
// ----------------------------------------------------------------------------

const TREE_FIXTURE: TreeRenderData = {
  height: 10,
  trunkDiameter: 0.5,
  branchDevelopment: 50,
  foliageDensity: 0.7,
  foliageCondition: 0.8,
  seasonalAppearance: 'summer-green',
  damage: [],
  alive: true,
  speciesId: 'species:white-oak',
  speciesShape: 'broadleaf-round',
  ageDays: 200,
  leafCount: 1000,
};

const ENV_FIXTURE: EnvironmentRenderData = {
  soilCondition: 0.9,
  soilContamination: 0,
  weatherCondition: 'sunny',
  weatherIntensity: 0.5,
  timeOfDay: 0.5,
  season: 'summer',
  pollutionLevel: 0,
  biodiversityLevel: 0.8,
  co2Level: 410,
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('TreeView (P4d React wrapper) — smoke', () => {
  afterEach(() => {
    cleanup();
  });

  it('mounts without throwing and renders a <canvas> element', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container } = render(
        <TreeView tree={TREE_FIXTURE} environment={ENV_FIXTURE} />,
      );
      const canvas = container.querySelector('canvas');
      expect(canvas).not.toBeNull();
      expect(canvas?.tagName).toBe('CANVAS');
      // No React-level errors logged during mount.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('renders with role="img" and an aria-label for accessibility', () => {
    const { container } = render(
      <TreeView tree={TREE_FIXTURE} environment={ENV_FIXTURE} />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toHaveAttribute('role', 'img');
    expect(canvas).toHaveAttribute('aria-label', 'Procedural capitalist-tree visualization');
  });

  it('applies the explicit width/height props to the canvas backing store', () => {
    const { container } = render(
      <TreeView
        tree={TREE_FIXTURE}
        environment={ENV_FIXTURE}
        width={320}
        height={240}
      />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toHaveAttribute('width', '320');
    expect(canvas).toHaveAttribute('height', '240');
  });

  it('applies a className to the canvas wrapper', () => {
    const { container } = render(
      <TreeView
        tree={TREE_FIXTURE}
        environment={ENV_FIXTURE}
        className="tree-render-demo"
      />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toHaveClass('tree-render-demo');
  });

  it('cleans up its requestAnimationFrame handle on unmount', () => {
    const cancelSpy = vi
      .spyOn(globalThis, 'cancelAnimationFrame')
      .mockImplementation(() => {});

    try {
      const { unmount } = render(
        <TreeView tree={TREE_FIXTURE} environment={ENV_FIXTURE} />,
      );
      // The mount effect schedules a rAF — at least one cancel should fire on
      // unmount (the most recent handle).
      unmount();
      expect(cancelSpy).toHaveBeenCalled();
    } finally {
      cancelSpy.mockRestore();
    }
  });

  it('does not throw when re-rendered with new tree/environment props', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { rerender } = render(
        <TreeView tree={TREE_FIXTURE} environment={ENV_FIXTURE} />,
      );
      // New tree state — autumn mature, full canopy.
      const tree2: TreeRenderData = { ...TREE_FIXTURE, seasonalAppearance: 'autumn-color' };
      const env2: EnvironmentRenderData = { ...ENV_FIXTURE, season: 'autumn' };
      rerender(<TreeView tree={tree2} environment={env2} />);
      // Re-render with original props to exercise the diff path twice.
      rerender(<TreeView tree={TREE_FIXTURE} environment={ENV_FIXTURE} />);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not throw when width/height props change', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { rerender } = render(
        <TreeView
          tree={TREE_FIXTURE}
          environment={ENV_FIXTURE}
          width={320}
          height={240}
        />,
      );
      rerender(
        <TreeView
          tree={TREE_FIXTURE}
          environment={ENV_FIXTURE}
          width={640}
          height={480}
        />,
      );
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  // --------------------------------------------------------------------------
  // Click-to-harvest (P11 — GDD §5.4 Harvesting). The tree canvas is the
  // focal point of the game; making it clickable lets the player harvest
  // leaves directly. These tests verify the wiring contract: when an
  // `onHarvest` handler is provided, the canvas becomes an interactive
  // button (pointer cursor, role=button, focusable, Enter/Space trigger);
  // when no handler is provided, it stays a non-interactive image.
  // --------------------------------------------------------------------------

  it('calls onHarvest when the canvas is clicked', () => {
    const onHarvest = vi.fn();
    const { container } = render(
      <TreeView
        tree={TREE_FIXTURE}
        environment={ENV_FIXTURE}
        onHarvest={onHarvest}
      />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    fireEvent.click(canvas as HTMLElement);
    expect(onHarvest).toHaveBeenCalledTimes(1);
  });

  it('becomes role="button" with a pointer cursor when onHarvest is wired', () => {
    const onHarvest = vi.fn();
    const { container } = render(
      <TreeView
        tree={TREE_FIXTURE}
        environment={ENV_FIXTURE}
        onHarvest={onHarvest}
      />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toHaveAttribute('role', 'button');
    expect(canvas).toHaveAttribute(
      'aria-label',
      'Capitalist tree — click to harvest leaves',
    );
    expect(canvas).toHaveAttribute('tabindex', '0');
    expect(canvas?.style.cursor).toBe('pointer');
  });

  it('stays role="img" (non-interactive) when no onHarvest is wired', () => {
    const { container } = render(
      <TreeView tree={TREE_FIXTURE} environment={ENV_FIXTURE} />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toHaveAttribute('role', 'img');
    expect(canvas).toHaveAttribute(
      'aria-label',
      'Procedural capitalist-tree visualization',
    );
    expect(canvas).not.toHaveAttribute('tabindex');
    expect(canvas?.style.cursor).toBe('default');
  });

  it('triggers onHarvest on Enter and Space (keyboard accessibility)', () => {
    const onHarvest = vi.fn();
    const { container } = render(
      <TreeView
        tree={TREE_FIXTURE}
        environment={ENV_FIXTURE}
        onHarvest={onHarvest}
      />,
    );
    const canvas = container.querySelector('canvas') as HTMLElement;
    canvas.focus();
    fireEvent.keyDown(canvas, { key: 'Enter' });
    fireEvent.keyDown(canvas, { key: ' ' });
    expect(onHarvest).toHaveBeenCalledTimes(2);
  });

  it('does not trigger onHarvest on unrelated keys', () => {
    const onHarvest = vi.fn();
    const { container } = render(
      <TreeView
        tree={TREE_FIXTURE}
        environment={ENV_FIXTURE}
        onHarvest={onHarvest}
      />,
    );
    const canvas = container.querySelector('canvas') as HTMLElement;
    fireEvent.keyDown(canvas, { key: 'a' });
    fireEvent.keyDown(canvas, { key: 'ArrowDown' });
    expect(onHarvest).not.toHaveBeenCalled();
  });
});
