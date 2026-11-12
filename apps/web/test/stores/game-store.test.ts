/**
 * Game store tests (P5a — TDD §16 State Management).
 *
 * Proves the core invariant: UI mutators NEVER touch `simState`'s reference
 * (TDD §16: "UI state must not be stored inside the biological or economic
 * simulation unless it affects actual gameplay" — symmetric: UI mutations
 * must not touch simulation state). Also covers:
 *
 *   - `dispatch` routes through `engine.executeAction` and replaces
 *     `simState` with the engine's fresh output (purity contract — rule 2).
 *   - `commitSimState` publishes a snapshot + appends events.
 *   - UI mutators replace the `ui` slice (new reference) while leaving
 *     `simState` referentially unchanged.
 *   - Selectors return primitive sub-slices.
 *   - Ring buffers (events, notifications) cap at their configured max.
 *
 * Environment: node (default). No DOM needed — the store is framework-agnostic
 * (only the `useGameStore` hook itself is React-aware).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type { GameState } from '@capitalist-tree/shared';
import { PROVISIONAL_SPEED_1X } from '@capitalist-tree/shared';
import {
  useGameStore,
  __resetGameStoreForTests,
  initialGameUiState,
  selectClock,
  selectPlayer,
  selectAdvancedView,
  selectNotifications,
  selectSelectedCurrencyId,
  selectReducedMotionOverride,
  selectEvents,
} from '../../stores/game-store';
import {
  pause,
  resume,
  setSpeed,
  setCurrencyCosmetic,
} from '../../lib/actions';
import {
  PROVISIONAL_UI_DEFAULT_CURRENCY_VISUAL_ID,
  PROVISIONAL_UI_DEFAULT_TAB,
  PROVISIONAL_UI_MAX_EVENT_LOG,
  PROVISIONAL_UI_MAX_NOTIFICATIONS,
} from '../../lib/constants';

// ----------------------------------------------------------------------------
// Helpers.
// ----------------------------------------------------------------------------

function freshState(): GameState {
  return engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 });
}

/** Publish a non-null simState via the loop's commit path. */
function publishState(state: GameState): void {
  useGameStore.getState().commitSimState(state, []);
}

// ----------------------------------------------------------------------------
// Tests.
// ----------------------------------------------------------------------------

describe('game-store (P5a) — initial state', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
  });

  it('initial state has reducedMotionOverride = "auto"', () => {
    const s = useGameStore.getState();
    expect(s.ui.reducedMotionOverride).toBe('auto');
  });

  it('starts with null simState, empty events, idle engineStatus, default UI', () => {
    const s = useGameStore.getState();
    expect(s.simState).toBeNull();
    expect(s.events).toEqual([]);
    expect(s.engineStatus).toBe('idle');
    expect(s.ui).toEqual(initialGameUiState());
    expect(s.ui.advancedView).toBe(false);
    expect(s.ui.selectedTab).toBe(PROVISIONAL_UI_DEFAULT_TAB);
    expect(s.ui.notifications).toEqual([]);
    expect(s.ui.selectedCurrencyId).toBe(PROVISIONAL_UI_DEFAULT_CURRENCY_VISUAL_ID);
  });
});

describe('game-store (P5a) — commitSimState publishes engine snapshots', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
  });

  it('replaces null simState with a non-null snapshot', () => {
    const state = freshState();
    publishState(state);
    expect(useGameStore.getState().simState).toBe(state);
  });

  it('replaces the previous simState reference wholesale (not a merge)', () => {
    const first = freshState();
    const second = freshState();
    publishState(first);
    publishState(second);
    expect(useGameStore.getState().simState).toBe(second);
    expect(useGameStore.getState().simState).not.toBe(first);
  });

  it('appends emitted events to the bounded log', () => {
    const state = freshState();
    useGameStore.getState().commitSimState(state, [
      {
        type: 'tick',
        at: 60,
        payload: { step: 1, day: 0, timeOfDay: 0.5 },
      },
      {
        type: 'notification',
        at: 60,
        payload: { severity: 'info', message: 'hello', code: 'test.greeting' },
      },
    ]);
    expect(useGameStore.getState().events).toHaveLength(2);
    expect(useGameStore.getState().events[0]?.type).toBe('tick');
    expect(useGameStore.getState().events[1]?.type).toBe('notification');
  });
});

