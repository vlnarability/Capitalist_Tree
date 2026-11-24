/** @type {import('tailwindcss').Config} */
//
// Dynamic aesthetic (W51): the custom palette (parchment / ink / leaf / bark /
// brass) is driven by RGB-channel CSS variables (`--ct-*`) defined in
// globals.css `:root` and overridden on `<html>` by the `useAestheticTheme`
// hook from the sustainability score (0–10). The color form
// `rgb(var(--ct-X) / <alpha-value>)` preserves every existing opacity modifier
// (`bg-parchment/45`, `border-ink/25`) without touching any component — the
// whole app re-themes by swapping the vars.
//
// `accent` (rust) stays a FIXED literal: it is the error/warning color
// (insufficient-funds, dead-tree, severe-weather, damage types) and must not
// shift with the aesthetic tier. The steward signal (red → brass → green) is a
// SEPARATE piecewise var (`--ct-steward`) used only by the aesthetic meter —
// exposed here as the `steward` color so the meter can use `text-steward` /
// `bg-steward/20` etc.
//
// `font-serif` resolves to `var(--ct-font-body)`, which the hook swaps across
// three tiers (brutalist mono / neutral sans / floral serif) as the score
// rises. `font-journal` stays a fixed Courier mono stack — the
// "annotation/ledger readout" style, deliberately constant for contrast.
export default {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        parchment: {
          DEFAULT: 'rgb(var(--ct-parchment) / <alpha-value>)',
          2: 'rgb(var(--ct-parchment-2) / <alpha-value>)',
          3: 'rgb(var(--ct-parchment-3) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ct-ink) / <alpha-value>)',
          2: 'rgb(var(--ct-ink-2) / <alpha-value>)',
          soft: 'rgb(var(--ct-ink-soft) / <alpha-value>)',
        },
        leaf: {
          DEFAULT: 'rgb(var(--ct-leaf) / <alpha-value>)',
          2: 'rgb(var(--ct-leaf-2) / <alpha-value>)',
          dark: 'rgb(var(--ct-leaf-dark) / <alpha-value>)',
        },
        bark: {
          DEFAULT: 'rgb(var(--ct-bark) / <alpha-value>)',
          2: 'rgb(var(--ct-bark-2) / <alpha-value>)',
        },
        brass: {
          DEFAULT: 'rgb(var(--ct-brass) / <alpha-value>)',
          2: 'rgb(var(--ct-brass-2) / <alpha-value>)',
        },
        // steward — the piecewise red→brass→green score-indicator color (meter).
        steward: 'rgb(var(--ct-steward) / <alpha-value>)',
        // accent stays a FIXED literal (the error/warning color) — see header.
        accent: { DEFAULT: '#8b3a2a', 2: '#6b2a1a' },
      },
      fontFamily: {
        serif: ['var(--ct-font-body)'],
        journal: ['"Courier New"', 'Courier', 'monospace'],
      },
      // W52 — corner radius re-derived from `--ct-radius` (written by
      // useAestheticTheme from the sustainability score, default 0.125rem in
      // globals.css = score-5 midpoint). Each token is a multiple of the var,
      // matching Tailwind's native DEFAULT-relative scale (sm=0.5×, md=1.5×,
      // lg=2×, xl=3×, 2xl=4×, 3xl=6×). At score 10 `--ct-radius`=0.25rem so
      // EVERY token resolves to its original Tailwind value (no regression at
      // full sustainability); at score 0 `--ct-radius`=0 so all corners go
      // sharp (brutalist industrial). `full` + `none` stay literal (pips,
      // progress bars, avatars must stay circular; `rounded-none` stays 0).
      borderRadius: {
        sm: 'calc(var(--ct-radius) * 0.5)',
        DEFAULT: 'var(--ct-radius)',
        md: 'calc(var(--ct-radius) * 1.5)',
        lg: 'calc(var(--ct-radius) * 2)',
        xl: 'calc(var(--ct-radius) * 3)',
        '2xl': 'calc(var(--ct-radius) * 4)',
        '3xl': 'calc(var(--ct-radius) * 6)',
      },
    },
  },
  plugins: [],
};
