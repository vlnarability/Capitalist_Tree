'use client';

/**
 * GAP-28 Pack 1 (DR-3 cosmetic-only) — particle flourishes overlay.
 *
 * A fixed, full-screen, `pointer-events-none` `<canvas>` that renders brief
 * cosmetic particle bursts on high-signal sim moments (design §6):
 *   - **leaf-fall** on a `harvest-completed` event (small harvest).
 *   - **coin-shower** on a large harvest (`leavesHarvested ≥ threshold`).
 *   - **confetti** when an ending newly completes (`ui.pendingEnding` null →
 *     non-null — pairs with the GAP-36 EndingScreen).
 *
 * Wiring: subscribes to the game store (bare `subscribe` — no React re-render)
 * + diffs the bounded `events` ring buffer by reference (handles the 50-event
 * cap wrap) to find new events; maps each via `classifyEvent`; gates every spawn
 * on `useReducedMotion` (accessibility — reduced motion = no particles).
 *
 * Rule 6 (rendering / UI reads state, never writes): reads `state.events` +
 * `state.ui.pendingEnding` only; never calls a mutator. The flourishes are
 * pure cosmetics — no sim value, rate, or outcome changes (DR-3).
 */
import { useEffect, useRef } from 'react';
import type { SimulationEvent } from '@capitalist-tree/shared';
import { useGameStore } from '../../stores/game-store';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import {
  classifyEvent,
  drawParticle,
  shouldFireConfetti,
  spawnBurst,
  updateParticle,
  type Particle,
} from './particle-bursts';

export function ParticleFlourishes(): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const reduceRef = useRef(false);
  // Keep the reduced-motion ref current without re-running the subscribe effect.
  const reduce = useReducedMotion();
  reduceRef.current = reduce;

  // rAF render loop: size the canvas to the viewport, then update + draw every
  // active particle each frame. Runs once on mount; cleaned up on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const resize = (): void => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    let raf = 0;
    let lastT = window.performance.now();
    const loop = (t: number): void => {
      raf = window.requestAnimationFrame(loop);
      let dt = (t - lastT) / 1000;
      lastT = t;
      if (dt > 0.1) dt = 0.1; // clamp after a tab switch so bursts don't jump
      const ps = particlesRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (ps.length === 0) return;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        if (p === undefined) continue;
        if (!updateParticle(p, dt, canvas.height)) {
          ps.splice(i, 1);
        } else {
          drawParticle(ctx, p);
        }
      }
    };
    raf = window.requestAnimationFrame(loop);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // Store subscription: fire bursts on new events + the ending transition.
  // Uses refs only (no closure-stale state) so the effect can run once.
  useEffect(() => {
    let lastSeenEvent: SimulationEvent | null = useGameStore.getState().events.at(-1) ?? null;
    let lastEnding: string | null = useGameStore.getState().ui.pendingEnding;

    const spawn = (type: Parameters<typeof spawnBurst>[1]): void => {
      const canvas = canvasRef.current;
      const w = canvas?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 800);
      const h = canvas?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 600);
      spawnBurst(particlesRef.current, type, w, h, reduceRef.current);
    };

    const processEvent = (event: SimulationEvent): void => {
      const burst = classifyEvent(event);
      if (burst !== null) spawn(burst);
    };

    const unsubscribe = useGameStore.subscribe((state) => {
      // Confetti on the ending transition (null → non-null).
      const ending = state.ui.pendingEnding;
      if (shouldFireConfetti(lastEnding, ending)) spawn('confetti');
      lastEnding = ending;

      // New events since the last seen (reference-diff handles the ring-buffer
      // wrap when the 50-event cap evicts the previously-last event).
      const evs = state.events;
      if (evs.length === 0) {
        lastSeenEvent = null;
        return;
      }
      const latest = evs[evs.length - 1];
      if (latest === undefined) return;
      if (lastSeenEvent === null) {
        // First-ever fire (or buffer was emptied): process only the latest, so
        // we don't replay the whole buffer as a burst storm on mount.
        processEvent(latest);
      } else {
        const idx = evs.indexOf(lastSeenEvent);
        if (idx === -1) {
          // Last-seen was evicted by the cap; process only the latest (best-effort).
          processEvent(latest);
        } else {
          for (let i = idx + 1; i < evs.length; i++) {
            const ev = evs[i];
            if (ev !== undefined) processEvent(ev);
          }
        }
      }
      lastSeenEvent = latest;
    });
    return unsubscribe;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="particle-flourishes"
      className="pointer-events-none fixed inset-0 z-[55]"
    />
  );
}