describe('game-store (P5a) — dispatch routes through engine.executeAction', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
  });

  it('returns [] when simState is null (loop has not booted)', () => {
    const events = useGameStore.getState().dispatch(setSpeed(PROVISIONAL_SPEED_1X));
    expect(events).toEqual([]);
    // simState stays null — no spurious snapshot.
    expect(useGameStore.getState().simState).toBeNull();
  });

  it('routes set-speed through the engine and updates clock.speedMultiplier', () => {
    const state = freshState();
    publishState(state);
    // Sanity: the fresh state's speed is the engine default (1x).
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBe(PROVISIONAL_SPEED_1X);

    const events = useGameStore.getState().dispatch(setSpeed(5));
    const next = useGameStore.getState().simState;
    expect(next).not.toBe(state); // new reference — engine deep-copied
    expect(next?.clock.speedMultiplier).toBe(5);
    // The engine's set-speed handler emits a `system` event.
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'system')).toBe(true);
  });

  it('replaces simState with a fresh reference (never mutates the previous)', () => {
    const state = freshState();
    publishState(state);
    const beforeRef = useGameStore.getState().simState;
    useGameStore.getState().dispatch(setSpeed(15));
    const afterRef = useGameStore.getState().simState;
    expect(afterRef).not.toBe(beforeRef);
    // The previous state's clock is untouched (purity — rule 2).
    expect(beforeRef?.clock.speedMultiplier).toBe(PROVISIONAL_SPEED_1X);
    expect(afterRef?.clock.speedMultiplier).toBe(15);
  });

  it('pause() and resume() round-trip clock.paused via set-speed=0 / set-speed=N', () => {
    publishState(freshState());
    // pause sets multiplier to 0; the loop watcher cancels rAF (tested in the
    // hook tests). At the store layer, only speedMultiplier changes.
    useGameStore.getState().dispatch(pause());
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBe(0);
    useGameStore.getState().dispatch(resume(5));
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBe(5);
  });
});

describe('game-store (P5a) — UI mutators NEVER touch simState', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
  });

  it('setAdvancedView leaves simState reference unchanged', () => {
    const state = freshState();
    publishState(state);
    const before = useGameStore.getState().simState;
    useGameStore.getState().setAdvancedView(true);
    expect(useGameStore.getState().simState).toBe(before); // same reference
    expect(useGameStore.getState().ui.advancedView).toBe(true);
  });

  it('setSelectedTab leaves simState reference unchanged', () => {
    publishState(freshState());
    const before = useGameStore.getState().simState;
    useGameStore.getState().setSelectedTab('economy');
    expect(useGameStore.getState().simState).toBe(before);
    expect(useGameStore.getState().ui.selectedTab).toBe('economy');
  });

  it('setCurrencyCosmetic leaves simState reference unchanged (cosmetics stay out of sim)', () => {
    publishState(freshState());
    const before = useGameStore.getState().simState;
    useGameStore.getState().setCurrencyCosmetic('currency:gold-leaf');
    expect(useGameStore.getState().simState).toBe(before);
    expect(useGameStore.getState().ui.selectedCurrencyId).toBe('currency:gold-leaf');
    // The sim's currencyId on the economy market is unchanged.
    expect(useGameStore.getState().simState?.economy.markets[0]?.commodityId).toBe(
      before?.economy.markets[0]?.commodityId,
    );
  });

  it('P5d: setReducedMotionOverride leaves simState reference unchanged', () => {
    publishState(freshState());
    const before = useGameStore.getState().simState;
    useGameStore.getState().setReducedMotionOverride('on');
    expect(useGameStore.getState().simState).toBe(before);
    expect(useGameStore.getState().ui.reducedMotionOverride).toBe('on');
    // Default is 'auto'.
    useGameStore.getState().setReducedMotionOverride('auto');
    expect(useGameStore.getState().ui.reducedMotionOverride).toBe('auto');
    // 'off' forces motion-enabled.
    useGameStore.getState().setReducedMotionOverride('off');
    expect(useGameStore.getState().ui.reducedMotionOverride).toBe('off');
  });

  it('pushNotification leaves simState reference unchanged', () => {
    publishState(freshState());
    const before = useGameStore.getState().simState;
    const notif = useGameStore.getState().pushNotification({
      severity: 'warning',
      message: 'Soil moisture critically low.',
      code: 'soil.low',
      at: 1200,
    });
    expect(useGameStore.getState().simState).toBe(before);
    expect(notif.id).toMatch(/^ui-notif-\d+$/);
    expect(useGameStore.getState().ui.notifications).toHaveLength(1);
    expect(useGameStore.getState().ui.notifications[0]?.code).toBe('soil.low');
  });

  it('dismissNotification leaves simState reference unchanged', () => {
    publishState(freshState());
    const before = useGameStore.getState().simState;
    const notif = useGameStore.getState().pushNotification({
      severity: 'info',
      message: 'hello',
      code: 'test',
      at: 0,
    });
    useGameStore.getState().dismissNotification(notif.id);
    expect(useGameStore.getState().simState).toBe(before);
    expect(useGameStore.getState().ui.notifications).toEqual([]);
  });

  it('clearNotifications leaves simState reference unchanged', () => {
    publishState(freshState());
    const before = useGameStore.getState().simState;
    useGameStore.getState().pushNotification({
      severity: 'info',
      message: 'a',
      code: 'a',
      at: 0,
    });
    useGameStore.getState().pushNotification({
      severity: 'info',
      message: 'b',
      code: 'b',
      at: 0,
    });
    useGameStore.getState().clearNotifications();
    expect(useGameStore.getState().simState).toBe(before);
    expect(useGameStore.getState().ui.notifications).toEqual([]);
  });

  it('notifications ring buffer caps at PROVISIONAL_UI_MAX_NOTIFICATIONS', () => {
    publishState(freshState());
    const before = useGameStore.getState().simState;
    for (let i = 0; i < PROVISIONAL_UI_MAX_NOTIFICATIONS + 10; i++) {
      useGameStore.getState().pushNotification({
        severity: 'info',
        message: `n${i}`,
        code: `code.${i}`,
        at: i,
      });
    }
    expect(useGameStore.getState().ui.notifications).toHaveLength(
      PROVISIONAL_UI_MAX_NOTIFICATIONS,
    );
    // Oldest entries dropped FIFO — the first retained entry should be
    // `n10` (we pushed 30, kept last 20).
    expect(useGameStore.getState().ui.notifications[0]?.message).toBe('n10');
    expect(useGameStore.getState().simState).toBe(before); // still untouched
  });

  it('events ring buffer caps at PROVISIONAL_UI_MAX_EVENT_LOG', () => {
    publishState(freshState());
    // Push 2x the max — only the last MAX are retained.
    const events = Array.from({ length: PROVISIONAL_UI_MAX_EVENT_LOG * 2 }, (_, i) => ({
      type: 'tick' as const,
      at: i * 60,
      payload: { step: i, day: 0, timeOfDay: 0 },
    }));
    useGameStore.getState().commitSimState(freshState(), events);
    expect(useGameStore.getState().events).toHaveLength(PROVISIONAL_UI_MAX_EVENT_LOG);
    // The first retained entry's `step` should be MAX (we kept the last MAX).
    // Narrow the discriminated union before reading `payload.step`.
    const first = useGameStore.getState().events[0];
    expect(first?.type).toBe('tick');
    if (first?.type === 'tick') {
      expect(first.payload.step).toBe(PROVISIONAL_UI_MAX_EVENT_LOG);
    }
  });
});

