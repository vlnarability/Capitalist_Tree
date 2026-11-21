/**
 * GAP-28 Pack 1 (DR-3 cosmetic-only) — particle flourishes: pure logic.
 *
 * The event→burst mapping, the confetti transition gate, + the particle
 * spawn/update/draw helpers. Pure + side-effect-free (given the inputs) so they
 * are unit-testable without a canvas / DOM / store. The `ParticleFlourishes`
 * component wires these to a `<canvas>` + the game store.
 *
 * DR-3 constraint: every burst is cosmetic — it changes appearance only, never a
 * simulation value, rate, or outcome. The flourishes fire on existing sim events
 * (harvest-completed, pendingEnding) but read NO mutable sim state + write none
 * (rule 6: rendering / UI reads state, never writes).
 *
 * Accessibility (GDD §13 / WCAG 2.3.3): every spawn path is gated on `reduce`
 * (from `useReducedMotion`). When reduced motion is requested, `spawnBurst` is a
 * no-op — no particles are added, so the canvas stays blank + the rAF loop has
 * nothing to draw.
 */
import type { SimulationEvent } from '@capitalist-tree/shared';

/** The three cosmetic burst kinds (design §6). */
export type BurstType = 'confetti' | 'coin-shower' | 'leaf-fall';

/**
 * A harvest this large (in leaves) is celebrated as a coin shower (a big payout)
 * rather than a plain leaf-fall. Provisional — tuned for a typical mid-game
 * harvest; cosmetic only, so the exact value is non-critical.
 */
export const COIN_SHOWER_LEAF_THRESHOLD = 50;

/** Particle counts per burst (cosmetic — tuned for a brief, light flourish). */
export const CONFETTI_COUNT = 100;
export const COIN_COUNT = 20;
export const LEAF_COUNT = 24;

/** Lifespans (seconds). */
export const CONFETTI_LIFE = 3.5;
export const COIN_LIFE = 2;
export const LEAF_LIFE = 2.5;

/** Physics (pixels / second units). */
const GRAVITY_CONFETTI = 280;
const GRAVITY_COIN = 900;
const GRAVITY_LEAF = 120;

const CONFETTI_COLORS = ['#34d399', '#38bdf8', '#fbbf24', '#fb7185', '#a78bfa', '#f472b6'] as const;
const COIN_COLOR = '#fbbf24';
const LEAF_COLORS = ['#65a30d', '#84cc16', '#ca8a04', '#a16207', '#d97706'] as const;

/** A single particle. Mutated in place by `updateParticle` each frame. */
export interface Particle {
  x: number;
  y: number;
  vx: number; // px/s (base horizontal velocity)
  vy: number; // px/s (vertical, grows with gravity)
  gravity: number; // px/s^2 (downward)
  rotation: number; // radians
  vr: number; // rotation velocity rad/s
  color: string;
  shape: 'rect' | 'circle' | 'leaf';
  size: number; // px (rect = width; circle = radius; leaf = length)
  life: number; // seconds remaining
  maxLife: number; // seconds (for alpha fade)
  swayAmp: number; // horizontal sway amplitude (px) — leaves only
  swayFreq: number; // sway frequency rad/s
  swayPhase: number; // current sway phase rad
}

/**
 * Map a sim event to a cosmetic burst (or null = no burst). Currently:
 *   - `harvest-completed` → `coin-shower` if the harvest was large
 *     (`result.leavesHarvested >= COIN_SHOWER_LEAF_THRESHOLD`), else `leaf-fall`.
 *   - everything else → null (no burst).
 *
 * Pure — given an event returns a burst type or null. Exported for testing +
 * so the component's subscribe callback is a thin wrapper.
 */
export function classifyEvent(event: SimulationEvent): BurstType | null {
  if (event.type === 'harvest-completed') {
    const leaves = event.payload.result.leavesHarvested;
    return leaves >= COIN_SHOWER_LEAF_THRESHOLD ? 'coin-shower' : 'leaf-fall';
  }
  return null;
}

/**
 * Whether a confetti burst should fire on an ending transition. Fires ONLY on
 * null → non-null (the moment the EndingScreen appears). Re-fires when the
 * player dismisses one ending + later completes another (null → non-null again).
 *
 * Pure — given (prev, next) returns boolean.
 */
export function shouldFireConfetti(
  prev: string | null,
  next: string | null,
): boolean {
  return prev === null && next !== null;
}

