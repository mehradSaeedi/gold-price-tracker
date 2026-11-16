// Fee-aware ranking and its accessible animated summary display.
export function createDecisionSummary({
  numberFormat, decimalNumberFormat, feeKnown, effectiveTotal, formatToman,
  providerTradeLinks, displayProviderName, marketEligible,
}) {
  const odometerDisplayValues = new Map();
  const failedFaviconOrigins = new Set();
  // Avoid repeating requests to providers whose favicon endpoint has already failed.
  function createDecisionProviderIcon(site, className = "decision-provider-icon") {
    const tradeURL = providerTradeLinks[site];
    if (!tradeURL) return null;
    const faviconURL = new URL("/favicon.ico", tradeURL);
    const fallbackFaviconURL = new URL("https://www.google.com/s2/favicons/");
    fallbackFaviconURL.searchParams.set("domain", new URL(tradeURL).hostname);
    fallbackFaviconURL.searchParams.set("sz", "64");
    let fallbackTried = failedFaviconOrigins.has(faviconURL.origin);
    const favicon = document.createElement("img");
    favicon.className = className;
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
      const candidates = prices.filter((price) => marketEligible(price) && price[side] > 0 && feeKnown(price, side));
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
    const buyCandidates = prices.filter((price) => marketEligible(price) && price.buy > 0 && feeKnown(price, "buy"));
    const sellCandidates = prices.filter((price) => marketEligible(price) && price.sell > 0 && feeKnown(price, "sell"));
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
  return {
    render: renderDecisionSummary,
    createProviderIcon: createDecisionProviderIcon,
    renderOdometerValue,
    forgetOdometerValue: (key) => odometerDisplayValues.delete(key),
    hasFailedFaviconOrigin: (origin) => failedFaviconOrigins.has(origin),
    markFailedFaviconOrigin: (origin) => failedFaviconOrigins.add(origin),
  };
}
