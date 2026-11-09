/** /\ Scan the existing Go-served page and its JavaScript for the utility classes we use. */
module.exports = {
  content: ["./frontend/index.html", "./frontend/app.js"],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        ink: "var(--color-text)",
        muted: "var(--color-text-muted)",
        line: "var(--color-border)",
        paper: "var(--color-bg)",
        panel: "var(--color-surface)",
        accent: "var(--color-gold)",
        buy: "var(--color-positive)",
        sell: "var(--color-negative)",
      },
      boxShadow: { panel: "0 12px 36px rgba(0, 0, 0, .16)" },
    },
  },
  plugins: [],
};