/**
 * Append a burst's particles to `particles` (mutates the array). No-op when
 * `reduce` is true (accessibility: respect reduced-motion — spawn nothing).
 *
 * Origin:
 *   - confetti: rain across the full top width (celebratory, full-screen).
 *   - coin-shower + leaf-fall: from the top-center (where the tree renders) so
 *     the flourish visually originates from the tree.
 *
 * Pure given the inputs (mutates only the passed array).
 */
export function spawnBurst(
  particles: Particle[],
  type: BurstType,
  w: number,
  h: number,
  reduce: boolean,
): void {
  if (reduce) return;
  if (type === 'confetti') spawnConfetti(particles, w);
  else if (type === 'coin-shower') spawnCoins(particles, w);
  else spawnLeaves(particles, w);
  // `h` is read by the component's death check (y > h + margin); not needed here
  // but kept in the signature so callers don't special-case the origin height.
  void h;
}

function spawnConfetti(particles: Particle[], w: number): void {
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    particles.push({
      x: Math.random() * w,
      y: -Math.random() * 40,
      vx: (Math.random() - 0.5) * 120,
      vy: 80 + Math.random() * 120,
      gravity: GRAVITY_CONFETTI,
      rotation: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 8,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] ?? CONFETTI_COLORS[0],
      shape: 'rect',
      size: 6 + Math.random() * 6,
      life: CONFETTI_LIFE,
      maxLife: CONFETTI_LIFE,
      swayAmp: 0,
      swayFreq: 0,
      swayPhase: 0,
    });
  }
}

function spawnCoins(particles: Particle[], w: number): void {
  const cx = w / 2;
  for (let i = 0; i < COIN_COUNT; i++) {
    particles.push({
      x: cx + (Math.random() - 0.5) * 200,
      y: -Math.random() * 40,
      vx: (Math.random() - 0.5) * 80,
      vy: 120 + Math.random() * 120,
      gravity: GRAVITY_COIN,
      rotation: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 10,
      color: COIN_COLOR,
      shape: 'circle',
      size: 7 + Math.random() * 4,
      life: COIN_LIFE,
      maxLife: COIN_LIFE,
      swayAmp: 0,
      swayFreq: 0,
      swayPhase: 0,
    });
  }
}

function spawnLeaves(particles: Particle[], w: number): void {
  const cx = w / 2;
  for (let i = 0; i < LEAF_COUNT; i++) {
    particles.push({
      x: cx + (Math.random() - 0.5) * 240,
      y: -Math.random() * 40,
      vx: (Math.random() - 0.5) * 40,
      vy: 40 + Math.random() * 60,
      gravity: GRAVITY_LEAF,
      rotation: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 4,
      color: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)] ?? LEAF_COLORS[0],
      shape: 'leaf',
      size: 8 + Math.random() * 6,
      life: LEAF_LIFE,
      maxLife: LEAF_LIFE,
      swayAmp: 20 + Math.random() * 30,
      swayFreq: 1.5 + Math.random() * 1.5,
      swayPhase: Math.random() * Math.PI * 2,
    });
  }
}

/**
 * Advance one particle by `dt` seconds. Mutates the particle in place. Returns
 * `false` when the particle is dead (life ≤ 0 or off the bottom of the canvas)
 * + should be removed; `true` if still alive.
 *
 * Pure given (p, dt, canvasH) — mutates only the passed particle.
 */
export function updateParticle(p: Particle, dt: number, canvasH: number): boolean {
  p.vy += p.gravity * dt;
  p.swayPhase += p.swayFreq * dt;
  p.x += (p.vx + Math.sin(p.swayPhase) * p.swayAmp) * dt;
  p.y += p.vy * dt;
  p.rotation += p.vr * dt;
  p.life -= dt;
  if (p.life <= 0) return false;
  if (p.y > canvasH + 40) return false;
  return true;
}

/**
 * Draw a particle to a 2D canvas context. Alpha fades over the last 25% of life
 * so bursts dissolve rather than pop. Pure given (ctx, p) — mutates only the
 * canvas (a render target, not game state).
 */
export function drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
  const fadeStart = p.maxLife * 0.25;
  const alpha = p.life < fadeStart ? Math.max(0, p.life / fadeStart) : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.fillStyle = p.color;
  if (p.shape === 'rect') {
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
  } else if (p.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(0, 0, p.size, 0, Math.PI * 2);
    ctx.fill();
    // a subtle inner highlight so coins read as coins, not flat dots.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(-p.size * 0.25, -p.size * 0.25, p.size * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // leaf: a small ellipse
    ctx.beginPath();
    ctx.ellipse(0, 0, p.size * 0.5, p.size * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
