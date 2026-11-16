// Dashboard composition root: wires data refresh, feature controllers, and page interactions.
import { numberFormat, decimalNumberFormat, movementPercentFormat, feeFor, feeKnown, effectiveTotal, formatToman } from "./formatting.js";
import { providerTradeLinks, displayProviderName, displayQuoteSource } from "./provider-data.js";
import { createChartController } from "./chart-widget.js";
import { createProviderTrends } from "./provider-trends.js";
import { createDecisionSummary } from "./decision-summary.js";
import { createComparisonView } from "./comparison-view.js";

// State shared by the price table and live quote refresh.
const quoteMovements = new Map();


    const marketEligible = (price) => price.available && !price.stale && !price.unchanged;
    // The summary and comparison view share this market rule and odometer/icon state.
    const decisionSummaryController = createDecisionSummary({
      numberFormat, decimalNumberFormat, feeKnown, effectiveTotal, formatToman,
      providerTradeLinks, displayProviderName, marketEligible,
    });

    const chartController = createChartController({ numberFormat, decimalNumberFormat, displayProviderName });
    const { updateChartSites, syncChartSymbol, initializeChart, isChartInitialized, marketMedianSite } = chartController;
    const providerTrends = createProviderTrends({ numberFormat, decimalNumberFormat, displayProviderName, formatToman });
    const comparisonView = createComparisonView({
      numberFormat, decimalNumberFormat, movementPercentFormat,
      feeFor, feeKnown, effectiveTotal, formatToman,
      providerTradeLinks, displayProviderName, displayQuoteSource,
      marketEligible, quoteMovements, decisionSummaryController, providerTrends,
      onRefresh: refreshPrices,
      onOpenProviderChart: openProviderChart,
    });

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
        decisionSummaryController.render(prices, grams, changedBuyQuoteSites);
        comparisonView.render(prices, grams, changedQuoteKeys);
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
    // /\ Reveal the TradingView tab before scrolling, then account for the sticky analytics toolbar.
    function openProviderChart(site) {
      const select = document.getElementById("chart-site");
      select.value = site;
      syncChartSymbol();
      showTradingViewChart();
    }
    async function showTradingViewChart() {
      activateMarketTab("chart");
      const chart = document.getElementById("candle-chart");
      const panel = document.getElementById("chart-panel");
      // Tab activation animates the panel with a transform. Scrolling during that animation
      // uses a transient position, so wait for it to finish and for layout to settle first.
      await Promise.allSettled(panel.getAnimations().map((animation) => animation.finished));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (panel.hidden || chart.getClientRects().length === 0) return;
      chart.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
        inline: "nearest",
      });
    }
    // /\ A provider's chart action selects it in the existing chart and takes the user to that chart.
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
      if (wasSelected && (view !== "chart" || isChartInitialized())) return;
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
      showTradingViewChart();
    });
