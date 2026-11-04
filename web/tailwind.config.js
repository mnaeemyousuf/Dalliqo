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
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        sidebar: 'rgb(var(--sidebar) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
      },
      fontFamily: {
        // Dalliqo typeface (self-hosted via @fontsource, same family as the mobile app).
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        urdu: ['"Noto Nastaliq Urdu"', '"Noto Naskh Arabic"', 'serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        // Layered, low-contrast shadows: depth without heaviness.
        xs: '0 1px 2px rgb(var(--shadow) / 0.06)',
        card: '0 1px 2px rgb(var(--shadow) / 0.05), 0 1px 3px rgb(var(--shadow) / 0.04)',
        lift: '0 2px 4px rgb(var(--shadow) / 0.04), 0 8px 24px -6px rgb(var(--shadow) / 0.12)',
        pop: '0 4px 12px -2px rgb(var(--shadow) / 0.10), 0 16px 40px -8px rgb(var(--shadow) / 0.22)',
        ring: '0 0 0 4px rgb(var(--brand-500) / 0.14)',
        'inner-line': 'inset 0 0 0 1px rgb(var(--line))',
      },
      transitionTimingFunction: {
        // Snappy, Apple-like ease-out.
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        rise: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'scale-in': { from: { opacity: '0', transform: 'translateY(4px) scale(.97)' }, to: { opacity: '1', transform: 'translateY(0) scale(1)' } },
        'slide-in-end': { from: { transform: 'translateX(var(--slide-from, 100%))' }, to: { transform: 'translateX(0)' } },
        'pop-in': { '0%': { transform: 'scale(.6)', opacity: '0' }, '60%': { transform: 'scale(1.08)', opacity: '1' }, '100%': { transform: 'scale(1)' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        pulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.45' } },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out both',
        rise: 'rise .32s cubic-bezier(0.22,1,0.36,1) both',
        'scale-in': 'scale-in .2s cubic-bezier(0.22,1,0.36,1) both',
        'slide-in-end': 'slide-in-end .32s cubic-bezier(0.22,1,0.36,1) both',
        'pop-in': 'pop-in .4s cubic-bezier(0.34,1.56,0.64,1) both',
        shimmer: 'shimmer 1.6s linear infinite',
        'soft-pulse': 'pulse 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
