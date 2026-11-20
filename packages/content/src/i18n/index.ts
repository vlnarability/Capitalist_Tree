/**
 * Internationalization (i18n) infrastructure (P13-C — GDD §13 UI, §16.1
 * accessibility). A lightweight, UI-agnostic translation table consumed by
 * the web app (apps/web) via a `locale` field on `GameUiState` + a `useT()` hook.
 *
 * Design: a flat key → string dictionary per locale, with English as the
 * fallback. Keys are dotted namespaced strings (`'tab.dashboard'`,
 * `'panel.money'`, `'action.harvest'`). Adding a locale = append a column to
 * `TRANSLATIONS` + add it to `SUPPORTED_LOCALES`; missing keys fall back to
 * English so a partial translation never crashes the UI.
 *
 * This is a starter set — it covers the top-level UI surface (app title, tabs,
 * dashboard panels, common speed controls, core actions) the ui.md §13/§14
 * describes. Deeper strings (every notification message, every business type
 * name) are added incrementally; the `t()` fallback ensures nothing breaks
 * while translations are incomplete.
 */

/** Supported locales (BCP-47 style tags). */
export type Locale = 'en' | 'zh-CN' | 'es';

/** The default / fallback locale. Missing keys resolve to this. */
export const DEFAULT_LOCALE: Locale = 'en';

/** All supported locales, in display order. */
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh-CN', 'es'];

/** Human-readable display names for the locale picker (in the target language). */
export const LOCALE_DISPLAY_NAMES: Readonly<Record<Locale, string>> = {
  en: 'English',
  'zh-CN': '简体中文',
  es: 'Español',
};

/** Translation keys — a starter set covering the top-level UI surface. */
export type TranslationKey =
  | 'app.title'
  | 'tab.dashboard'
  | 'tab.biology'
  | 'tab.environment'
  | 'tab.harvest'
  | 'tab.purchase'
  | 'tab.transactions'
  | 'tab.notifications'
  | 'panel.money'
  | 'panel.tree'
  | 'panel.expenses'
  | 'panel.resources'
  | 'panel.weather'
  | 'panel.speed'
  | 'speed.pause'
  | 'speed.play'
  | 'speed.fastForward'
  | 'action.harvest'
  | 'action.purchase'
  | 'action.applyWater'
  | 'action.applyFertilizer'
  | 'action.restructureOwnership'
  | 'action.importCommodity'
  | 'action.exportCommodity'
  | 'common.settings'
  | 'common.credits';

/** The translation dictionary: locale → key → string. */
export const TRANSLATIONS: Readonly<Record<Locale, Partial<Record<TranslationKey, string>>>> = {
  en: {
    'app.title': 'Capitalist Tree',
    'tab.dashboard': 'Dashboard',
    'tab.biology': 'Biology',
    'tab.environment': 'Environment',
    'tab.harvest': 'Harvest',
    'tab.purchase': 'Purchase',
    'tab.transactions': 'Transactions',
    'tab.notifications': 'Notifications',
    'panel.money': 'Money',
    'panel.tree': 'Tree',
    'panel.expenses': 'Expenses',
    'panel.resources': 'Resources',
    'panel.weather': 'Weather',
    'panel.speed': 'Speed',
    'speed.pause': 'Pause',
    'speed.play': 'Play',
    'speed.fastForward': 'Fast Forward',
    'action.harvest': 'Harvest Leaves',
    'action.purchase': 'Purchase',
    'action.applyWater': 'Apply Water',
    'action.applyFertilizer': 'Apply Fertilizer',
    'action.restructureOwnership': 'Restructure Ownership',
    'action.importCommodity': 'Import',
    'action.exportCommodity': 'Export',
    'common.settings': 'Settings',
    'common.credits': 'Credits',
  },
  'zh-CN': {
    'app.title': '资本之树',
    'tab.dashboard': '仪表盘',
    'tab.biology': '生物',
    'tab.environment': '环境',
    'tab.harvest': '采收',
    'tab.purchase': '购买',
    'tab.transactions': '交易',
    'tab.notifications': '通知',
    'panel.money': '资金',
    'panel.tree': '树木',
    'panel.expenses': '支出',
    'panel.resources': '资源',
    'panel.weather': '天气',
    'panel.speed': '速度',
    'speed.pause': '暂停',
    'speed.play': '播放',
    'speed.fastForward': '快进',
    'action.harvest': '采收树叶',
    'action.purchase': '购买',
    'action.applyWater': '浇水',
    'action.applyFertilizer': '施肥',
    'action.restructureOwnership': '重组所有权',
    'action.importCommodity': '进口',
    'action.exportCommodity': '出口',
    'common.settings': '设置',
    'common.credits': '致谢',
  },
  es: {
    'app.title': 'Árbol Capitalista',
    'tab.dashboard': 'Panel',
    'tab.biology': 'Biología',
    'tab.environment': 'Entorno',
    'tab.harvest': 'Cosechar',
    'tab.purchase': 'Comprar',
    'tab.transactions': 'Transacciones',
    'tab.notifications': 'Notificaciones',
    'panel.money': 'Dinero',
    'panel.tree': 'Árbol',
    'panel.expenses': 'Gastos',
    'panel.resources': 'Recursos',
    'panel.weather': 'Clima',
    'panel.speed': 'Velocidad',
    'speed.pause': 'Pausa',
    'speed.play': 'Reproducir',
    'speed.fastForward': 'Avance Rápido',
    'action.harvest': 'Cosechar Hojas',
    'action.purchase': 'Comprar',
    'action.applyWater': 'Aplicar Agua',
    'action.applyFertilizer': 'Aplicar Fertilizante',
    'action.restructureOwnership': 'Reestructurar Propiedad',
    'action.importCommodity': 'Importar',
    'action.exportCommodity': 'Exportar',
    'common.settings': 'Ajustes',
    'common.credits': 'Créditos',
  },
};

/**
 * Resolve a translation key for the given locale, falling back to English
 * (then to the key itself if English is also missing — defensive, so a typo
 * never crashes the UI). Pure + total.
 *
 * @param key the translation key (e.g. `'tab.dashboard'`).
 * @param locale the target locale (defaults to `DEFAULT_LOCALE`).
 * @returns the translated string.
 */
export function t(key: TranslationKey, locale: Locale = DEFAULT_LOCALE): string {
  const localeTable = TRANSLATIONS[locale];
  const enTable = TRANSLATIONS[DEFAULT_LOCALE];
  return localeTable[key] ?? enTable[key] ?? key;
}
