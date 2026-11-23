/**
 * NotificationsPanel — actionable notifications UI (P5d — GDD §13.5).
 *
 * Renders `ui.notifications` from the Zustand store as a compact panel of
 * dismissable toasts. Filters to **actionable** codes only — non-actionable
 * codes (e.g. `'invalid-amount'`, `'duplicate-request'`, `'self-transfer'`)
 * are still pushed to the store by the dispatch-wrapper (for the dev console
 * / future audit log) but are NOT shown to the player.
 *
 * Actionable codes (GDD §13.5 — "prioritize actionable events"):
 *
 *   - `'expense-due'`        — recurring living-expense bill came due
 *     (paid or unpaid). The player can act by managing expenses / harvesting.
 *   - `'low-funds'`          — purchase or transfer failed due to
 *     insufficient funds (or unknown account). The player can act by
 *     harvesting / selling / waiting.
 *   - `'issuance-rejected'` — monetary authority refused a currency
 *     issuance (harvest yields no money). The player can act by harvesting
 *     less / waiting for the policy window.
 *   - `'tree-died'`          — original tree died (GDD §5.6). Critical —
 *     the player can act by replanting (future) or accepting the loss.
 *   - `'storm-damage'`       — weather-damage event with damageType='storm'
 *     (GDD §4.3). The player can act by inspecting damage / pruning.
 *   - `'severe-weather'`     — weather-damage event with another damageType
 *     (frost / heat / wind / drought). Same actionable surface.
 *
 * Dismiss UX:
 *   - Each notification has a dismiss button (icon-only — `aria-label`
 *     describes the action + the message).
 *   - A "Dismiss all" button at the panel header clears the entire list
 *     (calls `clearNotifications()` — also UI-only).
 *
 * Accessibility (WCAG 2.1 AA — P5d; GDD §13 does not yet formalise an
 * accessibility section, so WCAG is the authoritative source — see
 * docs/ui.md §"Accessibility decisions" for the criteria map):
 *   - `role="alert"` on warning + critical notifications (screen readers
 *     announce them when they appear).
 *   - `role="status"` on info notifications (polite live region).
 *   - `aria-label` on every icon-only button (dismiss, dismiss-all).
 *   - `focus-visible:ring-2` on every focusable element (keyboard nav).
 *   - Colour is NEVER the only signal — each severity carries an icon
 *     (ℹ / ⚠ / 🛑) AND a text label, so colour-blind users see the level.
 *   - `prefers-reduced-motion`: the panel calls `useReducedMotion()` and
 *     suppresses the slide-in transition when reduced. (TreeView is wired
 *     to the same hook — W40 resolved R-P5d-2; see docs/ui.md.)
 *
 * Architecture (rule 6 — rendering / UI reads state, never writes):
 *   - Subscribes narrowly to `ui.notifications` (the bounded FIFO ring buffer)
 *     + the `dismissNotification` / `clearNotifications` mutators. Both
 *     mutators target the `ui` slice only — `simState` is referentially
 *     unchanged by a dismiss.
 *   - The cap to `PROVISIONAL_UI_MAX_NOTIFICATIONS` is enforced by the store
 *     (see `pushNotification` in game-store.ts); the panel re-applies the
 *     cap as a defensive backstop (in case future code pushes via a
 *     different path).
 *
 * Returns `null` when the filtered list is empty (so the page can collapse
 * the panel — no empty UI noise).
 */
'use client';

import { useCallback, useMemo, type ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { PROVISIONAL_UI_MAX_NOTIFICATIONS } from '../../lib/constants';
import type { UiNotification } from '../../stores/game-store';

export interface NotificationsPanelProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
  /**
   * Maximum number of notifications to render. Defaults to
   * {@link PROVISIONAL_UI_MAX_NOTIFICATIONS}. The store already caps the
   * ring buffer at this value; this is a defensive backstop for any
   * future code path that pushes via a different route.
   */
  readonly max?: number;
}

/**
 * The actionable notification codes (GDD §13.5). Codes NOT in this set are
 * filtered out by the panel (they may still be in the store for the dev
 * console / future audit log).
 *
 * P11 (RV6-1): the three safety-critical codes produced by the dispatch
 * wrapper (`offline-clock-tampered`, `save-corrupt`, `original-tree-
 * protected`) are now included. Pre-fix, the whitelist omitted them, so the
 * player never saw clock-tamper / corrupt-save / original-tree-guard
 * warnings even though the simulation detected them — a silent failure on
 * the most safety-critical paths. They are `critical` severity (mapped by
 * the dispatch wrapper) and render with the rose tint + alert role.
 *
 * Exported for testing + for the dispatch-wrapper's documentation.
 */
export const ACTIONABLE_NOTIFICATION_CODES: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    'expense-due',
    'low-funds',
    'issuance-rejected',
    'tree-died',
    'storm-damage',
    'severe-weather',
    // P11 (RV6-1) — safety-critical codes from the dispatch wrapper.
    'offline-clock-tampered',
    'save-corrupt',
    'original-tree-protected',
  ]),
);

/**
 * Map a severity to an icon (emoji) + a Tailwind tone class for the row's
 * left border + background tint. The icon ensures the severity is NOT
 * communicated by colour alone (WCAG 1.4.1 Use of Colour).
 */
const SEVERITY_VISUAL: Readonly<
  Record<UiNotification['severity'], { readonly icon: string; readonly border: string; readonly bg: string; readonly text: string }>
