/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        app: 'var(--bg)',
        deep: 'var(--bg-deep)',
        surface: 'var(--surface)',
        solid: 'var(--surface-solid)',
        hover: 'var(--surface-hover)',
        elevated: 'var(--elevated)',
        line: 'var(--line)',
        lineStrong: 'var(--line-strong)',
        ink: 'var(--text)',
        dim: 'var(--text-dim)',
        faint: 'var(--text-faint)',
        field: 'var(--field)',
        fieldIdle: 'var(--field-idle)',
        accent: 'var(--accent)'
      },
      borderRadius: {
        soft: 'var(--radius)',
        card: 'calc(var(--radius) + 4px)',
        pill: '999px'
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        ring: '0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent)'
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.22, 1, 0.36, 1)',
        snap: 'cubic-bezier(0.32, 0.72, 0, 1)'
      },
      fontSize: {
        '2xs': ['10px', '13px'],
        xs: ['11px', '15px'],
        sm: ['12.5px', '17px'],
        base: ['13.5px', '19px']
      }
    }
  },
  plugins: []
}