describe('game-store (P5a) — UI-only action dispatch (applyUiAction)', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
  });

  it('set-currency-cosmetic updates the UI slice without touching simState', () => {
    publishState(freshState());
    const before = useGameStore.getState().simState;
    useGameStore.getState().applyUiAction(setCurrencyCosmetic('currency:euro-leaf'));
    expect(useGameStore.getState().simState).toBe(before);
    expect(useGameStore.getState().ui.selectedCurrencyId).toBe('currency:euro-leaf');
  });
});

describe('game-store (P5a) — setEngineStatus', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
  });

  it('updates engineStatus without touching simState', () => {
    publishState(freshState());
    const before = useGameStore.getState().simState;
    useGameStore.getState().setEngineStatus('running');
    expect(useGameStore.getState().engineStatus).toBe('running');
    expect(useGameStore.getState().simState).toBe(before);
  });
});

describe('game-store (P5a) — selectors return sub-slices', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
  });

  it('selectClock / selectPlayer return null when simState is null', () => {
    const s = useGameStore.getState();
    expect(selectClock(s)).toBeNull();
    expect(selectPlayer(s)).toBeNull();
  });

  it('selectClock returns the clock sub-slice when simState is published', () => {
    const state = freshState();
    publishState(state);
    const s = useGameStore.getState();
    expect(selectClock(s)).toBe(state.clock);
    expect(selectPlayer(s)).toBe(state.player);
  });

  it('selectAdvancedView / selectSelectedCurrencyId / selectNotifications / selectEvents return UI slices', () => {
    publishState(freshState());
    useGameStore.getState().setAdvancedView(true);
    const s = useGameStore.getState();
    expect(selectAdvancedView(s)).toBe(true);
    expect(selectSelectedCurrencyId(s)).toBe(PROVISIONAL_UI_DEFAULT_CURRENCY_VISUAL_ID);
    expect(selectNotifications(s)).toEqual([]);
    expect(selectEvents(s)).toEqual([]);
  });

  it('P5d: selectReducedMotionOverride returns the current override value', () => {
    publishState(freshState());
    // Default.
    expect(selectReducedMotionOverride(useGameStore.getState())).toBe('auto');
    useGameStore.getState().setReducedMotionOverride('on');
    expect(selectReducedMotionOverride(useGameStore.getState())).toBe('on');
    useGameStore.getState().setReducedMotionOverride('off');
    expect(selectReducedMotionOverride(useGameStore.getState())).toBe('off');
  });
});

describe('game-store (P5a) — subscribe (Zustand API)', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
  });

  it('subscribe fires on simState changes (loop commits)', () => {
    const calls: (GameState | null)[] = [];
    const unsub = useGameStore.subscribe((s) => {
      calls.push(s.simState);
    });
    publishState(freshState());
    publishState(freshState());
    unsub();
    // Zustand fires the listener on every set() call (including ones that
    // don't change the subscribed slice). We care that the latest snapshot
    // is reflected.
    expect(calls[calls.length - 1]).not.toBeNull();
  });

  it('subscribe fires on UI slice changes', () => {
    let lastAdvanced: boolean | null = null;
    const unsub = useGameStore.subscribe((s) => {
      lastAdvanced = s.ui.advancedView;
    });
    useGameStore.getState().setAdvancedView(true);
    useGameStore.getState().setAdvancedView(false);
    unsub();
    expect(lastAdvanced).toBe(false);
  });
});
