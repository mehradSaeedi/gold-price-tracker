/* /\ Standalone history overview: remove this file and its section/assets to roll the feature back. */
(() => {
  const number = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2, signDisplay: "always" });
  const dateTime = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const dateOnly = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", month: "short", day: "numeric" });
  const ranges = { "24h": { ms: 86400000, interval: "15m", limit: 96 }, "7d": { ms: 7 * 86400000, interval: "1h", limit: 168 }, "30d": { ms: 30 * 86400000, interval: "1d", limit: 30 } };
  const site = document.getElementById("history-site");
  const side = document.getElementById("history-side");
  let range = "24h";
  let requestId = 0;

  function formatPrice(value) { return number.format(Math.round(value)); }
  function setText(id, value) { document.getElementById(id).textContent = value; }
  function showEmpty(message) {
    document.getElementById("history-empty").textContent = message;
    document.getElementById("history-empty").hidden = false;
    document.getElementById("history-chart").classList.add("history-chart-hidden");
    ["history-latest", "history-change", "history-low", "history-high"].forEach((id) => setText(id, "—"));
  }
  function render(candles, selectedRange, selectedSide) {
    const points = candles.map((candle) => ({ time: Date.parse(candle.timestamp), value: candle[selectedSide]?.close })).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value) && point.value > 0);
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
    setText("history-coverage", `${formatter.format(new Date(actualStart))} تا ${formatter.format(new Date(points.at(-1).time))} · ${number.format(points.length)} نقطه`);
    setText("history-period", actualStart > periodStart + 60000 ? `از ${formatter.format(new Date(actualStart))} (تاریخچه موجود)` : "در بازه انتخابی");

    const svg = document.getElementById("history-chart"), grid = document.getElementById("history-grid");
    const left = 10, right = 990, top = 20, bottom = 220;
    const span = high - low || Math.max(1, high * 0.002);
    const pad = span * 0.12;
    const min = low - pad, max = high + pad;
    const coords = points.map((point, index) => ({ ...point, x: left + (points.length === 1 ? .5 : index / (points.length - 1)) * (right - left), y: bottom - ((point.value - min) / (max - min)) * (bottom - top) }));
    const path = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    document.getElementById("history-line").setAttribute("d", path);
    document.getElementById("history-area").setAttribute("d", `${path} L${coords.at(-1).x},${bottom} L${coords[0].x},${bottom} Z`);
    const dot = document.getElementById("history-dot"); dot.setAttribute("cx", coords.at(-1).x); dot.setAttribute("cy", coords.at(-1).y);
    grid.replaceChildren(...[0, 1, 2, 3].map((index) => {
      const y = top + index * ((bottom - top) / 3), line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", left); line.setAttribute("x2", right); line.setAttribute("y1", y); line.setAttribute("y2", y); line.setAttribute("class", "history-grid-line"); return line;
    }));
    svg.classList.remove("history-chart-hidden");
    document.getElementById("history-empty").hidden = true;
    svg.onpointermove = (event) => {
      const bounds = svg.getBoundingClientRect(), x = ((event.clientX - bounds.left) / bounds.width) * 1000;
      const point = coords.reduce((best, item) => Math.abs(item.x - x) < Math.abs(best.x - x) ? item : best, coords[0]);
      const tooltip = document.getElementById("history-tooltip");
      tooltip.textContent = `${formatPrice(point.value)} تومان · ${dateTime.format(new Date(point.time))}`;
      tooltip.hidden = false;
      tooltip.style.left = `${Math.max(4, Math.min(76, (point.x / 1000) * 100))}%`;
    };
    svg.onpointerleave = () => { document.getElementById("history-tooltip").hidden = true; };
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
      const names = { Milli: "میلی", WallGold: "وال‌گلد", Talano: "طلانو", Goldika: "گلدیکا", Talasea: "طلاسی", Taline: "طلاین", MelliGold: "ملی‌گلد", Hamrahgold: "همراه‌گلد", TapsiGold: "تپسی‌گلد", Invi: "اینوی", Myshemsh: "مای‌شمش", Gerami: "گرمی", "Snapp Sarmayeh": "اسنپ سرمایه", Zarpin: "زرپین", Daric: "داریک", Zarafza: "زرافزا", Zarpay: "زرپی" };
      const available = prices.filter((price) => price.site).map((price) => price.site).sort();
      if (!available.length) return;
      site.replaceChildren(...available.map((name) => { const option = document.createElement("option"); option.value = name; option.textContent = names[name] || name; return option; }));
      site.value = available.includes(previous) ? previous : available[0];
      if (site.dataset.ready !== "true") { site.dataset.ready = "true"; load(); }
    } catch (_) { /* Keep the last usable provider selection while the regular dashboard retries. */ }
  }
  site.addEventListener("change", load); side.addEventListener("change", load);
  document.querySelectorAll("[data-history-range]").forEach((button) => button.addEventListener("click", () => {
    range = button.dataset.historyRange;
    document.querySelectorAll("[data-history-range]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    load();
  }));
  document.getElementById("grams").addEventListener("change", load);
  updateSites(); setInterval(updateSites, 30000); setInterval(load, 60000);
})();
