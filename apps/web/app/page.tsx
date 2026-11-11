'use client';

import { useMemo } from 'react';
import { useEngineGame } from '../lib/use-engine-game';
import { createBrowserStorage } from '../lib/persistence';
import {
  DEFAULT_GAME_CONFIG,
} from '@capitalist-tree/simulation';
import {
  type GameConfig,
  type GameState,
  type SimulationEvent,
  PROVISIONAL_REAL_TO_SIM_SECONDS,
  PROVISIONAL_SPEED_MULTIPLIERS,
  PROVISIONAL_SPEED_PAUSED,
} from '@capitalist-tree/shared';

function formatTimeOfDay(fraction: number): string {
  const totalMinutes = Math.floor(fraction * 24 * 60);
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatElapsed(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `Day ${days}, ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function eventToString(ev: SimulationEvent): string {
  switch (ev.type) {
    case 'tick':
      return `tick @ step ${ev.payload.step} (day ${ev.payload.day})`;
    case 'season-changed':
      return `season: ${ev.payload.from} -> ${ev.payload.to}`;
    case 'weather-changed':
      return `weather: ${ev.payload.from ?? 'none'} -> ${ev.payload.to}`;
    case 'scheduled-event':
      return `scheduled: ${ev.payload.kind} (${ev.payload.eventId})`;
    case 'notification':
      return `[${ev.payload.severity}] ${ev.payload.message}`;
    case 'system':
      return `${ev.payload.systemId}: ${ev.payload.message}`;
    case 'harvest-completed':
      // P1 biology event — full UI lands in P4. Show a short summary.
      return `harvest: ${ev.payload.result.leavesHarvested} leaves -> ${ev.payload.result.currencyIssuance.amount} minor units`;
    case 'tree-died':
      return `tree died: ${ev.payload.cause}${ev.payload.detail ? ` (${ev.payload.detail})` : ''}`;
    case 'defoliation':
      return `defoliation: ${Math.round(ev.payload.fractionRemoved * 100)}% removed${ev.payload.repeated ? ' (repeated)' : ''}`;
    case 'biology-notification':
      return `biology: [${ev.payload.severity}] ${ev.payload.code} — ${ev.payload.message}`;
    case 'weather-damage':
      // P2 weather event — full UI lands in P4. Show a short summary.
      return `weather-damage: ${ev.payload.condition} (${ev.payload.damageType}, severity ${ev.payload.severity.toFixed(2)})`;
    case 'water-applied':
      // P2 resource event — full UI lands in P4.
      return `water applied: ${ev.payload.litres} L (soil water ${ev.payload.soilWaterBefore.toFixed(0)} -> ${ev.payload.soilWaterAfter.toFixed(0)})`;
    case 'fertilizer-applied':
      // P2 resource event — full UI lands in P4.
      return `fertilizer applied: ${ev.payload.fertilizerId} × ${ev.payload.units} (N+${ev.payload.nutrientsAdded.nitrogen.toFixed(0)} P+${ev.payload.nutrientsAdded.phosphorus.toFixed(0)} K+${ev.payload.nutrientsAdded.potassium.toFixed(0)})`;
    case 'resource-notification':
      return `resource: [${ev.payload.severity}] ${ev.payload.code} — ${ev.payload.message}`;
    case 'transaction-recorded':
      // P3a economy event — full UI lands in P4. Show a short summary.
      return `txn: ${ev.payload.record.sourceAccount} -> ${ev.payload.record.destinationAccount} = ${ev.payload.record.amount} (${ev.payload.record.category})`;
    case 'issuance-authorized':
      // P3a economy event — full UI lands in P4.
      return `issuance: +${ev.payload.amount} to ${ev.payload.destinationAccount} (req ${ev.payload.requestId})`;
    case 'issuance-rejected':
      // P3a economy event — full UI lands in P4.
      return `issuance rejected: ${ev.payload.reason} (req ${ev.payload.requestId})`;
    case 'purchase-completed':
      // P3b economy event — full UI lands in P4.
      return `purchase: ${ev.payload.quantity} × ${ev.payload.commodityId} = ${ev.payload.totalCost} (txn ${ev.payload.transactionId})`;
    case 'market-price-changed':
      // P3b economy event — full UI lands in P4.
      return `price: ${ev.payload.marketId} ${ev.payload.oldPrice} -> ${ev.payload.newPrice} (idx ${ev.payload.inflationIndexAfter.toFixed(3)})`;
    default: {
      // exhaustive check
      const _exhaustive: never = ev;
      return String(_exhaustive);
    }
  }
}

export default function HomePage() {
  const config = useMemo<GameConfig>(() => ({ ...DEFAULT_GAME_CONFIG, createdAt: Date.now() }), []);
  const storage = useMemo(() => createBrowserStorage(), []);
  const game = useEngineGame(config, storage);

  const state: GameState | null = game.state;
  if (!state) {
    return (
      <main className="p-6">
        <p>Loading engine…</p>
      </main>
    );
  }

  const clock = state.clock;
  const recent = [...game.events].slice(-10).reverse();

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">The Capitalist Tree</h1>
        <p className="text-sm text-slate-400">
          P0 Foundation — clock, speed, save/load. Tree renderer arrives in P4.
        </p>
      </header>

      <section className="rounded-lg border border-slate-800 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500">Simulation clock</div>
            <div className="text-xl font-mono">{formatElapsed(clock.elapsedSeconds)}</div>
            <div className="text-sm text-slate-300">
              Day {clock.day} · {clock.season} · {formatTimeOfDay(clock.timeOfDay)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-slate-500">Speed</div>
            <div className="text-xl font-mono">
              {clock.paused ? 'PAUSED' : `${clock.speedMultiplier}x`}
            </div>
            <div className="text-xs text-slate-500">
              1 real s = {PROVISIONAL_REAL_TO_SIM_SECONDS} sim s
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 p-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-slate-500">Speed controls</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => game.togglePause()}
            className={`px-3 py-1 rounded border ${
              clock.paused
                ? 'border-amber-500 bg-amber-500/10 text-amber-200'
                : 'border-slate-700 bg-slate-900 text-slate-200'
            }`}
          >
            {clock.paused ? 'Resume' : 'Pause'}
          </button>
          {PROVISIONAL_SPEED_MULTIPLIERS.filter((m) => m !== PROVISIONAL_SPEED_PAUSED).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => game.setSpeed(m)}
              className={`px-3 py-1 rounded border ${
                !clock.paused && clock.speedMultiplier === m
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-700 bg-slate-900 text-slate-200'
              }`}
            >
              {m}x
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-500">
          Accumulator remainder: {game.accumulator.toFixed(2)} sim seconds
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 p-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-slate-500">Persistence</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => game.save()}
            className="px-3 py-1 rounded border border-slate-700 bg-slate-900 text-slate-200"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => game.load()}
            className="px-3 py-1 rounded border border-slate-700 bg-slate-900 text-slate-200"
          >
            Load
          </button>
          <button
            type="button"
            onClick={() => game.newGame({ ...config, createdAt: Date.now() })}
            className="px-3 py-1 rounded border border-slate-700 bg-slate-900 text-slate-200"
          >
            New Game
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 p-4">
        <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Tree (P4 placeholder)</div>
        <div className="h-48 rounded border border-dashed border-slate-800 flex items-center justify-center text-slate-600">
          Renderer will go here in P4.
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 p-4 space-y-2">
        <div className="text-xs uppercase tracking-wider text-slate-500">Event log (last 10)</div>
        <ul className="space-y-1 text-sm font-mono">
          {recent.length === 0 ? (
            <li className="text-slate-600">No events yet.</li>
          ) : (
            recent.map((ev, i) => (
              <li key={`${ev.type}-${ev.at}-${i}`} className="text-slate-300">
                <span className="text-slate-500">[{ev.at}]</span> {eventToString(ev)}
              </li>
            ))
          )}
        </ul>
      </section>
    </main>
  );
}
