/* Isolated market-wide Daily High–Low instrument. */
(() => {
  const root = document.getElementById("daily-range");
  if (!root) return;

  const number = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
  const percentage = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
  const minimumProviders = 3;
  const candleCacheMs = 60_000;
  let latestPrices = [];
  let grams = 1;
  let historicalSitesKey = "";
  let historicalCandles = [];
  let candlesFetchedAt = 0;
  let activeRequestKey = "";
  let requestVersion = 0;
  let latestModel = null;
  let mounted = false;
  let expanded = false;

  const money = value => Number.isFinite(value) ? `${number.format(Math.round(value))} تومان` : "—";
  const motionReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clampedPosition = percent => Math.max(0, Math.min(100, percent ?? 0));
  const markerPosition = percent => percent == null ? "50%" : percent < 0 ? "-6px" : percent > 100 ? "calc(100% + 6px)" : `${percent}%`;
  const markerState = percent => percent == null ? "flat" : percent < 0 ? "below" : percent > 100 ? "above" : "normal";
  const positionLabel = percent => {
    if (percent == null) return "—";
    const value = `${percentage.format(percent)}٪`;
    if (percent < 0) return `${value} · پایین‌تر از کف امروز`;
    if (percent > 100) return `${value} · بالاتر از سقف امروز`;
    return `${value} مسیر امروز`;
  };

  function interpretation(data) {
    if (data.percent == null) return "کف و سقف امروز برابرند";
    if (data.percent < 0) return `پایین‌تر از کف امروز · ${money(Math.abs(data.aboveLow))} پایین‌تر`;
    if (data.percent > 100) return `بالاتر از سقف امروز · ${money(Math.abs(data.belowHigh))} بالاتر`;
    if (data.percent <= 25) return "نزدیک به کف امروز";
    if (data.percent >= 75) return "نزدیک به سقف امروز";
    return "نزدیک به میانه بازه";
  }

  function tehranDay() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function tehranMidnight() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const year = Number(values.year), month = Number(values.month), day = Number(values.day);
    const utcProbe = new Date(Date.UTC(year, month - 1, day, 12));
    const localParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(utcProbe);
    const local = Object.fromEntries(localParts.map(part => [part.type, part.value]));
    const offset = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute), Number(local.second)) - utcProbe.getTime();
    return new Date(Date.UTC(year, month - 1, day) - offset);
  }
  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  function robustMedian(values) {
    const valid = values.filter(Number.isFinite);
    if (valid.length < minimumProviders) return null;
    const center = median(valid), mad = median(valid.map(value => Math.abs(value - center)));
    const filtered = mad === 0
      ? valid.filter(value => value === center)
      : valid.filter(value => Math.abs(value - center) <= 4.5 * 1.4826 * mad);
    return filtered.length < minimumProviders ? null : { value: median(filtered), count: filtered.length };
  }
  function quoteFeeKnown(price) { return Boolean(price.feeIncludedInPrice || price.buyFee); }
  function effectiveBuyPerGram(price) {
    const base = Number(price.buy);
    if (!(base > 0) || !quoteFeeKnown(price)) return null;
    if (price.feeIncludedInPrice) return base;
    const fee = price.buyFee;
    // Match the candles API: apply the known fee per gram and round once to whole Toman.
    return Math.round(base * (1 + Number(fee.rate || 0)) + Number(fee.fixedToman || 0) / grams);
  }

  function setRangeTrack(track, percent) {
    if (!track) return;
    track.dataset.position = markerState(percent);
    track.style.setProperty("--dr-position", markerPosition(percent));
    track.style.setProperty("--dr-fill", `${clampedPosition(percent)}%`);
  }
  function rangeMarkup(data, large = false, showEndpoints = false) {
    const state = markerState(data.percent);
    return `<span class="dr-range${large ? " dr-range-large" : ""}" role="img" aria-label="بازه قیمت امروز از ${money(data.low)} تا ${money(data.high)}؛ قیمت فعلی ${money(data.current)}">
      <span class="dr-range-track" data-position="${state}" style="--dr-position:${markerPosition(data.percent)};--dr-fill:${clampedPosition(data.percent)}%">
        <span class="dr-range-fill"></span><span class="dr-range-marker"><i></i></span><span class="dr-overflow-arrow dr-overflow-below" aria-hidden="true">←</span><span class="dr-overflow-arrow dr-overflow-above" aria-hidden="true">→</span>
      </span>
      ${showEndpoints ? `<span class="dr-endpoints">${endpointMarkup("کف امروز", data.low, "low")}${endpointMarkup("سقف امروز", data.high, "high")}</span>` : ""}
    </span>`;
  }
  function endpointMarkup(label, value, side) {
    return `<span class="dr-endpoint dr-endpoint-${side}"><small>${label}</small><b data-dr="${side}">${money(value)}</b></span>`;
  }
  function cardMarkup(data) {
    return `<section class="dr-card">
      <button class="dr-summary" type="button" aria-controls="dr-details" aria-expanded="false">
        <span class="dr-card-heading"><span><b>بازه قیمت امروز</b><small>طلای ۱۸ عیار</small></span><i class="dr-expand-icon" aria-hidden="true">⌄</i></span>
        <span class="dr-summary-values"><span class="dr-current"><small>قیمت فعلی</small><b data-dr="price">${money(data.current)}</b></span>
          <span class="dr-position"><small>موقعیت قیمت در بازه امروز</small><b data-dr="percent">${positionLabel(data.percent)}</b><em data-dr="interpretation">${interpretation(data)}</em></span></span>
        ${rangeMarkup(data)}
      </button>
      <div class="dr-details" id="dr-details" hidden>${detailsMarkup(data)}</div>
    </section>`;
  }
  function detailsMarkup(data) {
    const belowLow = data.percent != null && data.percent < 0;
    const aboveHigh = data.percent != null && data.percent > 100;
    return `<div class="dr-detail-range">${rangeMarkup(data, true, true)}</div>
      <div class="dr-metrics"><article><span>${belowLow ? "فاصله پایین‌تر از کف امروز" : "فاصله از کف امروز"}</span><b data-metric="above">${money(belowLow ? Math.abs(data.aboveLow) : data.aboveLow)}</b></article>
      <article><span>${aboveHigh ? "فاصله بالاتر از سقف امروز" : "فاصله تا سقف امروز"}</span><b data-metric="below">${money(aboveHigh ? Math.abs(data.belowHigh) : data.belowHigh)}</b></article>
      <article><span>کل بازه قیمت</span><b data-metric="span">${money(data.high - data.low)}</b></article><article><span>پلتفرم‌های مرجع</span><b data-metric="count">${number.format(data.count)}</b></article></div>
      <section class="dr-chart-section"><h3>کندل مرجع بازار <small>میانه قیمت خرید · هر ۱۵ دقیقه</small></h3>${candleChart(data.candles)}</section>`;
  }
  function setText(node, value, highlight = false) {
    if (!node || node.textContent === value) return;
    node.textContent = value;
    if (!motionReduced() && node.animate) {
      node.animate(
        [{ opacity: .55, transform: "translateY(3px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: highlight ? 470 : 320, easing: "cubic-bezier(.2,.72,.22,1)" }
      );
      if (highlight) node.animate(
        [{ color: "#d4c3f3", textShadow: "0 0 12px rgba(105,63,203,.5)" }, { color: "", textShadow: "none" }],
        { duration: 650, easing: "ease-out" }
      );
    }
  }
  function updateLiveView(data) {
    root.hidden = false;
    const previousPrice = latestModel?.current;
    if (!mounted) {
      root.innerHTML = cardMarkup(data);
      root.querySelector(".dr-summary").addEventListener("click", toggleExpanded);
      mounted = true;
    } else {
      const priceChanged = Number.isFinite(previousPrice) && Math.round(previousPrice) !== Math.round(data.current);
      setText(root.querySelector('[data-dr="price"]'), money(data.current), priceChanged);
      setText(root.querySelector('[data-dr="percent"]'), positionLabel(data.percent));
      setText(root.querySelector('[data-dr="interpretation"]'), interpretation(data));
      setText(root.querySelector('[data-dr="low"]'), money(data.low));
      setText(root.querySelector('[data-dr="high"]'), money(data.high));
      setText(root.querySelector('[data-metric="above"]'), money(data.percent != null && data.percent < 0 ? Math.abs(data.aboveLow) : data.aboveLow));
      setText(root.querySelector('[data-metric="below"]'), money(data.percent != null && data.percent > 100 ? Math.abs(data.belowHigh) : data.belowHigh));
      setText(root.querySelector('[data-metric="span"]'), money(data.high - data.low));
      setText(root.querySelector('[data-metric="count"]'), number.format(data.count));
      root.querySelectorAll(".dr-range-track").forEach(track => setRangeTrack(track, data.percent));
      const belowLow = data.percent != null && data.percent < 0;
      const aboveHigh = data.percent != null && data.percent > 100;
      const metrics = root.querySelectorAll(".dr-metrics article span");
      if (metrics[0]) metrics[0].textContent = belowLow ? "فاصله پایین‌تر از کف امروز" : "فاصله از کف امروز";
      if (metrics[1]) metrics[1].textContent = aboveHigh ? "فاصله بالاتر از سقف امروز" : "فاصله تا سقف امروز";
    }
    latestModel = data;
  }
  function showInsufficient(message, count = 0) {
    root.hidden = false;
    mounted = false;
    expanded = false;
    latestModel = null;
    root.innerHTML = `<div class="dr-empty"><span class="dr-empty-symbol" aria-hidden="true">—</span><div><b>بازه بازار هنوز در دسترس نیست</b><p>${message}</p><small>${number.format(count)} قیمت تازه با کارمزد مشخص</small></div></div>`;
  }
  function toggleExpanded() {
    expanded = !expanded;
    const details = root.querySelector(".dr-details");
    const trigger = root.querySelector(".dr-summary");
    if (details) details.hidden = !expanded;
    if (trigger) trigger.setAttribute("aria-expanded", String(expanded));
  }
  function historicalMarketSeries(providerCandles) {
    const byMinute = new Map();
    for (const candles of providerCandles) for (const candle of candles) {
      const buy = candle.buy || {};
      const values = { open: Number(buy.open), high: Number(buy.high), low: Number(buy.low), close: Number(buy.close) };
      const { open, high, low, close } = values;
      if (!candle.buyFeesKnown || !Object.values(values).every(Number.isFinite) || low <= 0 || high < low || open < low || open > high || close < low || close > high) continue;
      const timestamp = Math.floor(Date.parse(candle.timestamp) / 60_000) * 60_000;
      if (!Number.isFinite(timestamp)) continue;
      if (!byMinute.has(timestamp)) byMinute.set(timestamp, []);
      byMinute.get(timestamp).push(values);
    }
    return [...byMinute.entries()].sort((a, b) => a[0] - b[0]).flatMap(([timestamp, rows]) => {
      const candle = {}; let contributors = Infinity;
      for (const field of ["open", "high", "low", "close"]) {
        const result = robustMedian(rows.map(row => row[field]));
        if (!result) return [];
        candle[field] = result.value;
        contributors = Math.min(contributors, result.count);
      }
      if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) return [];
      return [{ timestamp, ...candle, contributors }];
    });
  }
  function makeMarketModel() {
    const quotes = latestPrices
      .filter(price => price.available && !price.stale)
      .map(price => effectiveBuyPerGram(price))
      .filter(value => Number.isFinite(value) && value > 0);
    const current = robustMedian(quotes);
    if (!current) return { count: quotes.length };
    const candles = historicalMarketSeries(historicalCandles)
      .filter(candle => candle.contributors >= minimumProviders);
    if (!candles.length) return { count: current.count, missingHistory: true };
    // Include the current fresh market reference in today's displayed bounds.
    // If it breaks the candle-derived range, it becomes the new low or high.
    const low = Math.min(current.value, ...candles.map(candle => candle.low));
    const high = Math.max(current.value, ...candles.map(candle => candle.high));
    const percent = high > low ? (current.value - low) / (high - low) * 100 : null;
    return {
      current: current.value,
      count: current.count,
      low,
      high,
      percent,
      aboveLow: current.value - low,
      belowHigh: high - current.value,
      candles,
    };
  }
  function render() {
    const model = makeMarketModel();
    if (!Number.isFinite(model.current)) {
      showInsufficient("برای مرجع فعلی دست‌کم سه قیمت خرید تازه و معتبر با کارمزد مشخص لازم است.", model.count);
    } else if (model.missingHistory) {
      showInsufficient("برای محاسبه کف و سقف امروز، کندل‌های معتبر و هم‌زمان از دست‌کم سه پلتفرم لازم است.", model.count);
    } else {
      updateLiveView(model);
    }
  }
  function aggregateCandles(candles) {
    const interval = 15 * 60_000;
    const groups = new Map();
    for (const candle of candles) {
      const timestamp = Math.floor(candle.timestamp / interval) * interval;
      const group = groups.get(timestamp);
      if (!group) {
        groups.set(timestamp, { timestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close, contributors: candle.contributors });
        continue;
      }
      group.high = Math.max(group.high, candle.high);
      group.low = Math.min(group.low, candle.low);
      group.close = candle.close;
      group.contributors = Math.min(group.contributors, candle.contributors);
    }
    return [...groups.values()].sort((a, b) => a.timestamp - b.timestamp);
  }
  function candleChart(candles) {
    if (!candles.length) return `<p class="dr-no-chart">کندل مرجع بازار با پوشش کافی موجود نیست.</p>`;
    candles = aggregateCandles(candles);
    const width = 780, height = 190, padding = 18;
    const min = Math.min(...candles.map(candle => candle.low));
    const max = Math.max(...candles.map(candle => candle.high));
    const span = max - min || 1;
    const x = index => padding + (width - 2 * padding) * (index + .5) / candles.length;
    const y = value => height - padding - (value - min) / span * (height - 2 * padding);
    const step = (width - 2 * padding) / candles.length;
    const bars = candles.map((candle, index) => {
      const color = candle.close >= candle.open ? "#52bf95" : "#d97981";
      const bodyWidth = Math.max(2, Math.min(8, step * .56));
      const label = new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit" }).format(new Date(candle.timestamp));
      return `<g stroke="${color}" fill="${color}" stroke-linecap="round"><path d="M${x(index)} ${y(candle.high)}V${y(candle.low)}" stroke-width="1.4"/><rect x="${x(index)-bodyWidth/2}" y="${Math.min(y(candle.open), y(candle.close))}" width="${bodyWidth}" height="${Math.max(2, Math.abs(y(candle.open)-y(candle.close)))}" rx="1.2"/><title>${label} · ${number.format(candle.contributors)} پلتفرم</title></g>`;
    }).join("");
    return `<div class="dr-chart-wrap"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="کندل‌های میانه بازار برای قیمت خرید امروز" preserveAspectRatio="none"><path class="dr-chart-grid" d="M${padding} ${padding}H${width-padding}M${padding} ${height/2}H${width-padding}M${padding} ${height-padding}H${width-padding}"/>${bars}</svg></div>`;
  }
  async function refreshHistoricalCandles() {
    const sites = [...new Set(latestPrices.map(price => price.site).filter(Boolean))].sort();
    const key = `${tehranDay()}|${grams}|${sites.join(",")}`;
    if (key !== historicalSitesKey) {
      historicalSitesKey = key;
      historicalCandles = [];
      candlesFetchedAt = 0;
      activeRequestKey = "";
    }
    if (Date.now() - candlesFetchedAt < candleCacheMs) { render(); return; }
    if (activeRequestKey === key) { render(); return; }
    activeRequestKey = key;
    const version = ++requestVersion;
    const from = tehranMidnight().toISOString();
    const responses = await Promise.allSettled(sites.map(async site => {
      const params = new URLSearchParams({ site, interval: "1m", from, limit: "2000", grams: String(grams) });
      const response = await fetch(`/api/candles?${params}`);
      if (!response.ok) throw new Error("Daily candle request failed");
      return response.json();
    }));
    if (version !== requestVersion) return;
    activeRequestKey = "";
    historicalCandles = responses.filter(result => result.status === "fulfilled" && Array.isArray(result.value)).map(result => result.value);
    candlesFetchedAt = Date.now();
    render();
  }

  window.addEventListener("gold-prices-updated", event => {
    const data = event.detail || {};
    latestPrices = Array.isArray(data.prices) ? data.prices : [];
    grams = Number.isFinite(Number(data.grams)) && Number(data.grams) >= .001 ? Number(data.grams) : 1;
    refreshHistoricalCandles().catch(() => showInsufficient("دریافت داده کندلی بازار ناموفق بود.", 0));
  });
})();
