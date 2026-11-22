/**
 * SimulationEvent → UiNotification bridge (P11 W25 / RV6-2, hardened W31).
 *
 * Maps the significant non-`notification` SimulationEvents into
 * `pushNotification` payloads. The NotificationsPanel filters to
 * `ACTIONABLE_NOTIFICATION_CODES` (a frozen whitelist), so this mapper MUST
 * emit codes that are in that set — otherwise the notification is stored in
 * the bounded buffer (`appendBounded`) but never rendered, evicting
 * actionable alerts without surfacing anything.
 *
 * Pre-W31 the bridge emitted `weather-severe`, `season-changed`,
 * `scheduled-event-fired`, + `system-${id}` — NONE of which were in the
 * whitelist, so 5 of 6 actionable codes (`expense-due`, `issuance-rejected`,
 * `tree-died`, `storm-damage`, `severe-weather`) were effectively never
 * produced even though the sim emits the events that should map to them.
 * W31 aligns every emitted code with the whitelist + adds the four missing
 * typed-event cases (`tree-died`, `expense-due`, `issuance-rejected`,
 * `weather-damage`). Non-actionable events (`season-changed` info, `system`
 * info/warnings) return `[]` — the recent-event log already surfaces them,
 * and emitting them would only evict actionable alerts from the buffer.
 *
 * Pure: takes a SimulationEvent, returns an array of notification payloads
 * (0 or 1 — the batch helper dedupes by code). The caller (`commitSimState` /
 * `dispatch` in the store) pushes each via `pushNotification`. Events that
 * are already `notification` type are passed through directly (they carry
 * their own actionable/non-actionable code).
 */
import type { SimulationEvent } from '@capitalist-tree/shared';
import type { UiNotification } from '../../stores/game-store';

/** Severe weather type ids (substring match against the weather `to` string / scheduled `kind`). */
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

/**
 * Map a SimulationEvent to 0+ notification payloads. Returns an empty array
 * for events that shouldn't surface (tick events, routine weather, paid bills,
 * non-actionable info events). Every emitted `code` is in
 * `ACTIONABLE_NOTIFICATION_CODES` so the panel renders it.
 */
export function simulationEventToNotifications(
  event: SimulationEvent,
): Array<Omit<UiNotification, 'id' | 'createdAtMs'>> {
  switch (event.type) {
    case 'notification': {
      // Already a notification — pass through directly (its own code determines
      // whether the panel renders it).
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
      // Severe weather shift → actionable `severe-weather`.
      const to = event.payload.to ?? '';
      const isSevere = SEVERE_WEATHER_MARKERS.some((m) => to.toLowerCase().includes(m));
      if (!isSevere) return [];
      return [
        {
          severity: 'warning',
          code: 'severe-weather',
          message: `Weather shifted to ${to.replace(/^weather:/, '').replace(/-/g, ' ')}.`,
          at: event.at,
        },
      ];
    }

    case 'weather-damage': {
      // Damage dealt to the tree → actionable `storm-damage` (the whitelist
      // bucket covers all weather-damage types: storm/frost/heat/wind/drought).
      const p = event.payload;
      return [
        {
          severity: 'warning',
          code: 'storm-damage',
          message: `Weather damage: ${p.damageType} (${Math.round(p.severity * 100)}% severity).`,
          at: event.at,
        },
      ];
    }

    case 'tree-died': {
      const p = event.payload;
      return [
        {
          severity: 'critical',
          code: 'tree-died',
          message: `The original tree has died (cause: ${p.cause}).`,
          at: event.at,
        },
      ];
    }

    case 'expense-due': {
      // Only surface UNPAID bills — a paid bill is not actionable. The
      // PersonalSystem emits one expense-due per category at each billing
      // tick; paid ones are routine, unpaid ones mean the player is out of
      // cash and the unpaid-days counter is climbing.
      const p = event.payload;
      if (p.paid) return [];
      const dayPlural = p.unpaidDaysAfter === 1 ? 'day' : 'days';
      return [
        {
          severity: 'warning',
          code: 'expense-due',
          message: `Unpaid ${p.category} bill — insufficient funds (${p.unpaidDaysAfter} unpaid ${dayPlural}).`,
          at: event.at,
        },
      ];
    }

    case 'issuance-rejected': {
      // The monetary authority refused to issue (duplicate / invalid / over
      // limit). Use the event's human-readable `message`.
      const p = event.payload;
      return [
        {
          severity: 'warning',
          code: 'issuance-rejected',
          message: p.message,
          at: event.at,
        },
      ];
    }

    case 'scheduled-event': {
      // Severe scheduled event (storm/drought/…) → actionable `severe-weather`.
      // Deduped with the weather-changed event for the same storm by the
      // batch helper (same code).
      const kind = event.payload.kind ?? '';
      const notable = SEVERE_WEATHER_MARKERS.some((m) => kind.toLowerCase().includes(m));
      if (!notable) return [];
      return [
        {
          severity: 'warning',
          code: 'severe-weather',
          message: `Scheduled event fired: ${kind.replace(/-/g, ' ')}.`,
          at: event.at,
        },
      ];
    }

    // Non-actionable events: `season-changed` (info — the player doesn't need
    // to act on a season change) + `system` (info/warning — the dispatch
    // wrapper already routes critical errors via `errorToNotification`, and
    // the recent-event log surfaces the rest). Emitting them would only evict
    // actionable alerts from the bounded notification buffer. `tick` is
    // routine. All return [] (the panel's actionable filter would drop them
    // anyway, but dropping here keeps the buffer clean).
    case 'season-changed':
    case 'system':
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
