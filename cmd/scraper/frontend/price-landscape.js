// Fee-adjusted visual price landscape and its shared spotlight state with the provider heatmap.
export function createPriceLandscape({
  numberFormat, formatToman, displayProviderName, marketEligible, feeKnown, effectiveTotal,
}) {
  let pinnedLandscapeProvider = "";
  let hoveredLandscapeProvider = "";
  let focusedLandscapeProvider = "";
  function applyLandscapeSpotlight() {
    const activeProvider = pinnedLandscapeProvider || focusedLandscapeProvider || hoveredLandscapeProvider;
    document.getElementById("price-landscape").classList.toggle("has-spotlight", Boolean(activeProvider));
    document.getElementById("provider-heatmap-grid").classList.toggle("has-spotlight", Boolean(activeProvider));
    for (const row of document.querySelectorAll(".landscape-provider,.heatmap-tile")) {
      const active = row.dataset.provider === activeProvider;
      row.classList.toggle("is-spotlight", active);
      row.classList.toggle("is-pinned", Boolean(pinnedLandscapeProvider) && row.dataset.provider === pinnedLandscapeProvider);
      row.setAttribute("aria-pressed", String(Boolean(pinnedLandscapeProvider) && row.dataset.provider === pinnedLandscapeProvider));
    }
  }
  function toggleLandscapePin(row) {
    pinnedLandscapeProvider = pinnedLandscapeProvider === row.dataset.provider ? "" : row.dataset.provider;
    applyLandscapeSpotlight();
  }
  function renderPriceLandscape(rows, grams, bestBuy, bestSell, changedQuoteKeys = new Set()) {
    const landscape = document.getElementById("price-landscape");
    const focusedRow = document.activeElement?.closest?.(".landscape-provider");
    const focusedProviderToRestore = landscape.contains(focusedRow) && focusedRow.matches(":focus-visible") ? focusedRow.dataset.provider : "";
    const previousScores = new Map([...landscape.querySelectorAll(".landscape-track-fill[data-bar-key]")]
      .map((fill) => [fill.dataset.barKey, fill.style.getPropertyValue("--landscape-score")]));
    const candidates = { buy: [], sell: [] };
    for (const price of rows) {
      if (!marketEligible(price) || price.buy <= 0 || price.sell <= 0) continue;
      for (const side of ["buy", "sell"]) {
        if (feeKnown(price, side)) candidates[side].push(effectiveTotal(price, side, grams));
      }
    }
    const bounds = Object.fromEntries(["buy", "sell"].map((side) => [side, {
      min: candidates[side].length ? Math.min(...candidates[side]) : null,
      max: candidates[side].length ? Math.max(...candidates[side]) : null,
    }]));
    const items = rows.map((price) => {
      const item = document.createElement("article");
      item.className = "landscape-provider";
      item.dataset.provider = price.site;
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-pressed", String(pinnedLandscapeProvider === price.site));
      const hasQuote = price.available && price.buy > 0 && price.sell > 0;
      const stateLabel = !price.available ? "در انتظار نرخ" : price.stale ? "نرخ قدیمی" : "نرخ به‌روز";
      item.setAttribute("aria-label", `تمرکز روی ${displayProviderName(price.site)}؛ ${stateLabel}؛ خرید ${hasQuote ? formatToman(price.buy) : "ناموجود"}؛ فروش ${hasQuote ? formatToman(price.sell) : "ناموجود"}`);
      if (!price.available) item.classList.add("is-pending");
      else if (price.stale) item.classList.add("is-stale");

      const heading = document.createElement("div");
      heading.className = "landscape-provider-heading";
      const name = document.createElement("span");
      name.className = "landscape-provider-name";
      name.textContent = displayProviderName(price.site);
      heading.append(name);
      const state = document.createElement("span");
      state.className = "landscape-provider-state";
      state.textContent = !price.available ? "در انتظار نرخ" : price.stale ? "نرخ قدیمی" : formatQuoteAge(price.ageSeconds);
      heading.append(state);
      item.append(heading);

      const tracks = document.createElement("div");
      tracks.className = "landscape-tracks";
      for (const side of ["buy", "sell"]) {
        const track = document.createElement("div");
        track.className = `landscape-track landscape-${side}`;
        if (!price.stale && changedQuoteKeys.has(`${price.site}:${side}`)) track.classList.add("has-price-update");
        const label = document.createElement("span");
        label.className = "landscape-track-label";
        label.textContent = side === "buy" ? "خرید" : "فروش";
        track.append(label);
        const quote = document.createElement("span");
        quote.className = "landscape-track-quote number";
        const validQuote = hasQuote && price[side] > 0;
        quote.textContent = validQuote ? formatToman(price[side]) : "—";
        track.append(quote);

        const effective = validQuote && marketEligible(price) && feeKnown(price, side) ? effectiveTotal(price, side, grams) : null;
        const best = side === "buy" ? bestBuy : bestSell;
        const knownBest = Number.isFinite(best);
        const isBest = effective != null && knownBest && effective === best;
        if (isBest) track.classList.add("is-best");
        const diff = effective == null || !knownBest ? null : (side === "buy" ? effective - best : best - effective);
        const comparison = document.createElement("span");
        comparison.className = `landscape-track-difference number${isBest ? " is-best" : ""}`;
        comparison.textContent = diff == null ? "اختلاف نامشخص" : isBest ? "بهترین پیشنهاد" : `${formatToman(diff)} تا بهترین`;
        track.append(comparison);

        const bar = document.createElement("span");
        bar.className = "landscape-track-bar";
        const fill = document.createElement("span");
        fill.className = "landscape-track-fill";
        const barKey = `${price.site}:${side}`;
        fill.dataset.barKey = barKey;
        if (effective != null && knownBest) {
          const { min, max } = bounds[side];
          const score = max === min ? 1 : side === "buy" ? (max - effective) / (max - min) : (effective - min) / (max - min);
          const scorePercent = Math.max(0, Math.min(1, score)) * 100;
          fill.style.setProperty("--landscape-score", `${scorePercent}%`);
          const previousScore = previousScores.get(barKey);
          if (!landscape.hidden && changedQuoteKeys.size && previousScore && Number.parseFloat(previousScore) !== scorePercent) {
            fill.style.setProperty("--landscape-score-from", previousScore);
            fill.classList.add("is-transitioning");
          }
          if (isBest) fill.classList.add("is-best");
        } else {
          fill.classList.add("is-unavailable");
        }
        bar.append(fill);
        track.append(bar);
        const effectiveLabel = document.createElement("span");
        effectiveLabel.className = "landscape-effective number";
        effectiveLabel.textContent = effective == null ? "مبلغ مؤثر نامشخص" : `مؤثر: ${formatToman(effective)}`;
        track.append(effectiveLabel);
        tracks.append(track);
      }
      item.append(tracks);
      return item;
    });
    const primaryItems = items.filter((item) => !item.classList.contains("is-pending") && !item.classList.contains("is-stale"));
    const deferredItems = items.filter((item) => item.classList.contains("is-pending") || item.classList.contains("is-stale"));
    const legend = document.createElement("p");
    legend.className = "landscape-legend";
    legend.textContent = "نوار بلندتر = قیمت رقابتی‌تر";
    const children = [legend, ...primaryItems];
    if (deferredItems.length) {
      const wasOpen = document.getElementById("price-landscape-exceptions")?.open ?? false;
      const staleCount = deferredItems.filter((item) => item.classList.contains("is-stale")).length;
      const pendingCount = deferredItems.filter((item) => item.classList.contains("is-pending")).length;
      const disclosure = document.createElement("details");
      disclosure.id = "price-landscape-exceptions";
      disclosure.className = "provider-exceptions-disclosure landscape-exceptions-disclosure";
      const activeProvider = pinnedLandscapeProvider || focusedLandscapeProvider || hoveredLandscapeProvider;
      disclosure.open = wasOpen || deferredItems.some((item) => item.dataset.provider === activeProvider);
      const summary = document.createElement("summary");
      summary.textContent = `قدیمی: ${numberFormat.format(staleCount)} · بدون نرخ: ${numberFormat.format(pendingCount)}`;
      disclosure.append(summary, ...deferredItems);
      children.push(disclosure);
    }
    landscape.replaceChildren(...children);
    applyLandscapeSpotlight();
    if (focusedProviderToRestore) {
      const restoredRow = [...landscape.querySelectorAll(".landscape-provider")].find((row) => row.dataset.provider === focusedProviderToRestore);
      restoredRow?.focus({ preventScroll: true });
    }
    const transitioningBars = [...landscape.querySelectorAll(".landscape-track-fill.is-transitioning")];
    if (transitioningBars.length) {
      transitioningBars.forEach((fill) => { void fill.offsetWidth; });
      requestAnimationFrame(() => transitioningBars.forEach((fill) => fill.classList.remove("is-transitioning")));
    }
  }

  function setHoveredProvider(site) {
    hoveredLandscapeProvider = site;
    applyLandscapeSpotlight();
  }

  function setFocusedProvider(site) {
    focusedLandscapeProvider = site;
    applyLandscapeSpotlight();
  }
  const priceLandscape = document.getElementById("price-landscape");
  priceLandscape.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const row = event.target.closest(".landscape-provider");
    if (!row || row.contains(event.relatedTarget)) return;
    hoveredLandscapeProvider = row.dataset.provider;
    applyLandscapeSpotlight();
  });
  priceLandscape.addEventListener("pointerout", (event) => {
    if (event.pointerType === "touch") return;
    const row = event.target.closest(".landscape-provider");
    if (!row || row.contains(event.relatedTarget)) return;
    if (hoveredLandscapeProvider === row.dataset.provider) hoveredLandscapeProvider = "";
    applyLandscapeSpotlight();
  });
  priceLandscape.addEventListener("focusin", (event) => {
    const row = event.target.closest(".landscape-provider");
    focusedLandscapeProvider = row?.matches(":focus-visible") ? row.dataset.provider : "";
    applyLandscapeSpotlight();
  });
  priceLandscape.addEventListener("focusout", (event) => {
    const row = event.target.closest(".landscape-provider");
    if (!row || row.contains(event.relatedTarget)) return;
    if (focusedLandscapeProvider === row.dataset.provider) focusedLandscapeProvider = "";
    applyLandscapeSpotlight();
  });
  priceLandscape.addEventListener("click", (event) => {
    const row = event.target.closest(".landscape-provider");
    if (row) toggleLandscapePin(row);
  });
  priceLandscape.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".landscape-provider");
    if (!row) return;
    event.preventDefault();
    row.click();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !pinnedLandscapeProvider) return;
    pinnedLandscapeProvider = "";
    hoveredLandscapeProvider = "";
    focusedLandscapeProvider = "";
    applyLandscapeSpotlight();
  });
  return {
    render: renderPriceLandscape,
    applySpotlight: applyLandscapeSpotlight,
    togglePin: toggleLandscapePin,
    setHoveredProvider,
    setFocusedProvider,
  };
}
