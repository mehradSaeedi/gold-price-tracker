// Provider comparison table, fee-aware sorting, heatmap rendering, and display controls.
import { createProviderHeatmap } from "./provider-heatmap.js";
import { createPriceLandscape } from "./price-landscape.js";

export function createComparisonView({
  numberFormat, decimalNumberFormat, movementPercentFormat,
  feeFor, feeKnown, effectiveTotal, formatToman,
  providerTradeLinks, displayProviderName, displayQuoteSource,
  marketEligible, quoteMovements, decisionSummaryController, providerTrends,
  onRefresh, onOpenProviderChart,
}) {
  const movementDisplayMs = 5000;
  const sortState = { key: "buyPrice", direction: "asc" };
  // /\ Show the amount charged by the known percentage and fixed fee without applying it to the quote again.
  function actualFeeAmount(price, side, grams) {
    const fee = feeFor(price, side);
    if (!fee || price.feeIncludedInPrice) return null;
    return price[side] * grams * fee.rate + fee.fixedToman;
  }

  // /\ Keep advertised per-gram prices separate from the fee-adjusted amount the customer pays or receives.
  function effectivePerGram(price, side, grams) {
    if (!feeKnown(price, side) || !price.available || price[side] <= 0) return null;
    return effectiveTotal(price, side, grams) / grams;
  }

  // /\ Calculate the buy-versus-sell spread on the same per-gram, fee-adjusted basis for this order size.
  function effectiveSpread(price, grams) {
    const buy = effectivePerGram(price, "buy", grams);
    const sell = effectivePerGram(price, "sell", grams);
    return buy == null || sell == null ? null : buy - sell;
  }

  function formatQuoteAge(ageSeconds) {
    const seconds = Number(ageSeconds);
    if (!Number.isFinite(seconds) || seconds < 0) return "زمان نامشخص";
    const wholeSeconds = Math.floor(seconds);
    if (wholeSeconds < 60) return `${numberFormat.format(wholeSeconds)} ثانیه پیش`;
    const minutes = Math.floor(wholeSeconds / 60);
    if (minutes < 60) return `${numberFormat.format(minutes)} دقیقه پیش`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${numberFormat.format(hours)} ساعت پیش`;
    return `${numberFormat.format(Math.floor(hours / 24))} روز پیش`;
  }

  // /\\ Show accumulated flat time as a duration, not as a time since an event.
  function formatDuration(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(value / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${numberFormat.format(days)} روز`;
    if (hours > 0) return `${numberFormat.format(hours)} ساعت`;
    if (minutes > 0) return `${numberFormat.format(minutes)} دقیقه`;
    return `${numberFormat.format(value)} ثانیه`;
  }


  // /\ Show each known fee's real charge for the selected order and explain its source components on hover/focus.
  function feeBadge(price, side, grams) {
    const fee = feeFor(price, side);
    const badge = document.createElement("span");
    badge.className = "fee-badge";
    badge.tabIndex = 0;
    if (price.feeIncludedInPrice) {
      badge.textContent = "در نرخ منظور شده";
      badge.title = "این نرخ از قبل شامل کارمزد است؛ کارمزد دوباره اضافه نشده است.";
    } else if (!fee) {
      badge.classList.add("fee-unknown");
      badge.textContent = "نامشخص";
      badge.title = "مقدار کارمزد از منبع در دسترس نیست.";
    } else {
      const amount = document.createElement("span");
      amount.textContent = formatToman(actualFeeAmount(price, side, grams));
      badge.append(amount);
      if (fee.rate > 0) {
        const rate = document.createElement("span");
        rate.className = "fee-rate-inline";
        rate.textContent = `${decimalNumberFormat.format(fee.rate * 100)}٪`;
        badge.append(rate);
      }
      const parts = [];
      if (fee.rate) parts.push(`${decimalNumberFormat.format(fee.rate * 100)}٪`);
      if (fee.fixedToman) parts.push(formatToman(fee.fixedToman));
      badge.title = `اجزای کارمزد: ${parts.length ? parts.join(" + ") : "بدون کارمزد"} · برای ${decimalNumberFormat.format(grams)} گرم`;
    }
    badge.setAttribute("aria-label", `${badge.textContent}. ${badge.title}`);
    return badge;
  }

  // /\\ Keep only extra fee details here; the percentage rate already sits beside the calculated amount above.
  function feeRateDetail(price, side) {
    const fee = feeFor(price, side);
    if (!fee) return "جزئیات کارمزد نامشخص";
    if (fee.fixedToman) return `${formatToman(fee.fixedToman)} ثابت`;
    if (price.feeIncludedInPrice) return "کارمزد در نرخ اعلامی منظور شده";
    if (fee.rate) return "";
    return "بدون کارمزد";
  }

  // /\ Keep unavailable or unknown values after numeric values in either sort direction.
  function compareNumeric(a, b, direction) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return direction === "asc" ? a - b : b - a;
  }

  // /\ Pick the numeric value for each sortable column, including the current order size's fee impact.
  function sortValue(price, key, grams) {
    switch (key) {
      case "buyPrice": return marketEligible(price) && feeKnown(price, "buy") ? effectiveTotal(price, "buy", grams) : null;
      case "buyFee": return actualFeeAmount(price, "buy", grams);
      case "sellPrice": return marketEligible(price) && feeKnown(price, "sell") ? effectiveTotal(price, "sell", grams) : null;
      case "sellFee": return actualFeeAmount(price, "sell", grams);
      case "spread": return marketEligible(price) ? effectiveSpread(price, grams) : null;
      default: return null;
    }
  }

  // /\\ Keep the alternate landscape tied to the same fee-adjusted offer values used by the table's best-offer ranking.
  // The landscape owns its spotlight state and shares it with the heatmap through a small controller.
  const priceLandscape = createPriceLandscape({
    numberFormat, formatToman, displayProviderName, formatQuoteAge, marketEligible, feeKnown, effectiveTotal,
  });

  function updateSortIndicators() {
    for (const button of document.querySelectorAll("button[data-sort-key]")) {
      const active = button.dataset.sortKey === sortState.key;
      button.setAttribute("aria-pressed", String(active));
      const heading = button.closest("th");
      heading.setAttribute("aria-sort", active ? (sortState.direction === "asc" ? "ascending" : "descending") : "none");
      const icon = button.querySelector("svg");
      icon.style.transform = sortState.direction === "asc" ? "rotate(0deg)" : "rotate(180deg)";
    }
  }

  // /\ Give each new column a useful starting direction, then reverse it on repeated clicks.
  function chooseSort(key) {
    if (sortState.key === key) {
      sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
    } else {
      sortState.key = key;
      sortState.direction = key === "sellPrice" ? "desc" : "asc";
    }
    updateSortIndicators();
    onRefresh();
  }

  // /\ Build one row with quoted prices, separate fee estimates, fee-adjusted prices, and provider actions.
  function renderComparisonTable(prices, grams, changedQuoteKeys = new Set()) {
    const usable = prices.filter((price) => marketEligible(price) && price.buy > 0 && price.sell > 0);
    const bestBuy = Math.min(...usable.filter((price) => feeKnown(price, "buy")).map((price) => effectiveTotal(price, "buy", grams)));
    const bestSell = Math.max(...usable.filter((price) => feeKnown(price, "sell")).map((price) => effectiveTotal(price, "sell", grams)));
    const rows = [...prices].sort((a, b) => {
      const statusOrder = Number(!marketEligible(a)) - Number(!marketEligible(b));
      if (statusOrder) return statusOrder;
      const comparison = compareNumeric(sortValue(a, sortState.key, grams), sortValue(b, sortState.key, grams), sortState.direction);
      return comparison || displayProviderName(a.site).localeCompare(displayProviderName(b.site), "fa");
    });
    priceLandscape.render(rows, grams, bestBuy, bestSell, changedQuoteKeys);
    providerHeatmap.render(rows, grams);
    const body = document.getElementById("comparison-rows");
    const rowNodes = rows.map((price) => {
      const row = document.createElement("tr");
      const usableQuote = price.available && price.buy > 0 && price.sell > 0;
      if (!price.available) row.classList.add("pending-row");
      if (price.stale) row.classList.add("stale-row");

      const providerCell = document.createElement("td");
      providerCell.className = "provider-column";
      const provider = document.createElement("div");
      provider.className = "flex w-full items-center gap-2 font-semibold";
      const tradeURL = providerTradeLinks[price.site];
      if (tradeURL) {
        const faviconURL = new URL("/favicon.ico", tradeURL);
        const fallbackFaviconURL = new URL("https://www.google.com/s2/favicons/");
        fallbackFaviconURL.searchParams.set("domain", new URL(tradeURL).hostname);
        fallbackFaviconURL.searchParams.set("sz", "64");
        const useFallbackImmediately = decisionSummaryController.hasFailedFaviconOrigin(faviconURL.origin);
        let fallbackTried = useFallbackImmediately;
        const favicon = document.createElement("img");
        favicon.className = "provider-logo";
        favicon.src = useFallbackImmediately ? fallbackFaviconURL.href : faviconURL.href;
        favicon.alt = "";
        favicon.setAttribute("aria-hidden", "true");
        favicon.loading = "lazy";
        favicon.addEventListener("error", () => {
          if (!fallbackTried) {
            decisionSummaryController.markFailedFaviconOrigin(faviconURL.origin);
            fallbackTried = true;
            favicon.src = fallbackFaviconURL.href;
            return;
          }
          favicon.remove();
        });
        provider.append(favicon);
      }
      const providerName = document.createElement(tradeURL ? "a" : "span");
      providerName.className = tradeURL ? "provider-name provider-link" : "provider-name";
      if (tradeURL) {
        providerName.href = tradeURL;
        providerName.target = "_blank";
        providerName.rel = "noopener noreferrer";
        providerName.title = `ورود به وب‌سایت ${displayProviderName(price.site)} در زبانه جدید`;
        providerName.setAttribute("aria-label", `ورود به وب‌سایت ${displayProviderName(price.site)}`);
      }
      providerName.textContent = displayProviderName(price.site);
      provider.append(providerName);
      const chartButton = document.createElement("button");
      chartButton.type = "button";
      chartButton.className = "provider-chart-button";
      chartButton.dataset.chartProvider = price.site;
      chartButton.title = `نمایش نمودار ${displayProviderName(price.site)}`;
      chartButton.setAttribute("aria-label", `نمایش نمودار ${displayProviderName(price.site)}`);
      chartButton.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 15.5 7.2 11l3 2.4 6.8-8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.8 5.4H17v4.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      chartButton.addEventListener("click", () => onOpenProviderChart(price.site));
      provider.append(chartButton);
      providerCell.append(provider);
      const metadata = document.createElement("div");
      metadata.className = "provider-metadata";
      const source = document.createElement("span");
      source.className = "source-detail";
      source.textContent = `منبع نرخ: ${displayQuoteSource(price.source)}`;
      metadata.append(source);
      if (price.available) {
        const age = document.createElement("span");
        age.className = `quote-age${price.stale ? " quote-age-stale" : ""}`;
        age.textContent = price.stale ? `قدیمی · ${formatQuoteAge(price.ageSeconds)}` : formatQuoteAge(price.ageSeconds);
        age.title = price.stale ? "آخرین نرخ این ارائه‌دهنده قدیمی است" : "زمان دریافت آخرین نرخ";
        metadata.append(age);
      } else {
        const status = document.createElement("span");
        status.className = "quote-pending";
        status.textContent = "در انتظار نرخ";
        metadata.append(status);
      }
      if (price.available && price.unchanged) {
        const stagnation = document.createElement("span");
        stagnation.className = "quote-age quote-age-unchanged";
        const duration = formatDuration(price.flatSeconds);
        const changes = numberFormat.format(Math.max(0, Number(price.jumpCount) || 0));
        stagnation.textContent = `تقریباً ثابت · ${duration} · ${changes} تغییر`;
        stagnation.title = "این نرخ به‌دلیل ثبات طولانی در محاسبات بازار لحاظ نمی‌شود";
        metadata.append(stagnation);
      }
      providerCell.append(metadata);
      row.append(providerCell);

      // Provider mini-chart column; remove with the isolated mini-chart helpers above.
      const trendCell = document.createElement("td");
      trendCell.className = "trend-column provider-trend-cell";
      trendCell.dataset.provider = price.site;
      providerTrends.renderProviderTrend(trendCell, providerTrends.getTrend(price.site));
      row.append(trendCell);

      const feeCells = [];
      for (const side of ["buy", "sell"]) {
        const priceCell = document.createElement("td");
        const quote = document.createElement("span");
        quote.className = "quote-line number";
        const quoteCacheKey = `table:${price.site}:${side}:quote`;
        const quoteKey = `${price.site}:${side}`;
        if (usableQuote) decisionSummaryController.renderOdometerValue(quote, quoteCacheKey, formatToman(price[side]), price[side], !price.stale && changedQuoteKeys.has(quoteKey));
        else {
          quote.textContent = "—";
          decisionSummaryController.forgetOdometerValue(quoteCacheKey);
        }
        const movement = quoteMovements.get(`${price.site}:${side}`);
        const movementAge = movement?.changedAt ? Date.now() - movement.changedAt : movementDisplayMs;
        const movementVisible = movement?.direction && movementAge < movementDisplayMs;
        if (movementVisible) quote.classList.add(`quote-${movement.direction}`);
        priceCell.append(quote);
        if (movementVisible) {
          const movementIndicator = document.createElement("span");
          movementIndicator.className = `movement-indicator movement-${movement.direction}`;
          movementIndicator.style.animationDelay = `-${movementAge}ms`;
          const arrow = movement.direction === "up" ? "↑" : "↓";
          const percent = movementPercentFormat.format(Math.abs(movement.changePercent));
          movementIndicator.textContent = `${arrow} ${percent}٪`;
          const sideLabel = side === "buy" ? "خرید" : "فروش";
          const directionLabel = movement.direction === "up" ? "افزایش" : "کاهش";
          movementIndicator.title = `قیمت ${sideLabel} ${percent}٪ ${directionLabel} یافت`;
          movementIndicator.setAttribute("aria-label", movementIndicator.title);
          priceCell.append(movementIndicator);
        }
        const effectiveValue = usableQuote && feeKnown(price, side) ? effectiveTotal(price, side, grams) : null;
        const effectiveText = document.createElement("span");
        const feeSide = side === "buy" ? "buy" : "sell";
        const effectiveCacheKey = `table:${price.site}:${side}:effective`;
        if (effectiveValue != null) {
          effectiveText.className = "effective-line effective-price number";
          decisionSummaryController.renderOdometerValue(effectiveText, effectiveCacheKey, formatToman(effectiveValue), effectiveValue, !price.stale && changedQuoteKeys.has(quoteKey));
          if (marketEligible(price) && (side === "buy" ? effectiveValue === bestBuy : effectiveValue === bestSell)) {
            priceCell.classList.add("best-effective");
          }
        } else {
          effectiveText.className = "effective-line";
          effectiveText.textContent = usableQuote ? "مبلغ نهایی: نامشخص" : "در انتظار نرخ";
          decisionSummaryController.forgetOdometerValue(effectiveCacheKey);
        }
        priceCell.append(effectiveText);
        row.append(priceCell);

        const feeCell = document.createElement("td");
        feeCell.className = "fee-column";
        if (usableQuote) {
          feeCell.append(feeBadge(price, feeSide, grams));
          const detail = feeRateDetail(price, feeSide);
          if (detail) {
            const feeDetail = document.createElement("span");
            feeDetail.className = "fee-detail";
            feeDetail.textContent = detail;
            feeCell.append(feeDetail);
          }
        }
        else {
          const unknown = document.createElement("span");
          unknown.className = "fee-badge fee-unknown";
          unknown.textContent = "نامشخص";
          feeCell.append(unknown);
          const feeDetail = document.createElement("span");
          feeDetail.className = "fee-detail";
          feeDetail.textContent = "جزئیات کارمزد نامشخص";
          feeCell.append(feeDetail);
        }
        feeCells.push(feeCell);
      }
      row.append(...feeCells);

      const spreadCell = document.createElement("td");
      spreadCell.className = "spread-column";
      const spread = usableQuote && !price.stale ? effectiveSpread(price, grams) : null;
      if (spread == null) {
        spreadCell.textContent = "—";
        spreadCell.classList.add("text-muted");
      } else {
        spreadCell.classList.add("number", spread < 0 ? "spread-negative" : "spread-positive");
        spreadCell.textContent = formatToman(spread);
      }
      row.append(spreadCell);

      return row;
    });
    const primaryRows = [], deferredRows = [];
    rowNodes.forEach((row) => (row.classList.contains("stale-row") || row.classList.contains("pending-row") ? deferredRows : primaryRows).push(row));
    const wasOpen = document.getElementById("provider-exceptions-disclosure")?.open ?? false;
    const staleCount = prices.filter((price) => price.available && price.stale).length;
    const pendingCount = prices.filter((price) => !price.available).length;
    let disclosureRow = null;
    if (deferredRows.length) {
      disclosureRow = document.createElement("tr");
      disclosureRow.className = "provider-exceptions-summary-row";
      const disclosureCell = document.createElement("td");
      disclosureCell.colSpan = 7;
      const disclosure = document.createElement("details");
      disclosure.id = "provider-exceptions-disclosure";
      disclosure.className = "provider-exceptions-disclosure";
      disclosure.open = wasOpen;
      const summary = document.createElement("summary");
      summary.textContent = `قدیمی: ${numberFormat.format(staleCount)} · بدون نرخ: ${numberFormat.format(pendingCount)}`;
      disclosure.append(summary);
      disclosureCell.append(disclosure);
      disclosureRow.append(disclosureCell);
      const setDeferredVisibility = () => deferredRows.forEach((row) => {
        row.hidden = !disclosure.open;
        row.style.display = disclosure.open ? "" : "none";
      });
      disclosure.ontoggle = setDeferredVisibility;
      setDeferredVisibility();
    }
    body.replaceChildren(...primaryRows, ...(disclosureRow ? [disclosureRow, ...deferredRows] : []));
    // PROVIDER MINI-CHARTS HOOK: remove with the mini-chart feature.
    providerTrends.scheduleProviderTrends(prices);
  }
  document.querySelectorAll("button[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => chooseSort(button.dataset.sortKey));
  });

  document.getElementById("fee-columns-toggle").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const table = document.getElementById("comparison-table");
    const showFees = table.classList.contains("fees-hidden");
    table.classList.toggle("fees-hidden", !showFees);
    button.setAttribute("aria-expanded", String(showFees));
    button.textContent = showFees ? "پنهان‌کردن کارمزدها" : "نمایش کارمزدها";
  });
  document.querySelectorAll("[data-comparison-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.comparisonView;
      document.querySelectorAll("[data-comparison-view]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      const isTable = view === "table";
      document.getElementById("comparison-table").hidden = !isTable;
      document.getElementById("price-landscape").hidden = view !== "landscape";
      document.getElementById("provider-heatmap").hidden = view !== "heatmap";
      document.querySelector(".table-scroll-hint").hidden = !isTable;
      document.getElementById("fee-columns-toggle").hidden = !isTable;
      const scroll = document.querySelector(".table-scroll");
      scroll.setAttribute("aria-label", isTable ? "جدول قابل پیمایش افقی" : view === "landscape" ? "نمای بصری مقایسه قیمت ارائه‌دهندگان" : "نقشه حرارتی مقایسه ارائه‌دهندگان");
      scroll.tabIndex = isTable ? 0 : -1;
    });
  });

  const providerHeatmap = createProviderHeatmap({
    sortValue, compareNumeric, formatToman, numberFormat, displayProviderName,
    createProviderIcon: decisionSummaryController.createProviderIcon,
    applySpotlight: priceLandscape.applySpotlight,
    togglePin: priceLandscape.togglePin,
    onHover: priceLandscape.setHoveredProvider,
    onFocus: priceLandscape.setFocusedProvider,
    onMetricChange: onRefresh,
  });

  return { render: renderComparisonTable };
}
