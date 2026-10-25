/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  // Built dynamically (`btn-${variant}`), so the content scan can't see them.
  safelist: ['btn-primary', 'btn-secondary', 'btn-danger', 'btn-ghost'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          ink: 'rgb(var(--brand-ink) / <alpha-value>)',
        },
        'on-brand': 'rgb(var(--on-brand) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
      },
      fontFamily: {
        // Dalliqo typeface (self-hosted via @fontsource, same family as the mobile app).
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        urdu: ['"Noto Nastaliq Urdu"', '"Noto Naskh Arabic"', 'serif'],
      },
    },
  },
  plugins: [],
};
