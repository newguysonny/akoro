/** @type {import('tailwindcss').Config} */
export default {
  corePlugins: {
    preflight: false, // <-- Turn off Tailwind's reset
  },
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: { extend: {} },
  plugins: [],
}
