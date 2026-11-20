/**
 * GAP-31 (DR-13) — SimulationEvent → analytics bridge.
 *
 * A pure mapper (mirrors `simulationEventToNotifications` in
 * `lib/format/event-to-notification.ts`) that extracts the HIGH-SIGNAL
 * SimulationEvents + shapes them into analytics emissions. Routine events
 * (tick, routine weather, save.ok notifications) return [] — they'd drown the
 * signal (design §3: "Recording every simulation tick as an analytics event
 * would create unnecessary storage growth").
 *
 * The caller (`recordSimEvents` in `analytics.ts`) iterates the results + calls
 * `collector.emit(name, category, data)` for each. Pure: no side effects, no I/O.
 */
import type { SimulationEvent } from '@capitalist-tree/shared';
import type { AnalyticsEventCategory } from '@capitalist-tree/analytics';

export interface AnalyticsEmission {
  event: string;
  category: AnalyticsEventCategory;
  data?: Record<string, unknown>;
}

/**
 * Map a SimulationEvent to 0+ analytics emissions. Returns [] for events that
 * aren't worth recording (routine ticks, routine notifications).
 */
export function mapSimulationEventToAnalytics(ev: SimulationEvent): AnalyticsEmission[] {
  switch (ev.type) {
    case 'tree-died': {
      // GDD §5.6 death cause — high-signal gameplay event.
      return [
        {
          event: 'tree-died',
          category: 'gameplay',
          data: { treeId: ev.payload.treeId, cause: ev.payload.cause },
        },
      ];
    }

    case 'weather-damage': {
      // Weather→biology hand-off (RV2-1) — high-signal simulation event.
      return [
        {
          event: 'weather-damage',
          category: 'simulation',
          data: {
            damageType: ev.payload.damageType,
            intensity: ev.payload.intensity,
            severity: ev.payload.severity,
          },
        },
      ];
    }

    case 'notification': {
      // objective-achieved → objective-completed (gameplay).
      // Other notifications (save.ok, load.ok, expense-due, …) are too routine
      // to record individually — skip them.
      if (ev.payload.code === 'objective-achieved') {
        return [
          {
            event: 'objective-completed',
            category: 'gameplay',
            data: { message: ev.payload.message },
          },
        ];
      }
      return [];
    }

    case 'season-changed': {
      return [
        {
          event: 'season-changed',
          category: 'simulation',
          data: { from: ev.payload.from, to: ev.payload.to },
        },
      ];
    }

    case 'tick':
    case 'weather-changed':
    case 'scheduled-event':
    case 'system':
    default:
      // Routine or already-covered elsewhere — skip to keep the signal high.
      return [];
  }
}
