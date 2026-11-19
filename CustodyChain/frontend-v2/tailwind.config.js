/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,js}'],
  theme: {
    extend: {
      colors: {
        ink: { 50: '#f4f6fa', 100: '#e6eaf2', 200: '#c9d1e1', 400: '#7d8aa6', 600: '#3f4c69', 700: '#2c3753', 800: '#1f2840', 900: '#141a2b' },
        seal: { 50: '#fdf6ec', 100: '#f8e6c8', 400: '#d99a3d', 500: '#c47f1f', 600: '#a2661a' },
        ok: { 50: '#ecf7f0', 600: '#2e7d4f', 700: '#256641' },
        bad: { 50: '#fcefee', 600: '#b3392f', 700: '#922e26' },
      },
      fontFamily: { sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'], mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
};
