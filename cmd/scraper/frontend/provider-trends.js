export function createProviderTrends({ numberFormat, decimalNumberFormat, displayProviderName, formatToman }) {
    // PROVIDER MINI-CHARTS STATE: remove these declarations to roll the feature back.
    const providerTrendCache = new Map();
    const providerTrendQueue = [];
    const providerTrendInFlight = new Set();
    let activeTrendRequests = 0;
    const providerTrendRefreshMs = 5 * 60 * 1000;
    let providerTrendSide = "buy";
    let providerTrendPeriod = "24h";
    let providerTrendPrices = [];
    let providerTrendScheduleTimer = 0;
    let expandedProviderTrend = "";
    const providerTrendDateFormat = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    function selectedProviderTrendGrams() {
      return Math.min(10000, Math.max(0.001, Number(document.getElementById("grams").value) || 1));
    }

    function providerTrendCacheKey(site, grams = selectedProviderTrendGrams(), period = providerTrendPeriod) {
      return `${site}:${grams}:${period}`;
    }

    function providerTrendKey(site, grams = selectedProviderTrendGrams(), side = providerTrendSide) {
      return `${providerTrendCacheKey(site, grams)}:${side}`;
    }

    function renderProviderTrend(cell, trend) {
      if (!trend?.points?.length) {
        cell.replaceChildren();
        const empty = document.createElement("span");
        empty.className = "provider-trend-empty";
        empty.textContent = trend ? "بدون داده" : "—";
        cell.append(empty);
        cell.classList.remove("trend-favorable", "trend-unfavorable", "trend-flat");
        return;
      }

      const values = trend.points.map((point) => point.value);
      const low = Math.min(...values), high = Math.max(...values);
      const spread = high - low || Math.max(Math.abs(high) * .001, 1);
      const pathData = values.map((value, index) => {
        const x = values.length === 1 ? 56 : 3 + (index / (values.length - 1)) * 106;
        const y = 25 - ((value - low) / spread) * 20;
        return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ");
      const favorable = providerTrendSide === "buy" ? trend.change < 0 : trend.change > 0;
      const direction = trend.change === 0 ? "flat" : favorable ? "favorable" : "unfavorable";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 112 30");
      svg.setAttribute("class", "provider-trend-chart");
      svg.setAttribute("role", "img");
      const sideLabel = providerTrendSide === "buy" ? "خرید" : "فروش";
      const consequence = trend.change === 0
        ? "بدون تغییر"
        : favorable
          ? (providerTrendSide === "buy" ? "بهتر برای خریدار" : "بهتر برای فروشنده")
          : (providerTrendSide === "buy" ? "هزینه بیشتر برای خریدار" : "دریافتی کمتر برای فروشنده");
      const periodLabel = providerTrendPeriod === "1h" ? "یک ساعت" : "۲۴ ساعت";
      svg.setAttribute("aria-label", `روند قیمت ${sideLabel} در ${periodLabel}: ${decimalNumberFormat.format(trend.change)} درصد؛ ${consequence}`);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      path.setAttribute("class", "provider-trend-line");
      const end = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      end.setAttribute("cx", values.length === 1 ? "56" : "109");
      end.setAttribute("cy", (25 - ((values.at(-1) - low) / spread) * 20).toFixed(1));
      end.setAttribute("r", "2.5");
      end.setAttribute("class", "provider-trend-end");
      svg.append(path, end);
      const change = document.createElement("span");
      change.className = "provider-trend-change";
      change.textContent = `${trend.change > 0 ? "+" : ""}${decimalNumberFormat.format(trend.change)}٪`;
      const key = providerTrendKey(cell.dataset.provider);
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "provider-trend-trigger";
      trigger.setAttribute("aria-expanded", String(expandedProviderTrend === key));
      trigger.setAttribute("aria-label", `نمایش قیمت آغاز و پایان روند ${sideLabel} ${displayProviderName(cell.dataset.provider)}`);
      trigger.append(svg, change);
      const detail = document.createElement("div");
      detail.className = "provider-trend-detail";
      detail.hidden = expandedProviderTrend !== key;
      for (const [label, point] of [["شروع", trend.points[0]], ["پایان", trend.points.at(-1)]]) {
        const item = document.createElement("span");
        item.textContent = `${label} · ${providerTrendDateFormat.format(new Date(point.time))} · ${formatToman(point.value)}`;
        detail.append(item);
      }
      trigger.addEventListener("click", () => {
        expandedProviderTrend = expandedProviderTrend === key ? "" : key;
        updateProviderTrendCells();
      });
      cell.replaceChildren(trigger, detail);
      cell.classList.remove("trend-favorable", "trend-unfavorable", "trend-flat");
      cell.classList.add(`trend-${direction}`);
    }

    function updateProviderTrendCells() {
      for (const cell of document.querySelectorAll(".provider-trend-cell")) {
        const key = providerTrendCacheKey(cell.dataset.provider);
        renderProviderTrend(cell, providerTrendCache.get(key)?.[providerTrendSide]);
      }
    }

    function pumpProviderTrendQueue() {
      while (activeTrendRequests < 3 && providerTrendQueue.length) {
        const { site, grams, period, key } = providerTrendQueue.shift();
        activeTrendRequests += 1;
        const isHourly = period === "1h";
        const params = new URLSearchParams({ site, interval: isHourly ? "5m" : "1h", limit: isHourly ? "12" : "24", grams: String(grams), from: new Date(Date.now() - (isHourly ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000)).toISOString() });
        fetch(`/api/candles?${params}`)
          .then((response) => {
            if (!response.ok) throw new Error("Could not load provider trend");
            return response.json();
          })
          .then((candles) => {
            const pointsFor = (side) => Array.isArray(candles)
              ? candles.map((candle) => ({ time: Date.parse(candle.timestamp), value: Number(candle[side]?.close) })).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value) && point.value > 0)
              : [];
            const makeTrend = (points) => ({
              points,
              change: points.length > 1 ? ((points.at(-1).value - points[0].value) / points[0].value) * 100 : 0,
            });
            providerTrendCache.set(key, {
              buy: makeTrend(pointsFor("buy")),
              sell: makeTrend(pointsFor("sell")),
              fetchedAt: Date.now(),
              retryAfter: candles?.length ? 0 : Date.now() + providerTrendRefreshMs,
            });
            updateProviderTrendCells();
          })
          .catch(() => {
            const previous = providerTrendCache.get(key) || {};
            providerTrendCache.set(key, { ...previous, retryAfter: Date.now() + 60_000 });
            updateProviderTrendCells();
          })
          .finally(() => {
            providerTrendInFlight.delete(key);
            activeTrendRequests -= 1;
            pumpProviderTrendQueue();
          });
      }
    }

    function scheduleProviderTrends(prices) {
      providerTrendPrices = prices;
      window.clearTimeout(providerTrendScheduleTimer);
      providerTrendScheduleTimer = window.setTimeout(() => {
        const grams = selectedProviderTrendGrams(), now = Date.now();
        // Drop queued requests for an order size that the user has already replaced.
        const retainedRequests = providerTrendQueue.filter((request) => request.grams === grams && request.period === providerTrendPeriod);
        for (const request of providerTrendQueue) {
          if (request.grams !== grams || request.period !== providerTrendPeriod) providerTrendInFlight.delete(request.key);
        }
        providerTrendQueue.splice(0, providerTrendQueue.length, ...retainedRequests);
        for (const { site } of prices) {
          if (!site) continue;
          const key = providerTrendCacheKey(site, grams);
          const cached = providerTrendCache.get(key);
          if (providerTrendInFlight.has(key) || (cached && (now - cached.fetchedAt < providerTrendRefreshMs || now < cached.retryAfter))) continue;
          providerTrendInFlight.add(key);
          providerTrendQueue.push({ site, grams, period: providerTrendPeriod, key });
        }
        pumpProviderTrendQueue();
      }, 700);
    }
    return {
      scheduleProviderTrends,
      renderProviderTrend,
      getTrend(site) { return providerTrendCache.get(providerTrendCacheKey(site))?.[providerTrendSide]; },
      setSide(side) { providerTrendSide = side; updateProviderTrendCells(); },
      setPeriod(period) {
        providerTrendPeriod = period;
        expandedProviderTrend = "";
        updateProviderTrendCells();
        scheduleProviderTrends(providerTrendPrices);
      },
    };
}
