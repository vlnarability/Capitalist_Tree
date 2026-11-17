/**
 * Offline catch-up Web Worker (P11 W11 / RV5-F1).
 *
 * Runs the offline catch-up simulation OFF the main thread so a long absence
 * (up to 30 real days = ~1800 1-sim-day chunks) doesn't freeze the UI.
 *
 * Message protocol:
 *   - IN:  `{ type: 'run', state: GameState, nowMs: number }`
 *   - OUT: `{ type: 'progress', completed: number, total: number }` — after
 *          each chunk, so the main thread can update a progress bar.
 *   - OUT: `{ type: 'done', state: GameState, summary: OfflineSummary | null,
 *          events: SimulationEvent[] }` — the final result.
 *   - OUT: `{ type: 'error', message: string, name: string }` — if the
 *          processor throws (e.g. `OfflineClockTamperedError`). The main
 *          thread routes this via the existing error-to-notification bridge.
 *
 * The worker is a module worker (`{ type: 'module' }`) so it can import
 * `@capitalist-tree/simulation` (transpiled by Next.js's `transpilePackages`).
 * The GameState is JSON-serializable (bigints as strings), so `postMessage`
 * structured-clone handles it without a custom serializer.
 */

import { runOfflineCatchUpChunked } from '@capitalist-tree/simulation';
import type { GameState, OfflineSummary, SimulationEvent } from '@capitalist-tree/shared';

interface RunMessage {
  type: 'run';
  state: GameState;
  nowMs: number;
}

type InMessage = RunMessage;

interface ProgressMessage {
  type: 'progress';
  completed: number;
  total: number;
}
interface DoneMessage {
  type: 'done';
  state: GameState;
  summary: OfflineSummary | null;
  events: SimulationEvent[];
}
interface ErrorMessage {
  type: 'error';
  message: string;
  name: string;
}
type OutMessage = ProgressMessage | DoneMessage | ErrorMessage;

function post(msg: OutMessage): void {
  (self as unknown as { postMessage: (m: OutMessage) => void }).postMessage(msg);
}

(self as unknown as { addEventListener: (t: string, h: (e: MessageEvent) => void) => void }).addEventListener(
  'message',
  (e: MessageEvent) => {
    const msg = e.data as InMessage;
    if (!msg || msg.type !== 'run') return;

    try {
      const result = runOfflineCatchUpChunked(msg.state, msg.nowMs, (completed, total) => {
        post({ type: 'progress', completed, total });
      });
      post({
        type: 'done',
        state: result.state,
        summary: result.summary,
        events: [...result.events],
      });
    } catch (err) {
      const error = err as Error;
      post({
        type: 'error',
        message: error.message,
        name: error.name,
      });
    }
  },
);
