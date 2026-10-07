/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  // Preflight stays OFF: this app's existing pages ship their own inline-style
  // design system (DM Sans / #E8884A) built without a CSS reset — turning
  // preflight on would restyle every button, input and list in the console.
  // New Akoro-design pages (Tiers & Credits, reference/Admin-Tiers &
  // Credits prototype page.md) bring their own scoped component classes in
  // src/tailwind.css.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      fontFamily: { nunito: ["Nunito", "system-ui", "-apple-system", "sans-serif"] },
      colors: {
        // Akoro design tokens (reference/Pilot application.md)
        akoro: {
          purple:      "#6C3BFF",
          purpledark:  "#5A2FE0",
          purplesoft:  "#F1ECFF",
          coral:       "#FF6B57",
          coralsoft:   "#FFE8E4",
          coralborder: "#FFD6CB",
          coralink:    "#A6402B",
          green:       "#2BB673",
          greensoft:   "#E7F8EF",
          bg:          "#FAFAFC",
          surface:     "#FFFFFF",
          line:        "#E7E4F0",
          ink:         "#221D33",
          dim:         "#6B667E",
          lilacborder: "#DCD0FF",
          amber:       "#FFF4D6",
          amberink:    "#A8770B",
        },
      },
      borderRadius: { akoro: "18px", akorosm: "10px" },
      boxShadow:    { subtab: "0 1px 2px rgba(0,0,0,0.06)" },
    },
  },
  plugins: [],
};
