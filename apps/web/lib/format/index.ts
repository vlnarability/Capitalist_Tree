/**
 * Barrel for `lib/format` (P5b).
 *
 * Re-exports the pure formatting helpers so dashboard components can
 * `import { formatMoney, labelForTree } from '@/lib/format'` from one
 * place. The implementation files stay split per-domain (money / tree /
 * weather) so each has its own test file.
 */
export * from './money';
export * from './tree';
export * from './weather';
