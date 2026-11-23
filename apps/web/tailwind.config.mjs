/** @type {import('tailwindcss').Config} */
//
// Field Journal aesthetic (W48): parchment + ink + serif. The custom palette
// below is the design system; Tailwind's default colors remain available so
// legacy class strings + tone-mapped accents (sky/teal for weather/cyan) keep
// working. `font-serif` is overridden to a Georgia-first stack so the whole
// app reads as a naturalist's notebook without a web-font build dependency.
export default {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        parchment: { DEFAULT: '#f4ecd8', 2: '#ebe0c4', 3: '#dccfb0' },
        ink: { DEFAULT: '#3a2a1a', 2: '#6b5640', soft: '#8a7a5a' },
        leaf: { DEFAULT: '#5a7a3a', 2: '#7a9a4a', dark: '#3a5a2a' },
        bark: { DEFAULT: '#6b4a2a', 2: '#4a3218' },
        accent: { DEFAULT: '#8b3a2a', 2: '#6b2a1a' },
        brass: { DEFAULT: '#8a6a2a', 2: '#6a4a18' },
      },
      fontFamily: {
        serif: ['Georgia', '"Times New Roman"', '"Iowan Old Style"', 'Palatino', 'serif'],
        journal: ['"Courier New"', 'Courier', 'monospace'],
      },
    },
  },
  plugins: [],
};
