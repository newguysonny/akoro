/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Akoro design tokens (reference/Pilot application.md, Paywallscreen.md)
      colors: {
        akoro: {
          purple:     "#6C3BFF",
          purpledark: "#5A2FE0",
          purplesoft: "#F1ECFF",
          coral:      "#FF6B57",
          green:      "#2BB673",
          greensoft:  "#E7F8EF",
          bg:         "#FAFAFC",
          surface:    "#FFFFFF",
          line:       "#E7E4F0",
          ink:        "#221D33",
          dim:        "#6B667E",
        },
      },
      fontFamily: { nunito: ["Nunito", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
}
