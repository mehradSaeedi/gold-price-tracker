/** /\ Scan the existing Go-served page and its JavaScript for the utility classes we use. */
module.exports = {
  content: ["./index.html", "./app.js"],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        ink: "#f0f1f3",
        muted: "#9a9da5",
        line: "#2c2f35",
        paper: "#101114",
        panel: "#181a1f",
        accent: "#d0a74e",
        buy: "#47c78b",
        sell: "#ee777d",
      },
      boxShadow: { panel: "0 12px 36px rgba(0, 0, 0, .16)" },
    },
  },
  plugins: [],
};
