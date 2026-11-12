/**
 * Tests for NotificationsPanel (P5d — GDD §13.5).
 *
 * Coverage:
 *   - Renders `null` when the notifications list is empty (or contains
 *     only non-actionable codes).
 *   - Renders one row per actionable notification (actionable codes:
 *     expense-due, low-funds, issuance-rejected, tree-died,
 *     storm-damage, severe-weather).
 *   - Filters out non-actionable codes (the wrapper may push them for
 *     the dev console — they shouldn't surface to the player).
 *   - Clicking the per-row dismiss button calls `dismissNotification(id)`.
 *   - Clicking "Dismiss all" calls `clearNotifications()`.
 *   - ARIA: `role="alert"` on warning + critical; `role="status"` on info.
 *   - Each icon-only dismiss button has an `aria-label` describing the
 *     action (WCAG 1.4.1 + 4.1.2).
 *   - Cap to MAX_NOTIFICATIONS (defensive backstop): the store already
 *     caps the ring buffer; the panel re-slices to `max` in case future
 *     code pushes via a different route.
 *   - Leaves the simState reference untouched (rule 6 — UI mutators only
 *     touch the `ui` slice).
 *   - Subscribes narrowly: doesn't re-render when an unrelated `simState`
 *     commit lands.
 *   - Respects the in-game reduced-motion override (applies
 *     `transition-none` when the override is `'on'`).
 *
 * Environment: happy-dom. The hook uses `useSyncExternalStore` via
 * Zustand; happy-dom provides the React scheduler.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../../stores/game-store';
import { PROVISIONAL_UI_MAX_NOTIFICATIONS } from '../../../lib/constants';
import {
  NotificationsPanel,
  ACTIONABLE_NOTIFICATION_CODES,
} from '../../../components/dashboard/NotificationsPanel';

// The hook reads `matchMedia` — happy-dom doesn't implement it, so the
// hook falls back to `false` (motion OK). The reduced-motion tests below
// bypass the hook by setting `ui.reducedMotionOverride = 'on'`, which the
// hook reads before checking the OS preference (priority order:
// override='on' → always true). For tests that don't care about motion,
// the default `'auto'` + `matchMedia` fallback = `false` is fine.

// ----------------------------------------------------------------------------
// Helpers.
// ----------------------------------------------------------------------------

function freshState() {
  return engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 });
}

function pushNotif(
  severity: 'info' | 'warning' | 'critical',
  code: string,
  message: string,
  at = 0,
): string {
  return useGameStore.getState().pushNotification({ severity, code, message, at }).id;
}

// ----------------------------------------------------------------------------
// Tests.
// ----------------------------------------------------------------------------

describe('NotificationsPanel (P5d) — empty state', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('returns null when there are no notifications', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    const { container } = render(<NotificationsPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when all notifications are non-actionable', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    pushNotif('info', 'invalid-amount', 'Invalid amount "0".');
    pushNotif('info', 'duplicate-request', 'Duplicate request.');
    pushNotif('info', 'self-transfer', 'Self-transfer rejected.');
    const { container } = render(<NotificationsPanel />);
    expect(container.firstChild).toBeNull();
  });
});

describe('NotificationsPanel (P5d) — actionable rendering', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('renders one row per actionable notification', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    pushNotif('warning', 'low-funds', 'Insufficient funds.');
    pushNotif('critical', 'tree-died', 'The original tree has died.');
    pushNotif('info', 'invalid-amount', 'Invalid amount.'); // non-actionable

    const { getByTestId } = render(<NotificationsPanel />);
    expect(getByTestId('notifications-panel')).toBeInTheDocument();
    expect(getByTestId('notifications-panel-count')).toHaveTextContent('2');
    // 2 alert/status rows — query each role separately + sum.
    const alerts = document.querySelectorAll('[role="alert"]');
    const statuses = document.querySelectorAll('[role="status"]');
    expect(alerts.length + statuses.length).toBe(2);
  });

  it('renders all six actionable codes when present', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    const codes = Array.from(ACTIONABLE_NOTIFICATION_CODES);
    for (const code of codes) {
      pushNotif('warning', code, `Message for ${code}.`);
    }
    const { getByTestId } = render(<NotificationsPanel />);
    expect(getByTestId('notifications-panel-count')).toHaveTextContent('6');
    const list = getByTestId('notifications-panel-list');
    for (const code of codes) {
      // Each row's container carries the code as a data attribute.
      expect(list.querySelector(`[data-code="${code}"]`)).not.toBeNull();
    }
  });

  it('shows the notification message + the code label', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    pushNotif('warning', 'low-funds', 'Need $5.00, have $1.00.');
    const { getByTestId } = render(<NotificationsPanel />);
    expect(getByTestId('notifications-panel')).toHaveTextContent('Need $5.00, have $1.00.');
    expect(getByTestId('notifications-panel')).toHaveTextContent('low-funds');
  });
});

describe('NotificationsPanel (P5d) — dismiss UX', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('clicking the per-row dismiss button calls dismissNotification(id)', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    const id = pushNotif('warning', 'low-funds', 'Insufficient funds.');
    const { getByTestId } = render(<NotificationsPanel />);
    fireEvent.click(getByTestId(`notification-${id}-dismiss`));
    // The notification is gone from the store.
    expect(useGameStore.getState().ui.notifications).toHaveLength(0);
  });

  it('clicking "Dismiss all" calls clearNotifications() and the panel collapses', async () => {
    useGameStore.getState().commitSimState(freshState(), []);
    pushNotif('warning', 'low-funds', 'a');
    pushNotif('critical', 'tree-died', 'b');
    pushNotif('info', 'expense-due', 'c');
    const { getByTestId, queryByTestId } = render(<NotificationsPanel />);
    fireEvent.click(getByTestId('notifications-panel-clear-all'));
    expect(useGameStore.getState().ui.notifications).toEqual([]);
    // Panel collapses to null after the store update propagates.
    await waitFor(() => {
      expect(queryByTestId('notifications-panel')).toBeNull();
    });
  });

  it('dismissing one notification leaves the others in place', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    const id1 = pushNotif('warning', 'low-funds', 'a');
    const id2 = pushNotif('critical', 'tree-died', 'b');
    const { getByTestId } = render(<NotificationsPanel />);
    fireEvent.click(getByTestId(`notification-${id1}-dismiss`));
    expect(useGameStore.getState().ui.notifications).toHaveLength(1);
    expect(useGameStore.getState().ui.notifications[0]?.id).toBe(id2);
  });
});

describe('NotificationsPanel (P5d) — ARIA + a11y', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('uses role="alert" for warning + critical notifications', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    pushNotif('warning', 'low-funds', 'low funds');
    pushNotif('critical', 'tree-died', 'tree died');
    const { getAllByRole } = render(<NotificationsPanel />);
    expect(getAllByRole('alert')).toHaveLength(2);
  });

  it('uses role="status" for info notifications', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    pushNotif('info', 'expense-due', 'expense due');
    const { getAllByRole, queryAllByRole } = render(<NotificationsPanel />);
    expect(getAllByRole('status')).toHaveLength(1);
    // queryAllByRole returns [] (not throw) when zero matches — use it
    // for the negative assertion. getAllByRole would throw here.
    expect(queryAllByRole('alert')).toHaveLength(0);
  });

  it('carries an accessible name on the region', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    pushNotif('warning', 'low-funds', 'low funds');
    const { getByRole } = render(<NotificationsPanel />);
    const region = getByRole('region', { name: /notifications/i });
    expect(region).toBeInTheDocument();
  });

  it('every dismiss button has an aria-label describing the action', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    pushNotif('warning', 'low-funds', 'Insufficient funds.');
    const { getByTestId, getAllByRole } = render(<NotificationsPanel />);
    const dismissBtn = getByTestId(/-dismiss$/);
    expect(dismissBtn).toHaveAttribute('aria-label');
    expect(dismissBtn.getAttribute('aria-label') ?? '').toMatch(/dismiss/i);
    // All buttons (dismiss + dismiss-all) are focusable + labelled.
    const buttons = getAllByRole('button');
    for (const btn of buttons) {
      const label = btn.getAttribute('aria-label') ?? btn.textContent ?? '';
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('focus-visible ring class is present on the dismiss button', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    pushNotif('warning', 'low-funds', 'low funds');
    const { getByTestId } = render(<NotificationsPanel />);
    const dismissBtn = getByTestId(/-dismiss$/);
    expect(dismissBtn.className).toContain('focus-visible:ring-2');
  });
});

describe('NotificationsPanel (P5d) — rule 6 (UI mutators only touch ui slice)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('dismiss does not change the simState reference', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    const before = useGameStore.getState().simState;
    const id = pushNotif('warning', 'low-funds', 'low funds');
    const { getByTestId } = render(<NotificationsPanel />);
    fireEvent.click(getByTestId(`notification-${id}-dismiss`));
    expect(useGameStore.getState().simState).toBe(before);
  });

  it('clear-all does not change the simState reference', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    const before = useGameStore.getState().simState;
    pushNotif('warning', 'low-funds', 'a');
    pushNotif('critical', 'tree-died', 'b');
    const { getByTestId } = render(<NotificationsPanel />);
    fireEvent.click(getByTestId('notifications-panel-clear-all'));
    expect(useGameStore.getState().simState).toBe(before);
  });
});

describe('NotificationsPanel (P5d) — selective UI updates', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('does not re-render when an unrelated simState commit lands', async () => {
    useGameStore.getState().commitSimState(freshState(), []);
    pushNotif('warning', 'low-funds', 'low funds');
    const spy = vi.fn(NotificationsPanel);
    const PanelSpy = spy as unknown as typeof NotificationsPanel;
    render(<PanelSpy />);
    await Promise.resolve();
    const baseline = spy.mock.calls.length;
    expect(baseline).toBeGreaterThanOrEqual(1);

    // Touch the simState via a fresh commit (unrelated slice — tree stress).
    // The panel subscribes to `ui.notifications` only (via the narrow
    // selector) + the dismiss/clear mutators (stable references). Should
    // NOT re-render.
    const base2 = freshState();
    useGameStore.getState().commitSimState(
      { ...base2, originalTree: { ...base2.originalTree, stress: 0.7 } },
      [],
    );
    await Promise.resolve();
    expect(spy.mock.calls.length).toBe(baseline);

    // Push a new actionable notification — SHOULD re-render.
    pushNotif('critical', 'tree-died', 'tree died');
    await waitFor(() => {
      expect(spy.mock.calls.length).toBeGreaterThan(baseline);
    });
  });
});

describe('NotificationsPanel (P5d) — cap to MAX_NOTIFICATIONS (defensive)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('caps the rendered list to PROVISIONAL_UI_MAX_NOTIFICATIONS', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    // Push 2x the cap — the store caps at MAX_NOTIFICATIONS, but the
    // panel should also slice defensively.
    for (let i = 0; i < PROVISIONAL_UI_MAX_NOTIFICATIONS * 2; i++) {
      pushNotif('warning', 'low-funds', `n${i}`);
    }
    // Store-side cap.
    expect(useGameStore.getState().ui.notifications).toHaveLength(
      PROVISIONAL_UI_MAX_NOTIFICATIONS,
    );
    const { getByTestId } = render(<NotificationsPanel />);
    // Panel-side cap (defensive backstop).
    expect(getByTestId('notifications-panel-count')).toHaveTextContent(
      String(PROVISIONAL_UI_MAX_NOTIFICATIONS),
    );
  });

  it('respects an explicit `max` prop smaller than the cap', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    for (let i = 0; i < 10; i++) {
      pushNotif('warning', 'low-funds', `n${i}`);
    }
    const { getByTestId } = render(<NotificationsPanel max={3} />);
    expect(getByTestId('notifications-panel-count')).toHaveTextContent('3');
  });
});

describe('NotificationsPanel (P5d) — reduced motion', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('applies transition-none when the in-game override is "on"', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    // Force the override to 'on' — the hook returns true regardless of the
    // OS preference (priority order: 'on' wins).
    useGameStore.getState().setReducedMotionOverride('on');
    pushNotif('warning', 'low-funds', 'low funds');
    const { getByTestId } = render(<NotificationsPanel />);
    const panel = getByTestId('notifications-panel');
    expect(panel.className).toContain('transition-none');
  });

  it('does not apply transition-none when the override is "off"', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    // Override 'off' forces motion-enabled regardless of the OS setting.
    useGameStore.getState().setReducedMotionOverride('off');
    pushNotif('warning', 'low-funds', 'low funds');
    const { getByTestId } = render(<NotificationsPanel />);
    const panel = getByTestId('notifications-panel');
    expect(panel.className).not.toContain('transition-none');
    // The transition classes are applied (non-reduced path).
    expect(panel.className).toContain('transition-');
  });
});
