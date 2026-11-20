/**
 * SimulationEvent → UiNotification bridge (P11 W25 / RV6-2).
 *
 * Pre-W25, only events already typed as `notification` surfaced in the
 * NotificationsPanel — `weather-changed`, `season-changed`,
 * `scheduled-event`, + `system` events went to the recent-event log but
 * never became UI notifications. This mapper bridges the significant
 * non-notification events into `pushNotification` calls so the player sees
 * weather transitions, season changes, scheduled-event firings, + system
 * warnings in the notification panel.
 *
 * Pure: takes a SimulationEvent, returns an array of notification payloads
 * (0, 1, or occasionally 2 — most events map to 0 or 1). The caller
 * (`commitSimState` / `dispatch` in the store) pushes each via
 * `pushNotification`. Events that are already `notification` type are
 * passed through directly (they're already notification payloads).
 */
import type { SimulationEvent } from '@capitalist-tree/shared';
import type { UiNotification } from '../../stores/game-store';

/** Severe weather type ids (substring match against the weather `to` string). */
const SEVERE_WEATHER_MARKERS = [
  'storm',
  'drought',
  'extreme',
  'heat-wave',
  'heatwave',
  'frost',
  'flood',
  'blizzard',
  'wildfire',
];

/** System events that warrant a notification (substring match on systemId). */
const NOTABLE_SYSTEM_MARKERS = ['error', 'warning', 'fail', 'overflow', 'stall'];

/**
 * Map a SimulationEvent to 0+ notification payloads. Returns an empty array
 * for events that shouldn't surface (tick events, routine weather, etc.).
 */
export function simulationEventToNotifications(
  event: SimulationEvent,
): Array<Omit<UiNotification, 'id' | 'createdAtMs'>> {
  switch (event.type) {
    case 'notification': {
      // Already a notification — pass through directly.
      return [
        {
          severity: event.payload.severity,
          code: event.payload.code,
          message: event.payload.message,
          at: event.at,
        },
      ];
    }

    case 'weather-changed': {
      const to = event.payload.to ?? '';
      const isSevere = SEVERE_WEATHER_MARKERS.some((m) => to.toLowerCase().includes(m));
      if (!isSevere) return [];
      return [
        {
          severity: 'warning',
          code: 'weather-severe',
          message: `Weather shifted to ${to.replace(/^weather:/, '').replace(/-/g, ' ')}.`,
          at: event.at,
        },
      ];
    }

    case 'season-changed': {
      return [
        {
          severity: 'info',
          code: 'season-changed',
          message: `Season changed from ${event.payload.from} to ${event.payload.to}.`,
          at: event.at,
        },
      ];
    }

    case 'scheduled-event': {
      // Only surface scheduled events with a notable kind (severe events).
      const kind = event.payload.kind ?? '';
      const notable = SEVERE_WEATHER_MARKERS.some((m) => kind.toLowerCase().includes(m));
      if (!notable) return [];
      return [
        {
          severity: 'warning',
          code: 'scheduled-event-fired',
          message: `Scheduled event fired: ${kind.replace(/-/g, ' ')}.`,
          at: event.at,
        },
      ];
    }

    case 'system': {
      const systemId = event.payload.systemId ?? '';
      const message = event.payload.message ?? '';
      const notable = NOTABLE_SYSTEM_MARKERS.some(
        (m) => systemId.toLowerCase().includes(m) || message.toLowerCase().includes(m),
      );
      if (!notable) return [];
      // Infer severity: 'error'/'fail' → critical, else warning.
      const critical = ['error', 'fail', 'overflow'].some(
        (m) => systemId.toLowerCase().includes(m) || message.toLowerCase().includes(m),
      );
      return [
        {
          severity: critical ? 'critical' : 'warning',
          code: `system-${systemId}`,
          message,
          at: event.at,
        },
      ];
    }

    case 'tick':
    default:
      return [];
  }
}

/**
 * Map an array of SimulationEvents to notification payloads (flattened).
 * Deduped by `code` within the batch (so a burst of the same notification
 * code doesn't flood the panel).
 */
export function simulationEventsToNotifications(
  events: readonly SimulationEvent[],
): Array<Omit<UiNotification, 'id' | 'createdAtMs'>> {
  const seen = new Set<string>();
  const out: Array<Omit<UiNotification, 'id' | 'createdAtMs'>> = [];
  for (const ev of events) {
    for (const n of simulationEventToNotifications(ev)) {
      if (seen.has(n.code)) continue;
      seen.add(n.code);
      out.push(n);
    }
  }
  return out;
}
