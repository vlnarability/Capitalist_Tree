'use client';

/**
 * useT — translation hook (P13-C — GDD §13 UI, §16.1 accessibility).
 *
 * Returns a `t(key)` function bound to the current UI locale
 * (`ui.locale` in the Zustand store). Consumers call `const t = useT()` then
 * `t('tab.dashboard')`. The hook re-renders its consumer when the locale
 * changes (the store subscription drives it); the underlying `t` from
 * `@capitalist-tree/content` is pure + total (falls back to English, then to
 * the key itself).
 *
 * Rule 6 (rendering / UI reads state, never writes): the hook reads
 * `ui.locale`; it never writes. The `setLocale` store mutator is the only way
 * to change the locale.
 *
 * GAP: not every UI string is in the translation table yet — the starter set
 * covers the top-level surface (tabs, panels, speed controls, core actions).
 * Strings missing from a non-English locale fall back to English; strings
 * missing entirely fall back to the key. Deeper coverage is added incrementally.
 */
import { useCallback } from 'react';
import { useGameStore } from '../stores/game-store';
import { t as translate, type TranslationKey, DEFAULT_LOCALE, type Locale } from '@capitalist-tree/content';

export function useT(): (key: TranslationKey) => string {
  const locale = useGameStore((s) => s.ui.locale);
  // useCallback so consumers that depend on `t` in their own hooks/memos
  // don't recompute unless the locale changes.
  return useCallback((key: TranslationKey) => translate(key, locale), [locale]);
}

/** The current locale + whether it's the default (handy for conditional UI). */
export function useLocale(): { locale: Locale; isDefault: boolean } {
  const locale = useGameStore((s) => s.ui.locale);
  return { locale, isDefault: locale === DEFAULT_LOCALE };
}
