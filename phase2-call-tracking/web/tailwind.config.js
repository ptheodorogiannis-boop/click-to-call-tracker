/** @type {import('tailwindcss').Config} */
// Every colour is a token from src/styles.css (the Ruler Hub glass system, shared with Ruler Reports). Utilities read
// the tokens, so a tile tone that re-points --ink re-colours everything inside it.
module.exports = {
  content: [__dirname.split('\\').join('/') + '/index.html', __dirname.split('\\').join('/') + '/src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)' },
      brand: { DEFAULT: 'var(--brand)', soft: 'var(--brand-soft)' },
      line: { DEFAULT: 'var(--line)', strong: 'var(--line-strong)' },
      paper: 'var(--paper)',
      field: 'var(--field)',
      up: 'var(--up)',
      down: 'var(--down)',
      warning: 'var(--warning)',
      'on-dark': 'var(--on-dark)',
      ground: 'var(--ground)',
      'glass-solid': 'var(--glass-solid)',
      scrim: 'var(--scrim)'
    },
    fontFamily: { sans: ['var(--font-sans)'] },
    borderRadius: { none: '0', chip: 'var(--r-chip)', input: 'var(--r-input)', pop: 'var(--r-pop)', tile: 'var(--r-tile)', full: '999px' },
    extend: {
      transitionTimingFunction: { brand: 'var(--ease-brand)' },
      maxWidth: { app: '1440px' }
    }
  },
  plugins: []
};
