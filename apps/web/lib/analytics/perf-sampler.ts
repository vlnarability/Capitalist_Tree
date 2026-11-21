/**
 * GAP-31 Phase 2 (DR-13) — Sampled performance metrics.
 *
 * Design §3: "Sample performance measurements (tick duration sampled on a
 * schedule, not every tick; frame FPS sampled)." Recording every tick would
 * drown the signal + grow storage; a sampled cadence (every ~60 ticks ≈ once
 * per real second at 60fps) gives the development signal needed to spot a
 * regression (a slow tick, a frame-rate drop) without the overhead.
 *
 * The RAF loop (`useSimulationLoop`) creates one `PerfSampler` per session +
 * calls `recordTick(tickDurationMs, frameDeltaMs)` after each `engine.advance`.
 * The sampler is cadence-gated: it only emits a `tick-perf` analytics event
 * every `cadenceTicks` ticks. No-op until the analytics collector is
 * initialized (the emit goes through the `recordAnalyticsEvent` singleton).
 */
import { recordAnalyticsEvent } from './analytics.js';

/** Default cadence: sample every 60 ticks (~1/sec at 60fps). */
export const PERF_SAMPLE_CADENCE_TICKS = 60;

export class PerfSampler {
  private tickCount = 0;
  private lastSampleAtTick = 0;

  constructor(private readonly cadenceTicks: number = PERF_SAMPLE_CADENCE_TICKS) {}

  /**
   * Record one tick. Samples every `cadenceTicks` ticks (emits a `tick-perf`
   * performance event with the tick duration in ms + the derived frame FPS).
   * Never throws — the emit is fire-and-forget through the singleton.
   *
   * @param tickDurationMs wall-clock ms the `engine.advance()` call took.
   * @param frameDeltaMs   wall-clock ms since the previous frame (for FPS).
   */
  recordTick(tickDurationMs: number, frameDeltaMs: number): void {
    this.tickCount++;
    if (this.tickCount - this.lastSampleAtTick < this.cadenceTicks) return;
    this.lastSampleAtTick = this.tickCount;
    const fps = frameDeltaMs > 0 ? Math.round(1000 / frameDeltaMs) : 0;
    try {
      recordAnalyticsEvent('tick-perf', 'performance', {
        tick: this.tickCount,
        tickDurationMs: Math.round(tickDurationMs * 1000) / 1000,
        fps,
      });
    } catch {
      // swallow — analytics must never break the sim loop
    }
  }

  /** Total ticks recorded (useful for tests / the observability panel). */
  getTickCount(): number {
    return this.tickCount;
  }
}
