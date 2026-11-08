/* /\\ Optional market-wide winner timeline. Remove this module with its section/styles/API to roll back. */
(() => {
  const format = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2, signDisplay: "always" });
  const dateTime = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const dateOnly = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", month: "short", day: "numeric" });
  const timeOnly = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit" });
  const ranges = { "24h": { ms: 86400000, interval: "15m", limit: 96 }, "7d": { ms: 7 * 86400000, interval: "1h", limit: 168 }, "30d": { ms: 30 * 86400000, interval: "1d", limit: 30 } };
  const names = { Milli: "میلی", WallGold: "وال‌گلد", Talano: "طلانو", Goldika: "گلدیکا", Talasea: "طلاسی", Taline: "طلاین", MelliGold: "ملی‌گلد", Hamrahgold: "همراه‌گلد", TapsiGold: "تپسی‌گلد", Invi: "اینوی", Myshemsh: "مای‌شمش", Gerami: "گرمی", "Snapp Sarmayeh": "اسنپ سرمایه", "Digi Gold": "دیجی‌گلد", Zarpin: "زرپین", Daric: "داریک", Zarafza: "زرافزا", Zarpay: "زرپی" };
  const palette = ["#63d6a0", "#e5bd62", "#8d79db", "#56a9d8", "#ed8588", "#d985bd", "#8bbd65", "#dc9561", "#6dc4c8", "#a8a0ed", "#d8cd67", "#6d91d0", "#cf7e70", "#7db99b", "#b48bdb", "#c2a36f"];
  const providerOrder = Object.keys(names);
  function colorForProvider(site) {
    const knownIndex = providerOrder.indexOf(site);
    const hash = [...site].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0);
    return palette[(knownIndex >= 0 ? knownIndex : hash) % palette.length];
  }
  let range = "24h", requestId = 0, selectedProvider = null, currentPrices = new Map(), livePricesLoaded = false;
  const sideControl = document.getElementById("best-offer-side");
  const chart = document.getElementById("best-offer-chart");
  const providerName = (site) => names[site] || site || "نامشخص";
  const toman = (amount) => `${format.format(Math.round(amount))} تومان`;
  function formatQuoteAge(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    if (value < 60) return `${format.format(value)} ثانیه پیش`;
    const minutes = Math.floor(value / 60);
    if (minutes < 60) return `${format.format(minutes)} دقیقه پیش`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${format.format(hours)} ساعت پیش`;
    return `${format.format(Math.floor(hours / 24))} روز پیش`;
  }
  function updateChartFreshness() {
    const site = chart.dataset.latestSite;
    const price = currentPrices.get(site);
    const indicator = document.getElementById("best-offer-provider");
    indicator.textContent = !site
      ? "ارائه‌دهنده نامشخص"
      : !livePricesLoaded
        ? providerName(site)
        : !price?.available
        ? `${providerName(site)} · نرخ فعلی در دسترس نیست`
        : price.stale
          ? `${providerName(site)} · نرخ قدیمی · دریافت: ${formatQuoteAge(price.ageSeconds)}`
          : `${providerName(site)} · دریافت: ${formatQuoteAge(price.ageSeconds)}`;
    indicator.title = `زمان دریافت آخرین نرخ ${providerName(site)}`;
  }
  function priceScale(low, high) {
    const rawStep = (high - low) / 4 || Math.max(1, high * .001);
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const fraction = rawStep / magnitude;
    const step = magnitude * ([1, 2, 2.5, 5, 10].find((candidate) => candidate >= fraction) || 10);
    const first = Math.floor(low / step) * step;
    let last = Math.ceil(high / step) * step;
    if (last <= first) last = first + step;
    const min = first - step * .5, max = last + step * .5;
    const ticks = [];
    for (let value = first, index = 0; value <= last + step * .001 && index < 10; value += step, index += 1) {
      ticks.push({ value, y: 220 - ((value - min) / (max - min)) * 200 });
    }
    return { min, max, ticks };
  }

  function showEmpty(message) {
    document.getElementById("best-offer-empty").textContent = message;
    document.getElementById("best-offer-empty").hidden = false;
    document.querySelector(".best-offer-chart-wrap").classList.add("is-empty");
    chart.classList.add("best-offer-chart-hidden");
    chart.dataset.latestSite = "";
    document.getElementById("best-offer-key-high").hidden = true;
    document.getElementById("best-offer-key-low").hidden = true;
    updateChartFreshness();
    document.getElementById("best-offer-legend").replaceChildren();
    document.getElementById("best-offer-y-axis").replaceChildren();
    ["best-offer-x-start", "best-offer-x-middle", "best-offer-x-end"].forEach((id) => { document.getElementById(id).textContent = ""; });
    ["best-offer-current", "best-offer-provider", "best-offer-change", "best-offer-leaders", "best-offer-points", "best-offer-coverage"].forEach((id) => { document.getElementById(id).textContent = "—"; });
    document.getElementById("best-offer-change-label").textContent = "تغییر بهترین قیمت";
    document.getElementById("best-offer-change-note").textContent = "با دریافت داده‌ها مشخص می‌شود";
  }

  function render(rows, selectedRange, side) {
    const [siteKey, valueKey] = side === "buy" ? ["buySite", "buyToman"] : ["sellSite", "sellToman"];
    const points = rows.map((row) => ({ time: Date.parse(row.timestamp), site: row[siteKey], value: Number(row[valueKey]) })).filter((point) => Number.isFinite(point.time) && point.site && point.value > 0).sort((a, b) => a.time - b.time);
    if (!points.length) { showEmpty("برای این بازه هنوز پیشنهادهای تاریخی کافی ثبت نشده است."); return; }
    const siteOrder = [...new Set(points.map((point) => point.site))].sort();
    if (!siteOrder.includes(selectedProvider)) selectedProvider = null;
    const colorFor = new Map(siteOrder.map((name) => [name, colorForProvider(name)]));
    const counts = new Map(); points.forEach((point) => counts.set(point.site, (counts.get(point.site) || 0) + 1));
    const first = points[0], latest = points.at(-1), delta = ((latest.value - first.value) / first.value) * 100;
    document.getElementById("best-offer-current-label").textContent = side === "buy" ? "بهترین خرید آخرین بازه" : "بهترین فروش آخرین بازه";
    document.getElementById("best-offer-current").textContent = toman(latest.value);
    document.getElementById("best-offer-provider").textContent = providerName(latest.site);
    const change = document.getElementById("best-offer-change");
    document.getElementById("best-offer-change-label").textContent = side === "buy" ? "تغییر بهترین خرید" : "تغییر بهترین فروش";
    change.textContent = `${percent.format(delta)}٪`;
    const favorable = side === "buy" ? delta < 0 : delta > 0;
    change.classList.toggle("offer-up", favorable); change.classList.toggle("offer-down", !favorable && delta !== 0);
    document.getElementById("best-offer-change-note").textContent = delta === 0
      ? "بدون تغییر"
      : side === "buy"
        ? (delta < 0 ? "کاهش هزینه برای خریدار" : "افزایش هزینه برای خریدار")
        : (delta > 0 ? "افزایش دریافتی برای فروشنده" : "کاهش دریافتی برای فروشنده");
    document.getElementById("best-offer-leaders").textContent = format.format(siteOrder.length);
    document.getElementById("best-offer-points").textContent = format.format(points.length);
    const formatter = selectedRange === "24h" ? dateTime : dateOnly;
    const axisFormatter = selectedRange === "24h" ? timeOnly : dateOnly;
    document.getElementById("best-offer-coverage").textContent = `${formatter.format(new Date(first.time))} تا ${formatter.format(new Date(latest.time))}`;
    document.getElementById("best-offer-note").textContent = `مبالغ برای ${format.format(Number(document.getElementById("grams").value) || 1)} گرم و با کارمزدهای شناخته‌شده محاسبه شده‌اند.`;

    const left = 10, right = 990, top = 20, bottom = 220;
    const values = points.map((point) => point.value), low = Math.min(...values), high = Math.max(...values);
    const scale = priceScale(low, high), timeSpan = latest.time - first.time;
    const coords = points.map((point, index) => ({ ...point, index, x: left + (timeSpan === 0 ? .5 : (point.time - first.time) / timeSpan) * (right - left), y: bottom - (point.value - scale.min) / (scale.max - scale.min) * (bottom - top) }));
    const highPoint = coords.reduce((best, point) => point.value > best.value ? point : best, coords[0]);
    const lowPoint = coords.reduce((best, point) => point.value < best.value ? point : best, coords[0]);
    const placeKeyLabel = (id, point, title, below) => {
      const label = document.getElementById(id);
      label.replaceChildren();
      const caption = document.createElement("span"), value = document.createElement("strong");
      caption.textContent = title; value.textContent = format.format(Math.round(point.value));
      label.append(caption, value); label.hidden = true;
      label.style.left = `${(point.x / 10).toFixed(2)}%`;
      label.style.top = `${(point.y / 2.5).toFixed(2)}%`;
      label.classList.toggle("is-right", point.x > 500);
      label.classList.toggle("is-below", below);
    };
    placeKeyLabel("best-offer-key-high", highPoint, "بیشترین", true);
    const lowLabel = document.getElementById("best-offer-key-low");
    if (lowPoint.value < highPoint.value) placeKeyLabel("best-offer-key-low", lowPoint, "کمترین", false);
    else lowLabel.hidden = true;
    const areaPath = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    document.getElementById("best-offer-area").setAttribute("d", `${areaPath} L${coords.at(-1).x},${bottom} L${coords[0].x},${bottom} Z`);
    const segments = [];
    for (let index = 1; index < coords.length; index += 1) {
      const previous = coords[index - 1], point = coords[index], line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.setAttribute("d", `M${previous.x.toFixed(2)},${previous.y.toFixed(2)} L${point.x.toFixed(2)},${point.y.toFixed(2)}`);
      line.setAttribute("stroke", colorFor.get(point.site)); line.setAttribute("class", "best-offer-segment");
      line.style.color = colorFor.get(point.site);
      line.dataset.site = point.site;
      line.dataset.pointIndex = String(index); segments.push(line);
    }
    const lineHost = document.getElementById("best-offer-lines");
    lineHost.replaceChildren(...segments);
    const legend = document.getElementById("best-offer-legend");
    const legendButtons = new Map();
    // Keep hover sampling on the complete best-offer curve. Provider selection dims
    // other segments, but must not change the cursor's sampling domain: a provider may
    // only win a few isolated intervals, which would otherwise make the marker snap or
    // flatten when the pointer moves outside those intervals.
    const focusPoints = coords;
    const applyProviderFocus = () => {
      lineHost.querySelectorAll(".best-offer-segment").forEach((line) => {
        const active = !selectedProvider || line.dataset.site === selectedProvider;
        line.classList.toggle("is-highlighted", Boolean(selectedProvider) && active);
        line.classList.toggle("is-dimmed", Boolean(selectedProvider) && !active);
      });
      legendButtons.forEach((button, name) => {
        button.setAttribute("aria-pressed", String(selectedProvider === name));
        button.classList.toggle("is-selected", selectedProvider === name);
        button.classList.toggle("is-muted", Boolean(selectedProvider) && selectedProvider !== name);
        button.title = selectedProvider === name ? "نمایش همه ارائه‌دهندگان" : `تمرکز روی ${providerName(name)}`;
      });
    };
    legend.replaceChildren(...siteOrder.map((name) => {
      const button = document.createElement("button"), swatch = document.createElement("i");
      button.type = "button"; button.className = "best-offer-legend-item"; button.setAttribute("aria-pressed", String(selectedProvider === name));
      button.style.setProperty("--provider-color", colorFor.get(name));
      button.title = selectedProvider === name ? "نمایش همه ارائه‌دهندگان" : `تمرکز روی ${providerName(name)}`;
      swatch.setAttribute("aria-hidden", "true");
      button.append(swatch, document.createTextNode(`${providerName(name)} · ${format.format(counts.get(name))}`));
      legendButtons.set(name, button);
      button.addEventListener("click", () => { selectedProvider = selectedProvider === name ? null : name; applyProviderFocus(); });
      return button;
    }));
    applyProviderFocus();
    // Render complete segments immediately. Animating each short segment independently
    // makes valid transitions look like data gaps during refreshes and range changes.
    segments.forEach((line) => {
      line.style.removeProperty("transition");
      line.style.removeProperty("stroke-dasharray");
      line.style.removeProperty("stroke-dashoffset");
    });
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && typeof lineHost.animate === "function") {
      lineHost.animate([{ opacity: .78 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
    }
    const dot = document.getElementById("best-offer-dot"); dot.setAttribute("cx", coords.at(-1).x); dot.setAttribute("cy", coords.at(-1).y);
    dot.style.setProperty("stroke", colorFor.get(latest.site));
    chart.dataset.latestSite = latest.site;
    updateChartFreshness();
    const hoverRing = document.getElementById("best-offer-hover-ring");
    const crosshair = document.getElementById("best-offer-crosshair"), crosshairLevel = document.getElementById("best-offer-crosshair-level");
    const svgNode = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);
    const gridNodes = scale.ticks.map((tick) => {
      const y = tick.y, line = svgNode("line");
      line.setAttribute("x1", left); line.setAttribute("x2", right); line.setAttribute("y1", y); line.setAttribute("y2", y); line.setAttribute("class", "best-offer-gridline");
      return line;
    });
    document.getElementById("best-offer-grid").replaceChildren(...gridNodes);
    const yAxis = document.getElementById("best-offer-y-axis"), unit = document.createElement("span"), livePrice = document.createElement("span");
    unit.className = "market-axis-unit"; unit.textContent = "تومان";
    livePrice.className = "market-live-price market-live-price-offer";
    const tickLabels = scale.ticks.map((tick) => {
      const label = document.createElement("span");
      label.className = "market-y-tick"; label.style.top = `${(tick.y / 250) * 100}%`; label.textContent = format.format(Math.round(tick.value));
      return { tick, label };
    });
    yAxis.replaceChildren(unit, livePrice, ...tickLabels.map(({ label }) => label));
    const setLivePrice = (value, y) => {
      const label = format.format(Math.round(value));
      if (livePrice.textContent !== label) livePrice.textContent = label;
      livePrice.style.top = `${(y / 250) * 100}%`;
      tickLabels.forEach(({ tick, label }) => label.classList.toggle("is-covered", Math.abs(tick.y - y) < 15));
    };
    setLivePrice(coords.at(-1).value, coords.at(-1).y);
    const middleTime = first.time + timeSpan / 2;
    document.getElementById("best-offer-x-start").textContent = timeSpan ? axisFormatter.format(new Date(first.time)) : "";
    document.getElementById("best-offer-x-middle").textContent = axisFormatter.format(new Date(middleTime));
    document.getElementById("best-offer-x-end").textContent = timeSpan ? axisFormatter.format(new Date(latest.time)) : "";
    document.getElementById("best-offer-empty").hidden = true; chart.classList.remove("best-offer-chart-hidden");
    chart.parentElement.parentElement.parentElement.classList.remove("is-empty");
    let hoverFrame = 0, pendingClientX = 0, hoveredSegmentIndex = -1;
    const tooltip = document.getElementById("best-offer-tooltip");
    const updateHover = () => {
      hoverFrame = 0;
      if (!focusPoints.length) return;
      const bounds = chart.getBoundingClientRect();
      const x = ((pendingClientX - bounds.left) / bounds.width) * 1000;
      let lowIndex = 0, highIndex = focusPoints.length;
      while (lowIndex < highIndex) {
        const middle = (lowIndex + highIndex) >>> 1;
        if (focusPoints[middle].x < x) lowIndex = middle + 1;
        else highIndex = middle;
      }
      const rightPoint = focusPoints[Math.min(lowIndex, focusPoints.length - 1)];
      const leftPoint = focusPoints[Math.max(0, lowIndex - 1)];
      const cursorX = Math.max(left, Math.min(right, x));
      const spanX = rightPoint.x - leftPoint.x;
      const ratio = spanX ? Math.max(0, Math.min(1, (cursorX - leftPoint.x) / spanX)) : 0;
      const cursorY = leftPoint.y + (rightPoint.y - leftPoint.y) * ratio;
      const cursorValue = leftPoint.value + (rightPoint.value - leftPoint.value) * ratio;
      const cursorTime = leftPoint.time + (rightPoint.time - leftPoint.time) * ratio;
      // Each rendered segment takes the color of its ending point's provider.
      const segmentSite = rightPoint.site;
      const segmentColor = colorFor.get(segmentSite);
      const hoverColor = selectedProvider && segmentSite !== selectedProvider
        ? getComputedStyle(document.documentElement).getPropertyValue("--color-text-muted").trim()
        : segmentColor;
      crosshair.setAttribute("x1", cursorX); crosshair.setAttribute("x2", cursorX); crosshair.setAttribute("visibility", "visible");
      crosshairLevel.setAttribute("y1", cursorY); crosshairLevel.setAttribute("y2", cursorY); crosshairLevel.setAttribute("visibility", "visible");
      const segmentChanged = rightPoint.index !== hoveredSegmentIndex;
      if (segmentChanged) {
        hoveredSegmentIndex = rightPoint.index;
        hoverRing.style.setProperty("stroke", hoverColor); hoverRing.style.color = hoverColor;
        hoverRing.setAttribute("visibility", "visible"); hoverRing.classList.add("is-active");
        livePrice.style.setProperty("--live-price-color", hoverColor);
        dot.style.setProperty("stroke", hoverColor);
        tooltip.style.setProperty("--provider-color", hoverColor);
        tooltip.textContent = `${providerName(segmentSite)} · ${toman(cursorValue)} · ${dateTime.format(new Date(cursorTime))}`;
        tooltip.hidden = false;
      }
      setLivePrice(cursorValue, cursorY);
      hoverRing.setAttribute("cx", cursorX); hoverRing.setAttribute("cy", cursorY);
      dot.setAttribute("cx", cursorX); dot.setAttribute("cy", cursorY);
      const pointX = cursorX / 10;
      tooltip.classList.toggle("is-left", pointX < 18);
      tooltip.classList.toggle("is-right", pointX > 82);
      tooltip.style.left = `${pointX}%`;
      tooltip.style.top = `${(cursorY / 2.5).toFixed(2)}%`;
    };
    chart.onpointermove = (event) => {
      document.getElementById("best-offer-key-high").hidden = false;
      document.getElementById("best-offer-key-low").hidden = lowPoint.value >= highPoint.value;
      pendingClientX = event.clientX;
      if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
    };
    chart.onpointerleave = () => {
      document.getElementById("best-offer-key-high").hidden = true;
      document.getElementById("best-offer-key-low").hidden = true;
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      hoverFrame = 0; hoveredSegmentIndex = -1;
      tooltip.hidden = true; crosshair.setAttribute("visibility", "hidden"); crosshairLevel.setAttribute("visibility", "hidden");
      hoverRing.classList.remove("is-active"); window.setTimeout(() => { if (!hoverRing.classList.contains("is-active")) hoverRing.setAttribute("visibility", "hidden"); }, 150);
      setLivePrice(coords.at(-1).value, coords.at(-1).y);
      livePrice.style.setProperty("--live-price-color", colorFor.get(coords.at(-1).site));
      dot.style.setProperty("stroke", colorFor.get(coords.at(-1).site));
      dot.setAttribute("cx", coords.at(-1).x); dot.setAttribute("cy", coords.at(-1).y);
    };
  }

  async function load() {
    const currentRequest = ++requestId, config = ranges[range];
    const grams = Math.min(10000, Math.max(.001, Number(document.getElementById("grams").value) || 1));
    const params = new URLSearchParams({ interval: config.interval, limit: String(config.limit), grams: String(grams), from: new Date(Date.now() - config.ms).toISOString() });
    try {
      const response = await fetch(`/api/best-offers?${params}`);
      if (!response.ok) throw new Error("API error");
      const rows = await response.json();
      if (currentRequest === requestId) render(rows, range, sideControl.value);
    } catch (_) { if (currentRequest === requestId) showEmpty("دریافت تاریخچه پیشنهادها ناموفق بود؛ دوباره تلاش می‌کنیم."); }
  }

  async function updateLivePrices() {
    try {
      const response = await fetch("/api/prices");
      if (!response.ok) return;
      const prices = await response.json();
      currentPrices = new Map(prices.map((price) => [price.site, price]));
      livePricesLoaded = true;
      updateChartFreshness();
    } catch (_) { /* Keep the last known freshness marker while the dashboard retries. */ }
  }

  sideControl.addEventListener("change", load);
  document.querySelectorAll("[data-offer-range]").forEach((button) => button.addEventListener("click", () => {
    range = button.dataset.offerRange;
    document.querySelectorAll("[data-offer-range]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    load();
  }));
  document.getElementById("grams").addEventListener("change", load);
  load(); updateLivePrices(); setInterval(load, 60000); setInterval(updateLivePrices, 30000);
})();
