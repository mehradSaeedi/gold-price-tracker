/* /\ Standalone history overview: remove this file and its section/assets to roll the feature back. */
(() => {
  const number = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2, signDisplay: "always" });
  const dateTime = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const dateOnly = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", month: "short", day: "numeric" });
  const timeOnly = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit" });
  const ranges = { "24h": { ms: 86400000, interval: "15m", limit: 96 }, "7d": { ms: 7 * 86400000, interval: "1h", limit: 168 }, "30d": { ms: 30 * 86400000, interval: "1d", limit: 30 } };
  const site = document.getElementById("history-site");
  const side = document.getElementById("history-side");
  let range = "24h";
  let requestId = 0;
  let currentPrices = new Map();

  function formatPrice(value) { return number.format(Math.round(value)); }
  function setText(id, value) { document.getElementById(id).textContent = value; }
  function formatQuoteAge(ageSeconds) {
    const seconds = Number(ageSeconds);
    if (!Number.isFinite(seconds) || seconds < 0) return "زمان نامشخص";
    const wholeSeconds = Math.floor(seconds);
    if (wholeSeconds < 60) return `${number.format(wholeSeconds)} ثانیه پیش`;
    const minutes = Math.floor(wholeSeconds / 60);
    if (minutes < 60) return `${number.format(minutes)} دقیقه پیش`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${number.format(hours)} ساعت پیش`;
    return `${number.format(Math.floor(hours / 24))} روز پیش`;
  }
  function updateLiveFreshness() {
    const indicator = document.getElementById("history-freshness");
    const price = currentPrices.get(site.value);
    const fresh = Boolean(price?.available && !price.stale), stale = Boolean(price?.available && price.stale);
    indicator.classList.toggle("is-fresh", fresh);
    indicator.classList.toggle("is-stale", stale);
    indicator.textContent = !currentPrices.has(site.value)
      ? "زمان دریافت نرخ نامشخص"
      : !price?.available
        ? "نرخ فعلی در دسترس نیست"
        : price.stale
          ? `نرخ قدیمی · آخرین دریافت: ${formatQuoteAge(price.ageSeconds)}`
          : `آخرین دریافت: ${formatQuoteAge(price.ageSeconds)}`;
    indicator.title = `زمان دریافت آخرین نرخ ${site.value || ""}`;
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
    document.getElementById("history-empty").textContent = message;
    document.getElementById("history-empty").hidden = false;
    document.querySelector(".history-chart-wrap").classList.add("is-empty");
    document.getElementById("history-chart").classList.add("history-chart-hidden");
    document.getElementById("history-key-high").hidden = true;
    document.getElementById("history-key-low").hidden = true;
    document.getElementById("history-y-axis").replaceChildren();
    ["history-x-start", "history-x-middle", "history-x-end"].forEach((id) => setText(id, ""));
    ["history-latest", "history-change", "history-low", "history-high"].forEach((id) => setText(id, "—"));
  }
  function render(candles, selectedRange, selectedSide) {
    const points = candles.map((candle) => ({ time: Date.parse(candle.timestamp), value: candle[selectedSide]?.close })).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value) && point.value > 0).sort((a, b) => a.time - b.time);
    if (!points.length) { showEmpty("برای این بازه هنوز تاریخچه‌ای ذخیره نشده است."); setText("history-coverage", "هنوز داده‌ای در دسترس نیست"); return; }
    const values = points.map((point) => point.value);
    const low = Math.min(...values), high = Math.max(...values), latest = values.at(-1), first = values[0];
    const change = first ? ((latest - first) / first) * 100 : 0;
    setText("history-latest", formatPrice(latest));
    const changeNode = document.getElementById("history-change");
    changeNode.textContent = `${percent.format(change)}٪`;
    changeNode.classList.toggle("history-positive", change >= 0);
    changeNode.classList.toggle("history-negative", change < 0);
    setText("history-low", formatPrice(low)); setText("history-high", formatPrice(high));
    const periodStart = Date.now() - ranges[selectedRange].ms;
    const actualStart = points[0].time;
    const formatter = selectedRange === "24h" ? dateTime : dateOnly;
    const axisFormatter = selectedRange === "24h" ? timeOnly : dateOnly;
    setText("history-coverage", `${formatter.format(new Date(actualStart))} تا ${formatter.format(new Date(points.at(-1).time))} · ${number.format(points.length)} نقطه`);
    setText("history-period", actualStart > periodStart + 60000 ? `از ${formatter.format(new Date(actualStart))} (تاریخچه موجود)` : "در بازه انتخابی");

    const svg = document.getElementById("history-chart"), grid = document.getElementById("history-grid");
    const left = 10, right = 990, top = 20, bottom = 220;
    const scale = priceScale(low, high);
    const timeSpan = points.at(-1).time - points[0].time;
    const coords = points.map((point) => ({ ...point, x: left + (timeSpan === 0 ? .5 : (point.time - points[0].time) / timeSpan) * (right - left), y: bottom - ((point.value - scale.min) / (scale.max - scale.min)) * (bottom - top) }));
    const path = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const highPoint = coords.reduce((best, point) => point.value > best.value ? point : best, coords[0]);
    const lowPoint = coords.reduce((best, point) => point.value < best.value ? point : best, coords[0]);
    const placeKeyLabel = (id, point, title, below) => {
      const label = document.getElementById(id);
      label.replaceChildren();
      const caption = document.createElement("span"), value = document.createElement("strong");
      caption.textContent = title; value.textContent = formatPrice(point.value);
      label.append(caption, value); label.hidden = true;
      label.style.left = `${(point.x / 10).toFixed(2)}%`;
      label.style.top = `${(point.y / 2.5).toFixed(2)}%`;
      label.classList.toggle("is-right", point.x > 500);
      label.classList.toggle("is-below", below);
    };
    placeKeyLabel("history-key-high", highPoint, "بیشینه", true);
    const lowLabel = document.getElementById("history-key-low");
    if (lowPoint.value < highPoint.value) placeKeyLabel("history-key-low", lowPoint, "کمینه", false);
    else lowLabel.hidden = true;
    const historyLine = document.getElementById("history-line");
    historyLine.setAttribute("d", path);
    // Keep the full stroke visible on every render. A dash-reveal animation can leave
    // the line looking truncated when chart data refreshes before its transition ends.
    historyLine.style.removeProperty("transition");
    historyLine.style.removeProperty("stroke-dasharray");
    historyLine.style.removeProperty("stroke-dashoffset");
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && typeof historyLine.animate === "function") {
      historyLine.animate([{ opacity: .78 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
    }
    document.getElementById("history-area").setAttribute("d", `${path} L${coords.at(-1).x},${bottom} L${coords[0].x},${bottom} Z`);
    const dot = document.getElementById("history-dot"); dot.setAttribute("cx", coords.at(-1).x); dot.setAttribute("cy", coords.at(-1).y);
    const hoverRing = document.getElementById("history-hover-ring");
    const crosshair = document.getElementById("history-crosshair"), crosshairLevel = document.getElementById("history-crosshair-level");
    const svgNode = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);
    const gridNodes = scale.ticks.map((tick) => {
      const y = tick.y, line = svgNode("line");
      line.setAttribute("x1", left); line.setAttribute("x2", right); line.setAttribute("y1", y); line.setAttribute("y2", y); line.setAttribute("class", "history-grid-line");
      return line;
    });
    grid.replaceChildren(...gridNodes);
    const yAxis = document.getElementById("history-y-axis"), unit = document.createElement("span"), livePrice = document.createElement("span");
    unit.className = "market-axis-unit"; unit.textContent = "تومان";
    livePrice.className = "market-live-price";
    const tickLabels = scale.ticks.map((tick) => {
      const label = document.createElement("span");
      label.className = "market-y-tick"; label.style.top = `${(tick.y / 250) * 100}%`; label.textContent = formatPrice(tick.value);
      return { tick, label };
    });
    yAxis.replaceChildren(unit, livePrice, ...tickLabels.map(({ label }) => label));
    const setLivePrice = (point) => {
      livePrice.textContent = formatPrice(point.value);
      livePrice.style.top = `${(point.y / 250) * 100}%`;
      tickLabels.forEach(({ tick, label }) => label.classList.toggle("is-covered", Math.abs(tick.y - point.y) < 15));
    };
    setLivePrice(coords.at(-1));
    const middleTime = points[0].time + timeSpan / 2;
    setText("history-x-start", timeSpan ? axisFormatter.format(new Date(points[0].time)) : "");
    setText("history-x-middle", axisFormatter.format(new Date(middleTime)));
    setText("history-x-end", timeSpan ? axisFormatter.format(new Date(points.at(-1).time)) : "");
    svg.classList.remove("history-chart-hidden");
    svg.parentElement.parentElement.parentElement.classList.remove("is-empty");
    document.getElementById("history-empty").hidden = true;
    svg.onpointermove = (event) => {
      document.getElementById("history-key-high").hidden = false;
      document.getElementById("history-key-low").hidden = lowPoint.value >= highPoint.value;
      const bounds = svg.getBoundingClientRect(), x = ((event.clientX - bounds.left) / bounds.width) * 1000;
      const point = coords.reduce((best, item) => Math.abs(item.x - x) < Math.abs(best.x - x) ? item : best, coords[0]);
      setLivePrice(point);
      crosshair.setAttribute("x1", point.x); crosshair.setAttribute("x2", point.x); crosshair.setAttribute("visibility", "visible");
      crosshairLevel.setAttribute("y1", point.y); crosshairLevel.setAttribute("y2", point.y); crosshairLevel.setAttribute("visibility", "visible");
      hoverRing.setAttribute("cx", point.x); hoverRing.setAttribute("cy", point.y); hoverRing.setAttribute("visibility", "visible"); hoverRing.classList.add("is-active");
      dot.setAttribute("cx", point.x); dot.setAttribute("cy", point.y);
      const tooltip = document.getElementById("history-tooltip");
      tooltip.textContent = `${formatPrice(point.value)} تومان · ${dateTime.format(new Date(point.time))}`;
      tooltip.hidden = false;
      const wrapWidth = svg.parentElement.clientWidth;
      tooltip.style.left = `${Math.max(4, Math.min(wrapWidth - tooltip.offsetWidth - 4, (point.x / 1000) * wrapWidth - tooltip.offsetWidth / 2))}px`;
      tooltip.style.top = `${(point.y / 250) * svg.clientHeight}px`;
    };
    svg.onpointerleave = () => {
      document.getElementById("history-key-high").hidden = true;
      document.getElementById("history-key-low").hidden = true;
      document.getElementById("history-tooltip").hidden = true; crosshair.setAttribute("visibility", "hidden"); crosshairLevel.setAttribute("visibility", "hidden");
      hoverRing.classList.remove("is-active"); window.setTimeout(() => { if (!hoverRing.classList.contains("is-active")) hoverRing.setAttribute("visibility", "hidden"); }, 150);
      setLivePrice(coords.at(-1));
      dot.setAttribute("cx", coords.at(-1).x); dot.setAttribute("cy", coords.at(-1).y);
    };
  }
  async function load() {
    const current = ++requestId;
    if (!site.value) { showEmpty("در انتظار دریافت قیمت ارائه‌دهندگان…"); return; }
    const config = ranges[range];
    const params = new URLSearchParams({ site: site.value, interval: config.interval, limit: String(config.limit), grams: String(Math.min(10000, Math.max(0.001, Number(document.getElementById("grams").value) || 1))), from: new Date(Date.now() - config.ms).toISOString() });
    try {
      const response = await fetch(`/api/candles?${params}`);
      if (!response.ok) throw new Error("تاریخچه دریافت نشد.");
      const candles = await response.json();
      if (current === requestId) render(candles, range, side.value);
    } catch (_) { if (current === requestId) showEmpty("دریافت تاریخچه ناموفق بود؛ کمی بعد دوباره تلاش می‌کنیم."); }
  }
  async function updateSites() {
    try {
      const response = await fetch("/api/prices"); if (!response.ok) return;
      const prices = await response.json(), previous = site.value;
      currentPrices = new Map(prices.map((price) => [price.site, price]));
      const names = { Milli: "میلی", WallGold: "وال‌گلد", Talano: "طلانو", Goldika: "گلدیکا", Talasea: "طلاسی", Taline: "طلاین", MelliGold: "ملی‌گلد", Hamrahgold: "همراه‌گلد", TapsiGold: "تپسی‌گلد", Invi: "اینوی", Myshemsh: "مای‌شمش", Gerami: "گرمی", "Snapp Sarmayeh": "اسنپ سرمایه", "Digi Gold": "دیجی‌گلد", Zarpin: "زرپین", Daric: "داریک", Zarafza: "زرافزا", Zarpay: "زرپی" };
      const available = prices.filter((price) => price.site).map((price) => price.site).sort();
      if (!available.length) return;
      site.replaceChildren(...available.map((name) => { const option = document.createElement("option"); option.value = name; option.textContent = names[name] || name; return option; }));
      site.value = available.includes(previous) ? previous : available[0];
      updateLiveFreshness();
      if (site.dataset.ready !== "true") { site.dataset.ready = "true"; load(); }
    } catch (_) { /* Keep the last usable provider selection while the regular dashboard retries. */ }
  }
  site.addEventListener("change", () => { updateLiveFreshness(); load(); }); side.addEventListener("change", load);
  document.querySelectorAll("[data-history-range]").forEach((button) => button.addEventListener("click", () => {
    range = button.dataset.historyRange;
    document.querySelectorAll("[data-history-range]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    load();
  }));
  document.getElementById("grams").addEventListener("change", load);
  updateSites(); setInterval(updateSites, 30000); setInterval(load, 60000);
})();
