import { numberFormat, decimalNumberFormat, movementPercentFormat, feeFor, feeKnown, effectiveTotal, formatToman } from "./formatting.js";
import { providerTradeLinks, displayProviderName, displayQuoteSource } from "./provider-data.js";
import { createChartController } from "./chart-widget.js";
import { createProviderTrends } from "./provider-trends.js";

// State shared by the price table and live quote refresh.
const quoteMovements = new Map();
const odometerDisplayValues = new Map();
const sortState = { key: "buyPrice", direction: "asc" };


    const movementDisplayMs = 5000;
    // Avoid repeating requests to providers whose favicon endpoint has already failed.
    const failedFaviconOrigins = new Set();
    function createDecisionProviderIcon(site) {
      const tradeURL = providerTradeLinks[site];
      if (!tradeURL) return null;
      const faviconURL = new URL("/favicon.ico", tradeURL);
      const fallbackFaviconURL = new URL("https://www.google.com/s2/favicons/");
      fallbackFaviconURL.searchParams.set("domain", new URL(tradeURL).hostname);
      fallbackFaviconURL.searchParams.set("sz", "64");
      let fallbackTried = failedFaviconOrigins.has(faviconURL.origin);
      const favicon = document.createElement("img");
      favicon.className = "decision-provider-icon";
      favicon.src = fallbackTried ? fallbackFaviconURL.href : faviconURL.href;
      favicon.alt = "";
      favicon.setAttribute("aria-hidden", "true");
      favicon.loading = "lazy";
      favicon.addEventListener("error", () => {
        if (!fallbackTried) {
          failedFaviconOrigins.add(faviconURL.origin);
          fallbackTried = true;
          favicon.src = fallbackFaviconURL.href;
          return;
        }
        favicon.remove();
      });
      return favicon;
    }
    function renderOdometerValue(element, cacheKey, text, numericValue, animate) {
      const previous = odometerDisplayValues.get(cacheKey);
      odometerDisplayValues.set(cacheKey, { text, numericValue });
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!animate || !previous || previous.text === text || !Number.isFinite(previous.numericValue) || reducedMotion) {
        element.textContent = text;
        return;
      }

      const numericEnd = (value) => {
        const match = value.match(/^[\u06f0-\u06f9\u0660-\u0669\u066b\u066c,٬٫.]+/);
        return match ? match[0].length : 0;
      };
      const oldNumber = Array.from(previous.text).slice(0, numericEnd(previous.text));
      const newCharacters = Array.from(text);
      const newNumberLength = numericEnd(text);
      const newNumber = newCharacters.slice(0, newNumberLength);
      const newUnit = newCharacters.slice(newNumberLength).join("");
      const oldDigits = oldNumber.filter((character) => /[\u06f0-\u06f9\u0660-\u0669]/.test(character));
      const newDigits = newNumber.filter((character) => /[\u06f0-\u06f9\u0660-\u0669]/.test(character));
      const rollingDirection = numericValue > previous.numericValue ? "up" : "down";
      let digitIndex = 0;
      let rollingCount = 0;
      const visual = document.createElement("span");
      visual.className = "odometer-visual";
      visual.setAttribute("aria-hidden", "true");

      const numberVisual = document.createElement("span");
      numberVisual.className = "odometer-number";
      numberVisual.setAttribute("dir", "ltr");
      for (const character of newNumber) {
        if (!/[\u06f0-\u06f9\u0660-\u0669]/.test(character)) {
          numberVisual.append(document.createTextNode(character));
          continue;
        }
        const placeFromRight = newDigits.length - digitIndex - 1;
        const oldDigit = oldDigits[oldDigits.length - placeFromRight - 1];
        digitIndex += 1;
        if (oldDigit === character) {
          numberVisual.append(document.createTextNode(character));
          continue;
        }

        const roller = document.createElement("span");
        roller.className = `odometer-digit odometer-roll-${rollingDirection}`;
        const current = document.createElement("span");
        current.className = "odometer-current";
        current.textContent = oldDigit ?? "۰";
        const next = document.createElement("span");
        next.className = "odometer-next";
        next.textContent = character;
        roller.append(current, next);
        numberVisual.append(roller);
        rollingCount += 1;
      }
      visual.append(numberVisual);
      if (newUnit) {
        const unit = document.createElement("span");
        unit.className = "odometer-unit";
        unit.setAttribute("dir", "rtl");
        unit.textContent = newUnit;
        visual.append(unit);
      }

      const accessibleText = document.createElement("span");
      accessibleText.className = "sr-only";
      accessibleText.textContent = text;
      element.replaceChildren(visual, accessibleText);
      if (rollingCount) {
        void visual.offsetWidth;
        requestAnimationFrame(() => {
          for (const roller of visual.querySelectorAll(".odometer-digit")) roller.classList.add("is-rolling");
        });
      }
    }

    // /\\ Rank only current providers whose fee information lets us make a fair total-cost comparison.
    function renderDecisionSummary(prices, grams, changedBuyQuoteSites = new Set()) {
      for (const side of ["buy", "sell"]) {
        const heading = document.getElementById(`best-${side}-heading`);
        const provider = document.getElementById(`best-${side}-provider`);
        const amount = document.getElementById(`best-${side}-amount`);
        const detail = document.getElementById(`best-${side}-detail`);
        const candidates = prices.filter((price) => price.available && !price.stale && price[side] > 0 && feeKnown(price, side));
        candidates.sort((a, b) => side === "buy"
          ? effectiveTotal(a, side, grams) - effectiveTotal(b, side, grams)
          : effectiveTotal(b, side, grams) - effectiveTotal(a, side, grams));
        if (!candidates.length) {
          heading.textContent = side === "buy" ? "کمترین هزینه خرید" : "بیشترین دریافتی فروش";
          provider.textContent = "در انتظار نرخ معتبر با کارمزد مشخص";
          amount.textContent = "—";
          if (side === "buy") odometerDisplayValues.delete("summary:buy");
          detail.textContent = "نرخ‌های قدیمی یا کارمزدهای نامشخص رتبه‌بندی نمی‌شوند.";
          continue;
        }
        const winner = candidates[0];
        const winnerAmount = Math.round(effectiveTotal(winner, side, grams));
        const tied = candidates.filter((price) => Math.round(effectiveTotal(price, side, grams)) === winnerAmount);
        heading.textContent = tied.length > 1 ? "بهترین قیمت مشترک" : side === "buy" ? "کمترین هزینه خرید" : "بیشترین دریافتی فروش";
        const providerNames = tied.slice(0, 2).map((price) => displayProviderName(price.site));
        const name = tied.length > 1
          ? providerNames.join(" و ") + (tied.length > 2 ? ` و ${numberFormat.format(tied.length - 2)} پلتفرم دیگر` : "")
          : displayProviderName(winner.site);
        provider.replaceChildren();
        for (const tiedProvider of tied.slice(0, 2)) {
          const icon = createDecisionProviderIcon(tiedProvider.site);
          if (icon) provider.append(icon);
        }
        const providerName = document.createElement("span");
        providerName.className = "decision-provider-name";
        providerName.textContent = name;
        provider.append(providerName);
        const formattedAmount = formatToman(winnerAmount);
        if (side === "buy") renderOdometerValue(amount, "summary:buy", formattedAmount, winnerAmount, changedBuyQuoteSites.has(winner.site));
        else amount.textContent = formattedAmount;
        detail.textContent = `برای ${decimalNumberFormat.format(grams)} گرم، ${side === "buy" ? "با احتساب" : "پس از کسر"} کارمزد`;
      }

      // /\\ Compare the cheapest known-fee purchase with the highest known-fee sale as a current estimate.
      const buyCandidates = prices.filter((price) => price.available && !price.stale && price.buy > 0 && feeKnown(price, "buy"));
      const sellCandidates = prices.filter((price) => price.available && !price.stale && price.sell > 0 && feeKnown(price, "sell"));
      buyCandidates.sort((a, b) => effectiveTotal(a, "buy", grams) - effectiveTotal(b, "buy", grams));
      sellCandidates.sort((a, b) => effectiveTotal(b, "sell", grams) - effectiveTotal(a, "sell", grams));
      const heading = document.getElementById("opportunity-heading");
      const route = document.getElementById("opportunity-route");
      const amount = document.getElementById("opportunity-amount");
      const detail = document.getElementById("opportunity-detail");
      amount.classList.remove("opportunity-positive", "opportunity-negative");
      if (!buyCandidates.length || !sellCandidates.length) {
        heading.textContent = "اختلاف احتمالی";
        route.textContent = "در انتظار نرخ معتبر با کارمزد مشخص";
        amount.textContent = "—";
        detail.textContent = "برای محاسبه، نرخ خرید و فروش تازه با کارمزد مشخص لازم است.";
      } else {
        const buyProvider = buyCandidates[0];
        const sellProvider = sellCandidates[0];
        const estimatedDifference = effectiveTotal(sellProvider, "sell", grams) - effectiveTotal(buyProvider, "buy", grams);
        const roundedDifference = Math.round(estimatedDifference);
        route.textContent = `خرید از ${displayProviderName(buyProvider.site)} · فروش به ${displayProviderName(sellProvider.site)}`;
        if (roundedDifference > 0) {
          heading.textContent = "سود احتمالی";
          amount.classList.add("opportunity-positive");
          amount.textContent = formatToman(roundedDifference);
        } else if (roundedDifference < 0) {
          heading.textContent = "زیان احتمالی";
          amount.classList.add("opportunity-negative");
          const signedValue = document.createElement("bdi");
          signedValue.dir = "ltr";
          signedValue.textContent = `− ${numberFormat.format(Math.abs(roundedDifference))}`;
          amount.replaceChildren(signedValue, document.createTextNode(" تومان"));
        } else {
          heading.textContent = "اختلاف خالص";
          amount.textContent = formatToman(0);
        }
        detail.textContent = `برآورد ${decimalNumberFormat.format(grams)} گرم پس از کارمزدهای شناخته‌شده؛ بدون هزینه انتقال و محدودیت سفارش`;
      }
    }

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
        case "buyPrice": return price.available && !price.stale && feeKnown(price, "buy") ? effectiveTotal(price, "buy", grams) : null;
        case "buyFee": return actualFeeAmount(price, "buy", grams);
        case "sellPrice": return price.available && !price.stale && feeKnown(price, "sell") ? effectiveTotal(price, "sell", grams) : null;
        case "sellFee": return actualFeeAmount(price, "sell", grams);
        case "spread": return price.available && !price.stale ? effectiveSpread(price, grams) : null;
        default: return null;
      }
    }

    // /\\ Keep the alternate landscape tied to the same fee-adjusted offer values used by the table's best-offer ranking.
    let pinnedLandscapeProvider = "";
    let hoveredLandscapeProvider = "";
    let focusedLandscapeProvider = "";
    function applyLandscapeSpotlight() {
      const landscape = document.getElementById("price-landscape");
      const activeProvider = pinnedLandscapeProvider || focusedLandscapeProvider || hoveredLandscapeProvider;
      landscape.classList.toggle("has-spotlight", Boolean(activeProvider));
      for (const row of landscape.querySelectorAll(".landscape-provider")) {
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
        if (!price.available || price.stale || price.buy <= 0 || price.sell <= 0) continue;
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

          const effective = validQuote && !price.stale && feeKnown(price, side) ? effectiveTotal(price, side, grams) : null;
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

    // /\ Update visible chevrons and screen-reader sort state along with the active numeric sort.
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
      refreshPrices();
    }

    // /\ Build one row with quoted prices, separate fee estimates, fee-adjusted prices, and provider actions.
    function renderComparisonTable(prices, grams, changedQuoteKeys = new Set()) {
      const usable = prices.filter((price) => price.available && !price.stale && price.buy > 0 && price.sell > 0);
      const bestBuy = Math.min(...usable.filter((price) => feeKnown(price, "buy")).map((price) => effectiveTotal(price, "buy", grams)));
      const bestSell = Math.max(...usable.filter((price) => feeKnown(price, "sell")).map((price) => effectiveTotal(price, "sell", grams)));
      const rows = [...prices].sort((a, b) => {
        const statusOrder = Number(!a.available || a.stale) - Number(!b.available || b.stale);
        if (statusOrder) return statusOrder;
        const comparison = compareNumeric(sortValue(a, sortState.key, grams), sortValue(b, sortState.key, grams), sortState.direction);
        return comparison || displayProviderName(a.site).localeCompare(displayProviderName(b.site), "fa");
      });
      renderPriceLandscape(rows, grams, bestBuy, bestSell, changedQuoteKeys);
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
          const useFallbackImmediately = failedFaviconOrigins.has(faviconURL.origin);
          let fallbackTried = useFallbackImmediately;
          const favicon = document.createElement("img");
          favicon.className = "provider-logo";
          favicon.src = useFallbackImmediately ? fallbackFaviconURL.href : faviconURL.href;
          favicon.alt = "";
          favicon.setAttribute("aria-hidden", "true");
          favicon.loading = "lazy";
          favicon.addEventListener("error", () => {
            if (!fallbackTried) {
              failedFaviconOrigins.add(faviconURL.origin);
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
          if (usableQuote) renderOdometerValue(quote, quoteCacheKey, formatToman(price[side]), price[side], !price.stale && changedQuoteKeys.has(quoteKey));
          else {
            quote.textContent = "—";
            odometerDisplayValues.delete(quoteCacheKey);
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
            renderOdometerValue(effectiveText, effectiveCacheKey, formatToman(effectiveValue), effectiveValue, !price.stale && changedQuoteKeys.has(quoteKey));
            if (!price.stale && (side === "buy" ? effectiveValue === bestBuy : effectiveValue === bestSell)) {
              priceCell.classList.add("best-effective");
            }
          } else {
            effectiveText.className = "effective-line";
            effectiveText.textContent = usableQuote ? "مبلغ نهایی: نامشخص" : "در انتظار نرخ";
            odometerDisplayValues.delete(effectiveCacheKey);
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

    const chartController = createChartController({ numberFormat, decimalNumberFormat, displayProviderName });
    const { updateChartSites, syncChartSymbol, marketMedianSite } = chartController;
    const providerTrends = createProviderTrends({ numberFormat, decimalNumberFormat, displayProviderName, formatToman });

    let lastFreshObservationSignature = "";
    let heartbeatExpiryTimer = 0;
    const marketFreshnessThresholdMs = 90 * 1000; // Matches the existing server staleAfter threshold.
    async function refreshPrices() {
      const status = document.getElementById("status");
      const statusMessage = document.getElementById("status-message");
      const statusCheck = document.getElementById("status-check");
      const statusTime = document.getElementById("status-time");
      try {
        const response = await fetch("/api/prices");
        if (!response.ok) throw new Error("پاسخ سرور ناموفق بود.");
        const prices = await response.json();
        const checkedAt = new Date();
        const freshPrices = prices.filter((price) => price.available && !price.stale && (price.buy > 0 || price.sell > 0));
        status.dataset.feedState = freshPrices.length ? "healthy" : "stale";
        window.clearTimeout(heartbeatExpiryTimer);
        if (freshPrices.length) {
          const freshestAgeSeconds = Math.min(...freshPrices.map((price) => Math.max(0, Number(price.ageSeconds) || 0)));
          const untilStaleMs = Math.max(1, marketFreshnessThresholdMs - freshestAgeSeconds * 1000 + 1);
          heartbeatExpiryTimer = window.setTimeout(() => {
            status.dataset.feedState = "stale";
            status.classList.remove("heartbeat-update");
          }, untilStaleMs);
        }
        const observationSignature = freshPrices
          .map((price) => `${price.site}:${price.fetchedAt}:${price.buy}:${price.sell}`)
          .sort()
          .join("|");
        if (observationSignature && observationSignature !== lastFreshObservationSignature) {
          lastFreshObservationSignature = observationSignature;
          status.classList.remove("heartbeat-update");
          void status.offsetWidth;
          status.classList.add("heartbeat-update");
        } else if (!freshPrices.length) {
          status.classList.remove("heartbeat-update");
        }
        // /\ Compare each fresh quote with its previous reading and remember its latest direction.
        const changedBuyQuoteSites = new Set();
        const changedQuoteKeys = new Set();
        for (const price of prices) {
          for (const side of ["buy", "sell"]) {
            if (!price.available || price[side] <= 0) continue;
            const key = `${price.site}:${side}`;
            const previous = quoteMovements.get(key);
            if (!previous) {
              quoteMovements.set(key, { value: price[side], direction: "", changedAt: 0 });
            } else if (price[side] !== previous.value) {
              changedQuoteKeys.add(key);
              if (side === "buy") changedBuyQuoteSites.add(price.site);
              quoteMovements.set(key, {
                value: price[side],
                direction: price[side] > previous.value ? "up" : "down",
                changePercent: ((price[side] - previous.value) / previous.value) * 100,
                changedAt: Date.now(),
              });
            }
          }
        }
        updateChartSites(prices);
        const grams = Math.min(10000, Math.max(0.001, Number(document.getElementById("grams").value) || 1));
        window.dispatchEvent(new CustomEvent("gold-prices-updated", { detail: { prices, grams } }));
        renderDecisionSummary(prices, grams, changedBuyQuoteSites);
        renderComparisonTable(prices, grams, changedQuoteKeys);
        statusMessage.hidden = true;
        statusCheck.hidden = false;
        statusTime.dateTime = checkedAt.toISOString();
        statusTime.textContent = new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(checkedAt);
      } catch (error) {
        window.clearTimeout(heartbeatExpiryTimer);
        status.dataset.feedState = "error";
        status.classList.remove("heartbeat-update");
        statusCheck.hidden = true;
        statusMessage.hidden = false;
        statusMessage.textContent = "دریافت قیمت‌ها ناموفق بود؛ اتصال سرور را بررسی کنید.";
      }
    }

    const decisionSummary = document.querySelector(".decision-summary");
    const summaryLights = [...(decisionSummary?.querySelectorAll(".summary-cursor-light") || [])];
    const reduceSummaryLightMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (decisionSummary && summaryLights.length) {
      let pointerX = 0;
      let pointerY = 0;
      let lightX = 0;
      let lightY = 0;
      let lightFrame = 0;
      let hasPointerPosition = false;
      const updateSummaryLightPositions = () => {
        for (const light of summaryLights) {
          const cardBounds = light.parentElement.getBoundingClientRect();
          const x = Math.max(-120, Math.min(220, ((lightX - cardBounds.left) / cardBounds.width) * 100));
          const y = Math.max(-120, Math.min(220, ((lightY - cardBounds.top) / cardBounds.height) * 100));
          light.style.setProperty("--summary-light-x", `${x}%`);
          light.style.setProperty("--summary-light-y", `${y}%`);
        }
      };
      const moveSummaryLight = () => {
        lightX += (pointerX - lightX) * 0.2;
        lightY += (pointerY - lightY) * 0.2;
        if (Math.abs(pointerX - lightX) < 0.1 && Math.abs(pointerY - lightY) < 0.1) {
          lightX = pointerX;
          lightY = pointerY;
          lightFrame = 0;
        } else {
          lightFrame = requestAnimationFrame(moveSummaryLight);
        }
        updateSummaryLightPositions();
      };
      decisionSummary.addEventListener("pointermove", (event) => {
        if (event.pointerType === "touch") return;
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (!hasPointerPosition) {
          lightX = pointerX;
          lightY = pointerY;
          hasPointerPosition = true;
        }
        summaryLights.forEach((light) => light.classList.add("is-active"));
        if (reduceSummaryLightMotion) {
          lightX = pointerX;
          lightY = pointerY;
          updateSummaryLightPositions();
        } else if (!lightFrame) lightFrame = requestAnimationFrame(moveSummaryLight);
      });
      decisionSummary.addEventListener("pointerleave", () => {
        summaryLights.forEach((light) => light.classList.remove("is-active"));
        hasPointerPosition = false;
      });
    }
    refreshPrices();
    setInterval(refreshPrices, 5000);
    document.getElementById("grams").addEventListener("input", refreshPrices);
    document.getElementById("grams").addEventListener("change", syncChartSymbol);
    // /\\ Keep both fee columns hidden initially and let the reader reveal or hide them together.
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
        const isLandscape = button.dataset.comparisonView === "landscape";
        document.querySelectorAll("[data-comparison-view]").forEach((item) => {
          item.setAttribute("aria-pressed", String(item === button));
        });
        document.getElementById("comparison-table").hidden = isLandscape;
        document.getElementById("price-landscape").hidden = !isLandscape;
        document.querySelector(".table-scroll-hint").hidden = isLandscape;
        document.getElementById("fee-columns-toggle").hidden = isLandscape;
        const scroll = document.querySelector(".table-scroll");
        scroll.setAttribute("aria-label", isLandscape ? "نمای بصری مقایسه قیمت ارائه‌دهندگان" : "جدول قابل پیمایش افقی");
        scroll.tabIndex = isLandscape ? -1 : 0;
      });
    });
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
    // /\ Let keyboard and mouse users sort by the real numeric values behind each displayed price or fee.
    document.querySelectorAll("button[data-sort-key]").forEach((button) => {
      button.addEventListener("click", () => chooseSort(button.dataset.sortKey));
    });
    // /\ A provider's chart action selects it in the existing chart and takes the user to that chart.
    document.getElementById("comparison-rows").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-chart-provider]");
      if (!button) return;
      document.getElementById("chart-site").value = button.dataset.chartProvider;
      activateMarketTab("chart");
      syncChartSymbol();
      document.getElementById("chart-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.querySelectorAll("[data-provider-trend-side]").forEach((button) => {
      button.addEventListener("click", () => {
        const side = button.dataset.providerTrendSide;
        providerTrends.setSide(side);
        document.querySelectorAll("[data-provider-trend-side]").forEach((item) => {
          item.setAttribute("aria-pressed", String(item === button));
        });
        document.getElementById("provider-trend-meaning").textContent = side === "buy"
          ? "سبز: بهتر برای خریدار"
          : "سبز: بهتر برای فروشنده";
      });
    });
    document.querySelectorAll("[data-provider-trend-period]").forEach((button) => {
      button.addEventListener("click", () => {
        const period = button.dataset.providerTrendPeriod;
        providerTrends.setPeriod(period);
        document.querySelectorAll("[data-provider-trend-period]").forEach((item) => {
          item.setAttribute("aria-pressed", String(item === button));
        });
      });
    });
    const marketTabs = [...document.querySelectorAll("[data-market-tab]")];
    const marketTabList = document.querySelector(".analytics-tabs");
    const reducedTabMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    function positionMarketTabIndicator(tab, animate = true) {
      if (!marketTabList || !tab) return;
      if (!animate || reducedTabMotion.matches) marketTabList.classList.add("analytics-tabs-no-motion");
      marketTabList.style.setProperty("--analytics-indicator-x", `${tab.offsetLeft}px`);
      marketTabList.style.setProperty("--analytics-indicator-width", `${tab.offsetWidth}px`);
      if (!animate || reducedTabMotion.matches) requestAnimationFrame(() => marketTabList.classList.remove("analytics-tabs-no-motion"));
    }
    positionMarketTabIndicator(marketTabs.find((tab) => tab.getAttribute("aria-selected") === "true"), false);
    window.addEventListener("resize", () => {
      positionMarketTabIndicator(marketTabs.find((tab) => tab.getAttribute("aria-selected") === "true"), false);
    });
    function activateMarketTab(view) {
      const activeTab = marketTabs.find((tab) => tab.dataset.marketTab === view);
      if (!activeTab) return;
      const wasSelected = activeTab.getAttribute("aria-selected") === "true";
      if (wasSelected && (view !== "chart" || chartInitialized)) return;
      for (const tab of marketTabs) {
        const selected = tab === activeTab;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
      }
      positionMarketTabIndicator(activeTab);
      const panel = document.getElementById(activeTab.getAttribute("aria-controls"));
      if (!reducedTabMotion.matches && panel.animate) {
        const animation = panel.animate(
          [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 230, easing: "cubic-bezier(.2,.72,.2,1)" }
        );
        animation.onfinish = () => animation.cancel();
      }
      if (view === "chart") initializeChart();
    }
    for (const tab of marketTabs) {
      tab.addEventListener("click", () => activateMarketTab(tab.dataset.marketTab));
      tab.addEventListener("keydown", (event) => {
        const direction = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
        if (!direction) return;
        event.preventDefault();
        const next = marketTabs[(marketTabs.indexOf(tab) + direction + marketTabs.length) % marketTabs.length];
        next.focus(); next.click();
      });
    }
    window.addEventListener("gold-open-market-median-chart", (event) => {
      const select = document.getElementById("chart-site");
      if (![...select.options].some((option) => option.value === marketMedianSite)) return;
      select.value = marketMedianSite;
      document.getElementById("chart-side").value = "buy";
      const grams = Number(event.detail?.grams);
      if (Number.isFinite(grams) && grams >= .001 && grams <= 10000) {
        document.getElementById("grams").value = String(grams);
      }
      syncChartSymbol();
      activateMarketTab("chart");
      document.getElementById("chart-panel").scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
