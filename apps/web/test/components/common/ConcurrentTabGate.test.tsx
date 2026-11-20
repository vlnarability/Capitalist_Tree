/**
 * ConcurrentTabGate tests (W21 / RV5-F4 — concurrent-tab protection).
 *
 * Covers the three lock states by mocking `navigator.locks.request`:
 *   - unsupported (navigator.locks unavailable) → renders children.
 *   - active (lock acquired) → renders children.
 *   - blocked (lock null — another tab holds it) → renders the blocked screen,
 *     NOT the children (so the second tab never mounts the sim).
 *
 * Environment: happy-dom (no native navigator.locks — the unsupported case is
 * the default; the active/blocked cases inject a mock).
 */
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ConcurrentTabGate } from '../../../components/common/ConcurrentTabGate';

/** Inject a mock navigator.locks whose request calls the callback with `lock`. */
function mockLocks(lock: Lock | null): void {
  const request = vi.fn(
    (_name: string, _opts: unknown, cb: (lock: Lock | null) => Promise<void> | void) =>
      Promise.resolve(cb(lock)),
  );
  Object.defineProperty(navigator, 'locks', {
    value: { request },
    configurable: true,
  });
}

/** Remove navigator.locks so the hook sees it as unsupported. */
function clearLocks(): void {
  Object.defineProperty(navigator, 'locks', {
    value: undefined,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Best-effort: drop any injected locks so the next test starts clean.
  try {
    delete (navigator as unknown as { locks?: unknown }).locks;
  } catch {
    // non-configurable in some envs — the defineProperty in setup overwrites it.
  }
});

describe('ConcurrentTabGate (W21)', () => {
  it('renders children when navigator.locks is unavailable (unsupported)', () => {
    clearLocks();
    const { getByTestId, queryByTestId } = render(
      <ConcurrentTabGate>
        <div data-testid="app-content">App</div>
      </ConcurrentTabGate>,
    );
    expect(getByTestId('app-content')).toBeInTheDocument();
    expect(queryByTestId('concurrent-tab-blocked')).toBeNull();
  });

  it('renders children when the lock is acquired (active)', () => {
    mockLocks({ name: 'ct-active-tab', mode: 'exclusive' } as unknown as Lock);
    const { getByTestId } = render(
      <ConcurrentTabGate>
        <div data-testid="app-content">App</div>
      </ConcurrentTabGate>,
    );
    expect(getByTestId('app-content')).toBeInTheDocument();
  });

  it('renders the blocked screen (not the children) when the lock is unavailable', () => {
    mockLocks(null);
    const { getByTestId, queryByTestId } = render(
      <ConcurrentTabGate>
        <div data-testid="app-content">App</div>
      </ConcurrentTabGate>,
    );
    expect(getByTestId('concurrent-tab-blocked')).toBeInTheDocument();
    expect(queryByTestId('app-content')).toBeNull();
  });

  it('the blocked screen offers a reload button', () => {
    mockLocks(null);
    const { getByTestId } = render(
      <ConcurrentTabGate>
        <div data-testid="app-content">App</div>
      </ConcurrentTabGate>,
    );
    expect(getByTestId('concurrent-tab-reload')).toBeInTheDocument();
  });
});
