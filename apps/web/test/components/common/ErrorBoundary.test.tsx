/**
 * GAP-31 Phase 2 (DR-13) — ErrorBoundary error-capture tests.
 *
 * Verifies the boundary still renders its fallback AND now records an
 * `error-caught` analytics event (design §3: "Record errors when they occur —
 * these are rare + high-signal — keep them all") via the analytics singleton.
 *
 * Environment: happy-dom — React Testing Library `render` needs a DOM.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ErrorBoundary } from '../../../components/common/ErrorBoundary';
import { initAnalytics, resetAnalytics } from '../../../lib/analytics/analytics';
import { InMemoryAnalyticsStore } from '@capitalist-tree/analytics';

let store: InMemoryAnalyticsStore;

beforeEach(() => {
  store = new InMemoryAnalyticsStore();
  initAnalytics(store);
  // React logs caught render errors to console.error — silence in the test so
  // the output isn't noisy (the boundary is supposed to catch them).
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  resetAnalytics();
  cleanup();
  vi.restoreAllMocks();
});

/** A component that always throws during render. */
function ThrowOnRender({ message }: { message: string }): ReactNode {
  throw new Error(message);
}

describe('ErrorBoundary — GAP-31 Phase 2 error capture', () => {
  it('renders the fallback when a child throws', () => {
    const { getByText } = render(
      <ErrorBoundary>
        <ThrowOnRender message="render-boom" />
      </ErrorBoundary>,
    );
    expect(getByText('The tree hit an unexpected error')).toBeTruthy();
  });

  it('records an error-caught analytics event with the message + stack', async () => {
    render(
      <ErrorBoundary>
        <ThrowOnRender message="analytics-boom" />
      </ErrorBoundary>,
    );
    await flushMicrotasks();
    const events = await store.query({ event: 'error-caught' });
    expect(events).toHaveLength(1);
    expect(events[0]?.category).toBe('error');
    const data = events[0]?.data as { message: string; stack?: string };
    expect(data.message).toBe('analytics-boom');
    expect(typeof data.stack).toBe('string');
  });

  it('is a no-op when no collector is initialized (still renders fallback)', async () => {
    resetAnalytics();
    const { getByText } = render(
      <ErrorBoundary>
        <ThrowOnRender message="no-collector-boom" />
      </ErrorBoundary>,
    );
    expect(getByText('The tree hit an unexpected error')).toBeTruthy();
    await flushMicrotasks();
    // The old store has no collector writing to it now.
    expect(await store.count()).toBe(0);
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
