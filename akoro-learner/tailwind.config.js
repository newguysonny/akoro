/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: {} },
  // Preflight off: this app styles via inline styles + per-component CSS.
  // Disabling Tailwind's global reset avoids disturbing existing pages.
  corePlugins: { preflight: false },
  plugins: [],
};
