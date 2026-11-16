// Provider comparison heatmap rendering and its metric/spotlight interactions.
export function createProviderHeatmap({
  sortValue,
  compareNumeric,
  formatToman,
  numberFormat,
  displayProviderName,
  createProviderIcon,
  applySpotlight,
  togglePin,
  onMetricChange,
  onHover,
  onFocus,
}) {
  let metric = "buy";
  const grid = document.getElementById("provider-heatmap-grid");

  function render(rows, grams) {
    const previousSurfaces = new Map([...grid.querySelectorAll(".heatmap-tile")].map((tile) => [tile.dataset.provider, getComputedStyle(tile).backgroundColor]));
    const keys = { buy: "buyPrice", sell: "sellPrice", spread: "spread" };
    const direction = metric === "sell" ? "desc" : "asc";
    const entries = rows.map((price) => ({ price, value: sortValue(price, keys[metric], grams) }));
    const ranked = entries.filter((entry) => Number.isFinite(entry.value)).sort((a, b) => compareNumeric(a.value, b.value, direction));
    const best = ranked[0]?.value ?? null;
    const worst = ranked.at(-1)?.value ?? null;
    const range = best == null || worst == null ? 0 : Math.abs(worst - best);
    const rankBySite = new Map();
    ranked.forEach((entry, index) => { if (!rankBySite.has(entry.price.site)) rankBySite.set(entry.price.site, index + 1); });
    const tiles = entries.filter(({ value }) => Number.isFinite(value)).map(({ price, value }) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "heatmap-tile";
      tile.dataset.provider = price.site;
      const valid = Number.isFinite(value);
      const isBest = valid && value === best;
      const score = !valid || range === 0 ? (valid ? 1 : 0) : Math.max(0, Math.min(1, direction === "asc" ? (worst - value) / range : (value - worst) / range));
      // Ease color separation through the middle without changing rank or displayed values.
      const colorScore = Math.pow(score, 0.82);
      const stops = [0, 0.34, 0.72, 1];
      const palettes = ["var(--heatmap-slate)", "var(--heatmap-graphite)", "var(--heatmap-copper)", "var(--heatmap-gold)"];
      const segment = Math.min(2, stops.findIndex((stop, index) => index < stops.length - 1 && colorScore <= stops[index + 1]));
      const start = segment < 0 ? 2 : segment;
      const blend = (colorScore - stops[start]) / (stops[start + 1] - stops[start]);
      tile.style.setProperty("--heatmap-from", palettes[start]);
      tile.style.setProperty("--heatmap-to", palettes[start + 1]);
      tile.style.setProperty("--heatmap-blend", `${Math.max(0, Math.min(1, blend)) * 100}%`);
      tile.classList.toggle("is-best", isBest);
      tile.classList.toggle("is-rich", valid && colorScore >= 0.72);
      if (previousSurfaces.has(price.site)) tile.style.backgroundColor = previousSurfaces.get(price.site);

      const amount = document.createElement("strong");
      amount.className = "heatmap-value number";
      amount.textContent = formatToman(value);
      const identity = document.createElement("span");
      identity.className = "heatmap-provider-identity";
      const icon = createProviderIcon(price.site, "heatmap-provider-icon");
      if (icon) identity.append(icon);
      const name = document.createElement("span");
      name.className = "heatmap-provider-name";
      name.textContent = displayProviderName(price.site);
      identity.append(name);
      const support = document.createElement("span");
      support.className = "heatmap-support";
      const difference = document.createElement("span");
      difference.className = "heatmap-difference number";
      difference.textContent = isBest ? "بهترین مقدار" : `${formatToman(Math.abs(value - best))} تا بهترین`;
      const rank = document.createElement("span");
      rank.className = "heatmap-rank";
      rank.textContent = isBest ? "بهترین پیشنهاد" : `رتبه ${numberFormat.format(rankBySite.get(price.site))}`;
      support.append(difference, rank);
      tile.append(amount, identity, support);
      tile.title = `${displayProviderName(price.site)} · ${metric === "buy" ? "خرید مؤثر" : metric === "sell" ? "فروش مؤثر" : "اختلاف مؤثر"}: ${formatToman(value)}`;
      return tile;
    });
    grid.replaceChildren(...tiles);
    if (previousSurfaces.size) requestAnimationFrame(() => grid.querySelectorAll(".heatmap-tile").forEach((tile) => { tile.style.backgroundColor = ""; }));
    applySpotlight();
  }

  document.querySelectorAll("[data-heatmap-metric]").forEach((button) => button.addEventListener("click", () => {
    metric = button.dataset.heatmapMetric;
    document.querySelectorAll("[data-heatmap-metric]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    onMetricChange();
  }));
  grid.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const tile = event.target.closest(".heatmap-tile");
    if (tile && !tile.contains(event.relatedTarget)) onHover(tile.dataset.provider);
  });
  grid.addEventListener("pointerout", (event) => {
    if (event.pointerType === "touch") return;
    const tile = event.target.closest(".heatmap-tile");
    if (tile && !tile.contains(event.relatedTarget)) onHover("");
  });
  grid.addEventListener("focusin", (event) => {
    const tile = event.target.closest(".heatmap-tile");
    onFocus(tile?.matches(":focus-visible") ? tile.dataset.provider : "");
  });
  grid.addEventListener("focusout", (event) => {
    const tile = event.target.closest(".heatmap-tile");
    if (tile && !tile.contains(event.relatedTarget)) onFocus("");
  });
  grid.addEventListener("click", (event) => {
    const tile = event.target.closest(".heatmap-tile");
    if (tile) togglePin(tile);
  });

  return { render };
}