> = Object.freeze({
  // W48 (field journal): severity tints re-skinned for parchment. The dark
  // 950-bg fills (bg-sky-950/40 etc.) were tuned for dark slate; on cream
  // paper they'd read as dark holes. Switched to light tinted fills + darker
  // accent text + borders so each severity still reads at a glance (info=sky,
  // warning=brass, critical=accent-red) without the dark card. The icon is
  // unchanged — colour is never the only signal (WCAG 1.4.1).
  info: {
    icon: 'ℹ',
    border: 'border-sky-700/50',
    bg: 'bg-sky-100/50',
    text: 'text-sky-800',
  },
  warning: {
    icon: '⚠',
    border: 'border-brass/50',
    bg: 'bg-brass/15',
    text: 'text-brass-2',
  },
  critical: {
    icon: '🛑',
    border: 'border-accent/50',
    bg: 'bg-accent/10',
    text: 'text-accent',
  },
});

/**
 * Compute the ARIA `role` for a notification. Per WCAG / WAI-ARIA:
 *
 *   - `role="alert"` → assertive live region. Screen readers announce
 *     immediately. Used for warning + critical (the player should know
 *     NOW).
 *   - `role="status"` → polite live region. Screen readers announce when
 *     the user pauses. Used for info (no urgency).
 *
 * Both roles are implicit live regions — `aria-live` is redundant when the
 * role is set (the ARIA spec assigns `aria-live="assertive"` to `alert`
 * and `aria-live="polite"` to `status`).
 */
function ariaRoleFor(severity: UiNotification['severity']): 'alert' | 'status' {
  return severity === 'info' ? 'status' : 'alert';
}

/**
 * Render the NotificationsPanel. Subscribes narrowly to `ui.notifications`
 * + the dismiss / clear mutators. Returns `null` when the actionable-
 * filtered list is empty.
 */
export function NotificationsPanel({
  className,
  max = PROVISIONAL_UI_MAX_NOTIFICATIONS,
}: NotificationsPanelProps = {}): ReactElement | null {
  const notifications = useGameStore((s) => s.ui.notifications);
  const dismissNotification = useGameStore((s) => s.dismissNotification);
  const clearNotifications = useGameStore((s) => s.clearNotifications);
  const reduceMotion = useReducedMotion();

  // Filter to actionable codes + cap to `max` (FIFO — the store already
  // drops oldest first; the slice here is defensive against future code
  // that pushes via a different route).
  const items = useMemo<readonly UiNotification[]>(() => {
    const filtered = notifications.filter((n) =>
      ACTIONABLE_NOTIFICATION_CODES.has(n.code),
    );
    if (filtered.length <= max) return filtered;
    return filtered.slice(filtered.length - max);
  }, [notifications, max]);

  const onDismiss = useCallback(
    (id: string) => {
      dismissNotification(id);
    },
    [dismissNotification],
  );
  const onClearAll = useCallback(() => {
    clearNotifications();
  }, [clearNotifications]);

  if (items.length === 0) return null;

  // Transition classes are gated on `reduceMotion`. When reduced, the panel
  // still appears (content isn't gated — only the slide-in animation is).
  // Tailwind's `transition-none` overrides any inherited transition classes.
  const transitionClass = reduceMotion
    ? 'transition-none'
    : 'transition-[transform,opacity] duration-300 ease-out';

  return (
    <section
      role="region"
      aria-label="Notifications"
      className={[
        'rounded-sm border border-ink/30 bg-parchment-2/95 backdrop-blur-sm shadow-lg',
        transitionClass,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="notifications-panel"
    >
      <header className="flex items-center justify-between gap-2 border-b border-dotted border-ink/20 px-3 py-2">
        <h2 className="text-xs uppercase tracking-wider text-ink-soft font-serif smallcaps">
          Notifications
          <span
            className="ml-1.5 rounded bg-ink/10 px-1.5 py-0.5 text-[10px] tabular-nums text-ink font-journal"
            data-testid="notifications-panel-count"
          >
            {items.length}
          </span>
        </h2>
        <button
          type="button"
          onClick={onClearAll}
          aria-label="Dismiss all notifications"
          data-testid="notifications-panel-clear-all"
          className="rounded-sm border border-ink/40 bg-parchment px-2 py-0.5 text-[11px] text-ink font-serif hover:border-ink/60 hover:bg-parchment-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf/50"
        >
          Dismiss all
        </button>
      </header>
      <ul
        className="flex flex-col gap-1.5 p-2"
        data-testid="notifications-panel-list"
      >
        {items.map((n) => {
          const visual = SEVERITY_VISUAL[n.severity];
          const role = ariaRoleFor(n.severity);
          const dismissLabel = `Dismiss notification: ${n.message}`;
          return (
            <li
              key={n.id}
              role={role}
              className={[
                'flex items-start gap-2 rounded border px-2.5 py-1.5',
                visual.border,
                visual.bg,
              ].join(' ')}
              data-testid={`notification-${n.id}`}
              data-severity={n.severity}
              data-code={n.code}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 text-sm ${visual.text}`}
              >
                {visual.icon}
              </span>
              <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                <p
                  className={`text-sm leading-snug break-words ${visual.text}`}
                  data-testid={`notification-${n.id}-message`}
                >
                  {n.message}
                </p>
                <span className="text-[10px] uppercase tracking-wider text-ink-soft font-journal">
                  {n.code}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(n.id)}
                aria-label={dismissLabel}
                data-testid={`notification-${n.id}-dismiss`}
                className="shrink-0 rounded-sm border border-ink/40 bg-parchment px-1.5 py-0.5 text-xs text-ink font-serif hover:border-ink/60 hover:bg-parchment-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf/50"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
