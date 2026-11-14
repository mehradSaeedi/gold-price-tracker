import { providerDisplayNames } from "./provider-data.js";

export function createChartController({ numberFormat, decimalNumberFormat, displayProviderName }) {
    // /\ TradingView's chart asks this adapter for its supported resolutions and stored bars.
    const supportedResolutions = ["1", "5", "15", "60", "1D"];
    // /\\ Make the chart pane match the surrounding dashboard, including when TradingView restores old preferences.
    const chartOverridesForTheme = (theme = document.documentElement.dataset.theme || "dark") => {
      const light = theme === "light";
      return {
      "paneProperties.background": light ? "#F3F5F8" : "#151B24",
      "paneProperties.backgroundType": "solid",
      "paneProperties.vertGridProperties.color": light ? "#CDD5E0" : "#2A3442",
      "paneProperties.horzGridProperties.color": light ? "#CDD5E0" : "#2A3442",
      "scalesProperties.textColor": light ? "#566276" : "#A7B0BE",
      "scalesProperties.lineColor": light ? "#CDD5E0" : "#2A3442",
      "mainSeriesProperties.candleStyle.upColor": light ? "#16734F" : "#36B37E",
      "mainSeriesProperties.candleStyle.downColor": light ? "#B64C47" : "#E47770",
      "mainSeriesProperties.candleStyle.borderUpColor": light ? "#16734F" : "#36B37E",
      "mainSeriesProperties.candleStyle.borderDownColor": light ? "#B64C47" : "#E47770",
      "mainSeriesProperties.candleStyle.wickUpColor": light ? "#16734F" : "#36B37E",
      "mainSeriesProperties.candleStyle.wickDownColor": light ? "#B64C47" : "#E47770",
      };
    };
    window.addEventListener("dashboard-theme-change", (event) => {
      const theme = event.detail?.theme === "light" ? "light" : "dark";
      if (!widget) return;
      const overrides = chartOverridesForTheme(theme);
      widget.changeTheme(theme).then(() => widget.applyOverrides(overrides)).catch(() => {});
    });
    // /\ Show time-axis labels using the Persian calendar while keeping time ticks in UTC as TradingView expects.
    // const persianAxisFormats = {
    //   Year: new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", timeZone: "UTC" }),
    //   Month: new Intl.DateTimeFormat("fa-IR-u-ca-persian", { month: "short", timeZone: "UTC" }),
    //   DayOfMonth: new Intl.DateTimeFormat("fa-IR-u-ca-persian", { day: "numeric", timeZone: "UTC" }),
    //   Date: new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }),
    //   Time: new Intl.DateTimeFormat("fa-IR-u-ca-persian", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }),
    //   TimeWithSeconds: new Intl.DateTimeFormat("fa-IR-u-ca-persian", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "UTC" }),
    // };
    // /\ TradingView requests an exact history count as well as a time range; cap each request to the API's 2,000-bar limit.
    const maxHistoryBarsPerRequest = 2000;
    const marketMedianSite = "__market_median__";
    const subscriptions = new Map();
    let chartProviderSites = [];
    let excludedStagnantSites = new Set();
    let widget = null;
    let chartInitialized = false;
    let widgetReady = false;
    let displayedSymbol = "";
    const comparisonStudies = new Map();
    let comparisonSyncVersion = 0;
    let chartTypeBeforeComparison = null;
    let priceScaleModeBeforeComparison = null;
    const savedChartsKey = "gold-price-tracker:tradingview-charts:v1";
    const savedStudiesKey = "gold-price-tracker:tradingview-studies:v1";

    // /\ Read the user's current site, buy or sell side, and order size whenever TradingView asks for data.
    function chartSelection() {
      return {
        site: document.getElementById("chart-site").value,
        side: document.getElementById("chart-side").value,
        grams: Math.min(10000, Math.max(0.001, Number(document.getElementById("grams").value) || 1)),
      };
    }

    // /\ Translate TradingView's interval names into the interval names accepted by our candles API.
    function apiInterval(resolution) {
      if (resolution === "1") return "1m";
      if (resolution === "5") return "5m";
      if (resolution === "15") return "15m";
      if (resolution === "60") return "1h";
      if (resolution === "1D" || resolution === "D") return "1d";
      throw new Error("بازه زمانی نمودار پشتیبانی نمی‌شود.");
    }

    // /\ Map the selected controls to a distinct symbol so changing site or fee side reloads the chart.
    function selectedSymbol() {
      const { site, side, grams } = chartSelection();
      if (site === marketMedianSite) return `GPM_MARKET_MEDIAN_BUY_${grams}`;
      // /\\ TradingView gets a plain ASCII key; Persian names stay in the chart's visible title.
      const siteKey = site.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
      return site ? `GPT_${siteKey}_${side.toUpperCase()}_${grams}` : "";
    }

    // /\ Saved chart names carry the selected series, so reopening a layout restores its site and fee side too.
    function selectionForSymbol(symbolName) {
      const marketMedianMatch = /^GPM_MARKET_MEDIAN_BUY_([0-9]+(?:\.[0-9]+)?)$/i.exec(symbolName || "");
      if (marketMedianMatch) return { site: marketMedianSite, side: "buy", grams: Number(marketMedianMatch[1]), marketMedian: true };
      const internalMatch = /^GP(T|C)_(.+)_(BUY|SELL)_([0-9]+(?:\.[0-9]+)?)$/i.exec(symbolName || "");
      if (internalMatch) {
        const site = Object.keys(providerDisplayNames).find((name) =>
          name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") === internalMatch[2].toUpperCase(),
        );
        if (site) return { site, side: internalMatch[3].toLowerCase(), grams: Number(internalMatch[4]), comparison: internalMatch[1].toUpperCase() === "C" };
      }
      const match = /^(.*) · (خرید|فروش|buy|sell) · ([0-9۰-۹٠-٩.٫٬,]+)(?: گرم|g)$/.exec(symbolName || "");
      if (!match) return chartSelection();
      const site = Object.keys(providerDisplayNames).find((name) => providerDisplayName(name) === match[1]) || match[1];
      const grams = match[3].replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
        .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
        .replace(/[٫]/g, ".").replace(/[٬,]/g, "");
      return { site, side: match[2] === "خرید" || match[2] === "buy" ? "buy" : "sell", grams: Number(grams) };
    }

    // /\ Keep TradingView's saved chart layouts in this browser; no chart drawings are sent to PostgreSQL.
    const saveLoadAdapter = {
      async getAllCharts() {
        return JSON.parse(localStorage.getItem(savedChartsKey) || "[]").map(({ id, name, symbol, resolution, timestamp }) => ({ id, name, symbol, resolution, timestamp }));
      },
      async saveChart(chartData) {
        const charts = JSON.parse(localStorage.getItem(savedChartsKey) || "[]");
        const id = chartData.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
        const saved = { ...chartData, id, timestamp: Math.floor(Date.now() / 1000) };
        const index = charts.findIndex((chart) => chart.id === id);
        if (index >= 0) charts[index] = saved;
        else charts.push(saved);
        localStorage.setItem(savedChartsKey, JSON.stringify(charts));
        return id;
      },
      async removeChart(chartId) {
        const charts = JSON.parse(localStorage.getItem(savedChartsKey) || "[]").filter((chart) => chart.id !== chartId);
        localStorage.setItem(savedChartsKey, JSON.stringify(charts));
      },
      async getChartContent(chartId) {
        const chart = JSON.parse(localStorage.getItem(savedChartsKey) || "[]").find((item) => item.id === chartId);
        if (!chart) throw new Error("نمودار ذخیره‌شده در این مرورگر پیدا نشد.");
        return chart.content;
      },
      async getAllStudyTemplates() {
        return JSON.parse(localStorage.getItem(savedStudiesKey) || "[]").map(({ name }) => ({ name }));
      },
      async saveStudyTemplate(template) {
        const templates = JSON.parse(localStorage.getItem(savedStudiesKey) || "[]");
        const index = templates.findIndex((item) => item.name === template.name);
        if (index >= 0) templates[index] = template;
        else templates.push(template);
        localStorage.setItem(savedStudiesKey, JSON.stringify(templates));
      },
      async removeStudyTemplate(template) {
        const templates = JSON.parse(localStorage.getItem(savedStudiesKey) || "[]").filter((item) => item.name !== template.name);
        localStorage.setItem(savedStudiesKey, JSON.stringify(templates));
      },
      async getStudyTemplateContent(template) {
        const saved = JSON.parse(localStorage.getItem(savedStudiesKey) || "[]").find((item) => item.name === template.name);
        if (!saved) throw new Error("الگوی ذخیره‌شده پیدا نشد.");
        return saved.content;
      },
    };

    // /\ Ask the existing endpoint for one requested time range and convert its candles to TradingView bars.
    async function loadBars(selection, resolution, from, to, limit = 2000) {
      if (selection.marketMedian) return loadMarketMedianBars(selection, resolution, from, to, limit);
      const interval = apiInterval(resolution);
      // Keep SQL work proportional to the bars TradingView can display; otherwise its
      // broad initial history request makes the API aggregate years of observations.
      const secondsPerBar = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 }[interval];
      const boundedTo = Number.isFinite(to) ? to : Math.floor(Date.now() / 1000);
      const requestedFrom = Number.isFinite(from) ? from : boundedTo - limit * secondsPerBar;
      const boundedFrom = Math.max(requestedFrom, boundedTo - limit * secondsPerBar);
      const params = new URLSearchParams({
        site: selection.site,
        interval,
        grams: String(selection.grams),
        limit: String(limit),
        from: new Date(boundedFrom * 1000).toISOString(),
        to: new Date(boundedTo * 1000).toISOString(),
      });
      const response = await fetch(`/api/candles?${params}`);
      if (!response.ok) throw new Error(`خطای سرور ${numberFormat.format(response.status)} هنگام دریافت کندل‌ها`);
      const candles = await response.json();
      if (!Array.isArray(candles)) throw new Error("پاسخ API کندل‌ها قالب معتبری ندارد.");
      const bars = candles.map((candle) => ({
        time: Date.parse(candle.timestamp),
        open: candle[selection.side].open,
        high: candle[selection.side].high,
        low: candle[selection.side].low,
        close: candle[selection.side].close,
      })).filter((bar) => Number.isFinite(bar.time));
      return { bars, candles, interval };
    }

    // Build the TradingView market series from the same fee-aware provider candles used by the range widget.
    function median(values) {
      const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }
    function robustMedian(values) {
      const valid = values.filter(Number.isFinite);
      if (valid.length < 3) return null;
      const center = median(valid), mad = median(valid.map(value => Math.abs(value - center)));
      const filtered = mad === 0
        ? valid.filter(value => value === center)
        : valid.filter(value => Math.abs(value - center) <= 4.5 * 1.4826 * mad);
      return filtered.length < 3 ? null : median(filtered);
    }
    async function loadMarketMedianBars(selection, resolution, from, to, limit) {
      const interval = apiInterval(resolution);
      const secondsPerBar = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 }[interval];
      const boundedTo = Number.isFinite(to) ? to : Math.floor(Date.now() / 1000);
      const requestedFrom = Number.isFinite(from) ? from : boundedTo - limit * secondsPerBar;
      const boundedFrom = Math.max(requestedFrom, boundedTo - limit * secondsPerBar);
      const eligibleSites = chartProviderSites.filter(site => !excludedStagnantSites.has(site));
      if (!eligibleSites.length) return { bars: [], candles: [], interval };
      const responses = await Promise.allSettled(eligibleSites.map(async site => {
        const params = new URLSearchParams({
          site, interval, grams: String(selection.grams), limit: String(limit),
          from: new Date(boundedFrom * 1000).toISOString(),
          to: new Date(boundedTo * 1000).toISOString(),
        });
        const response = await fetch(`/api/candles?${params}`);
        if (!response.ok) throw new Error(`خطای دریافت کندل ${displayProviderName(site)}`);
        const candles = await response.json();
        if (!Array.isArray(candles)) throw new Error("قالب کندل بازار معتبر نیست.");
        return candles;
      }));
      const byTime = new Map();
      for (const result of responses) {
        if (result.status !== "fulfilled") continue;
        for (const candle of result.value) {
          const timestamp = Date.parse(candle.timestamp);
          const buy = candle.buy || {};
          const values = [buy.open, buy.high, buy.low, buy.close].map(Number);
          const [open, high, low, close] = values;
          if (!candle.buyFeesKnown || !Number.isFinite(timestamp) || !values.every(Number.isFinite)
            || low <= 0 || high < low || open < low || open > high || close < low || close > high) continue;
          if (!byTime.has(timestamp)) byTime.set(timestamp, []);
          byTime.get(timestamp).push({ open, high, low, close });
        }
      }
      const candles = [];
      for (const [time, rows] of byTime) {
        const candle = { time };
        let complete = true;
        for (const field of ["open", "high", "low", "close"]) {
          const value = robustMedian(rows.map(row => row[field]));
          if (value == null) { complete = false; break; }
          candle[field] = value;
        }
        if (!complete || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) continue;
        candles.push(candle);
      }
      candles.sort((a, b) => a.time - b.time);
      return { bars: candles, candles, interval };
    }

    // /\ Keep this widget datafeed small: all historical data still comes from our PostgreSQL-backed API.
    const datafeed = {
      onReady(callback) {
        setTimeout(() => callback({
          supported_resolutions: supportedResolutions,
          supports_search: false,
          supports_group_request: false,
          supports_marks: false,
          supports_timescale_marks: false,
          supports_time: false,
        }), 0);
      },
      searchSymbols(_userInput, _exchange, _symbolType, callback) {
        callback([]);
      },
      resolveSymbol(symbolName, onResolve) {
        const selection = selectionForSymbol(symbolName);
        const { site, side, grams } = selection;
        if (!site) {
          document.getElementById("chart-status").textContent = "برای نمایش نمودار، ابتدا دریافت قیمت یک ارائه‌دهنده را منتظر بمانید.";
          return;
        }
        if (!selection.comparison && !selection.marketMedian) {
          const siteSelect = document.getElementById("chart-site");
          if ([...siteSelect.options].some((option) => option.value === site)) siteSelect.value = site;
          document.getElementById("chart-side").value = side;
          document.getElementById("grams").value = String(grams);
        }
        setTimeout(() => onResolve({
          name: selection.marketMedian ? "میانه بازار · خرید" : site ? `${displayProviderName(site)} · ${side === "buy" ? "خرید" : "فروش"}` : "قیمت طلا",
          full_name: selection.marketMedian ? `میانه بازار طلای ۱۸ عیار · خرید · ${decimalNumberFormat.format(grams)} گرم` : site ? `${displayProviderName(site)} · ${side === "buy" ? "خرید" : "فروش"} · ${decimalNumberFormat.format(grams)} گرم` : "قیمت طلا",
          ticker: symbolName,
          description: "قیمت هر گرم طلای ۱۸ عیار به تومان",
          type: "commodity",
          session: "24x7",
          timezone: "Asia/Tehran",
          exchange: "GPT",
          listed_exchange: "GPT",
          format: "price",
          minmov: 1,
          pricescale: 1,
          has_intraday: true,
          has_daily: true,
          has_weekly_and_monthly: false,
          supported_resolutions: supportedResolutions,
          volume_precision: 0,
          data_status: "streaming",
        }), 0);
      },
      async getBars(_symbolInfo, resolution, rangeOrFrom, toOrOnResult, resultOrError, errorOrFirstCall, legacyFirstCall) {
        let from;
        let to;
        let countBack = maxHistoryBarsPerRequest;
        let onResult;
        let onError;
        let isFirstCall;
        if (rangeOrFrom && typeof rangeOrFrom === "object") {
          ({ from, to, countBack = maxHistoryBarsPerRequest } = rangeOrFrom);
          onResult = toOrOnResult;
          onError = resultOrError;
          isFirstCall = rangeOrFrom.firstDataRequest;
        } else {
          from = rangeOrFrom;
          to = toOrOnResult;
          onResult = resultOrError;
          onError = errorOrFirstCall;
          isFirstCall = legacyFirstCall;
        }
        const selection = selectionForSymbol(_symbolInfo.ticker || _symbolInfo.name);
        if (!selection.site && !selection.marketMedian) {
          onResult([], { noData: true });
          return;
        }
        try {
          let { bars } = await loadBars(
            selection, resolution, from, to, maxHistoryBarsPerRequest,
          );
          const requiredBars = Number.isFinite(countBack)
            ? Math.min(maxHistoryBarsPerRequest, Math.max(1, Math.ceil(countBack)))
            : maxHistoryBarsPerRequest;
          const missingBars = Math.max(0, requiredBars - bars.length);
          if (missingBars > 0 && Number.isFinite(from)) {
            // /\ If the visible time window is sparse, ask the API for the missing older bars before it starts.
            const earlier = await loadBars(selection, resolution, null, from, missingBars);
            const firstRequestedTime = bars.length ? bars[0].time : Infinity;
            const earlierBars = earlier.bars.filter((bar) => bar.time < firstRequestedTime);
            bars = [...earlierBars, ...bars];
          }
          if (isFirstCall && bars.length === 0) {
            ({ bars } = await loadBars(selection, resolution, null, null));
          }
          if (selection.marketMedian) {
            document.getElementById("chart-status").textContent = bars.length
              ? ""
              : "برای این بازه، کندل معتبر از دست‌کم سه پلتفرم پیدا نشد.";
          }
          onResult(bars, { noData: bars.length === 0 });
        } catch (error) {
          onError(error.message || "دریافت داده‌های نمودار ناموفق بود.");
        }
      },
      subscribeBars(_symbolInfo, resolution, onTick, listenerGuid) {
        const selection = selectionForSymbol(_symbolInfo.ticker || _symbolInfo.name);
        const interval = apiInterval(resolution);
        const intervalSeconds = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 }[interval];
        const refresh = async () => {
          if (!selection.site && !selection.marketMedian) return;
          const now = Math.floor(Date.now() / 1000);
          try {
            const { bars } = await loadBars(selection, resolution, now - intervalSeconds * 3, now + intervalSeconds, 1);
            if (bars.length) onTick(bars[bars.length - 1]);
          } catch (_) {
            // Live refresh failures are transient; don't replace the chart with noisy status text.
          }
        };
        const timer = setInterval(refresh, 30000);
        subscriptions.set(listenerGuid, timer);
      },
      unsubscribeBars(listenerGuid) {
        clearInterval(subscriptions.get(listenerGuid));
        subscriptions.delete(listenerGuid);
      },
    };

    // /\ Start the hosted TradingView widget and let its own toolbar handle intervals and drawing tools.
    function initializeChart() {
      if (chartInitialized) return;
      if (document.getElementById("chart-panel").hidden) return;
      if (!window.TradingView?.widget) {
        document.getElementById("chart-status").textContent = "کتابخانه نمودار بارگذاری نشده است؛ نشانی فایل‌های نمودار را بررسی کنید.";
        return;
      }
      const symbol = selectedSymbol();
      if (!symbol) return;
      try {
      widget = new TradingView.widget({
        container: "candle-chart",
        library_path: "/charting_library/",
        datafeed,
        symbol,
        interval: "5",
        locale: "fa",
        timezone: "Asia/Tehran",
        // /\ Convert Gregorian time-axis dates to Persian-calendar labels without changing the candle timestamps.
        // custom_formatters: {
        //   tickMarkFormatter(date, tickMarkType) {
        //     const formatter = persianAxisFormats[tickMarkType] || persianAxisFormats.Date;
        //     return formatter.format(date);
        //   },
        // },
        autosize: true,
        theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
        // / Show the drawing toolbar in fullscreen, and leave the rest of the library features at their defaults.
        enabled_features: ["side_toolbar_in_fullscreen_mode"],
        // /\ Hide TradingView search controls; provider comparisons use the dashboard's site picker.
        disabled_features: ["header_symbol_search", "header_compare", "create_volume_indicator_by_default"],
        // / Put commonly used drawing and measuring tools on the chart for one-click access.
        favorites: {
          drawingTools: [
            "LineToolTrendLine",
            "LineToolHorizontalLine",
            "LineToolDateAndPriceRange",
            "LineTool5PointsPattern",
            "LineToolFibRetracement",
          ],
        },
        save_load_adapter: saveLoadAdapter,
        overrides: { ...chartOverridesForTheme(), "mainSeriesProperties.priceAxisProperties.autoScale": true },
        loading_screen: { backgroundColor: document.documentElement.dataset.theme === "light" ? "#F3F5F8" : "#151B24", foregroundColor: document.documentElement.dataset.theme === "light" ? "#805B17" : "#D6A84F" },
      });
      widget.onChartReady(() => {
        // /\\ A saved TradingView preference can restore a light pane, so reapply the dashboard theme after loading.
        const chartTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
        widget.changeTheme(chartTheme)
          .then(() => {
            widget.applyOverrides(chartOverridesForTheme(chartTheme));
            return widget.activeChart().setResolution("5");
          })
          .catch(() => {
            document.getElementById("chart-status").textContent = "تنظیم ظاهر نمودار انجام نشد.";
          })
          .finally(() => {
            widgetReady = true;
            displayedSymbol = symbol;
            try { syncChartSymbol(); } catch (error) {
              document.getElementById("chart-status").textContent = `تنظیم نمودار انجام نشد: ${error.message || error}`;
            }
          });
      });
      chartInitialized = true;
      } catch (error) {
        chartInitialized = false;
        widget = null;
        document.getElementById("chart-status").textContent = `راه‌اندازی نمودار انجام نشد: ${error.message || error}`;
      }
    }

    // /\ Reload the series when the user changes site, buy or sell side, or order size.
    function syncChartSymbol() {
      const selection = chartSelection();
      const sideControl = document.getElementById("chart-side");
      sideControl.disabled = selection.site === marketMedianSite;
      if (selection.site === marketMedianSite) sideControl.value = "buy";
      if (!widgetReady) return;
      const symbol = selectedSymbol();
      if (!selection.site || !symbol) return;
      if (symbol === displayedSymbol) {
        syncComparisonStudies();
        return;
      }
      displayedSymbol = symbol;
      comparisonSyncVersion += 1;
      for (const id of comparisonStudies.values()) {
        try { widget.activeChart().removeEntity(id); } catch (_) {}
      }
      comparisonStudies.clear();
      widget.activeChart().setSymbol(symbol, () => syncComparisonStudies());
    }

    async function syncComparisonStudies() {
      if (!widgetReady) return;
      const version = ++comparisonSyncVersion;
      const chart = widget.activeChart();
      const primary = chartSelection().site;
      const sites = [...new Set([primary, ...[...document.querySelectorAll("#chart-sites input:checked")].map((input) => input.value)])].filter(Boolean);
      const { side, grams } = chartSelection();
      const extraSites = new Set(sites.filter((site) => site !== sites[0]));
      if (extraSites.size) {
        if (chartTypeBeforeComparison === null) chartTypeBeforeComparison = chart.chartType();
        const priceScale = chart.getPanes()[0]?.getMainSourcePriceScale();
        if (priceScaleModeBeforeComparison === null && priceScale) priceScaleModeBeforeComparison = priceScale.getMode();
        if (chart.chartType() !== 2) await chart.setChartType(2);
      } else if (chartTypeBeforeComparison !== null) {
        const previousChartType = chartTypeBeforeComparison;
        chartTypeBeforeComparison = null;
        if (chart.chartType() !== previousChartType) await chart.setChartType(previousChartType);
      }
      if (version !== comparisonSyncVersion) return;
      for (const [site, studyId] of [...comparisonStudies]) {
        if (extraSites.has(site)) continue;
        try { chart.removeEntity(studyId); } catch (_) {}
        comparisonStudies.delete(site);
      }
      for (const site of extraSites) {
        if (version !== comparisonSyncVersion) return;
        if (comparisonStudies.has(site)) continue;
        const siteKey = site.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
        const symbol = `GPC_${siteKey}_${side.toUpperCase()}_${grams}`;
        const priceScale = chart.getPanes()[0]?.getMainSourcePriceScale();
        const priceScaleMode = priceScale?.getMode();
        try {
          const studyId = await chart.createStudy("Compare", true, false, { source: "close", symbol });
          if (version !== comparisonSyncVersion) {
            if (studyId) chart.removeEntity(studyId);
            return;
          }
          if (studyId) comparisonStudies.set(site, studyId);
          // TradingView forces percentage mode when a Compare study is added. Restore the user's current mode
          // immediately, but leave later manual scale changes alone during routine chart refreshes.
          if (priceScale && priceScaleMode !== undefined && priceScale.getMode() !== priceScaleMode) {
            priceScale.setMode(priceScaleMode);
          }
        } catch (_) {
          document.getElementById("chart-status").textContent = `افزودن ${displayProviderName(site)} به نمودار ناموفق بود.`;
        }
      }
      const priceScale = chart.getPanes()[0]?.getMainSourcePriceScale();
      if (!extraSites.size && priceScaleModeBeforeComparison !== null) {
        if (priceScale && priceScale.getMode() !== priceScaleModeBeforeComparison) priceScale.setMode(priceScaleModeBeforeComparison);
        priceScaleModeBeforeComparison = null;
      }
    }

    // /\ Keep the site's dropdown in sync with providers known to the existing live-price API.
    function updateChartSites(prices) {
      excludedStagnantSites = new Set(prices.filter(price => price.unchanged).map(price => price.site));
      const select = document.getElementById("chart-site");
      const host = document.getElementById("chart-sites");
      const sites = [...new Set(prices.map((price) => price.site).filter(Boolean))].sort();
      chartProviderSites = sites;
      const previous = select.value;
      const previousSelection = new Set([...host.querySelectorAll("input:checked")].map((input) => input.value));
      if (!sites.length) return;
      const options = sites.map((site) => {
        const option = document.createElement("option");
        option.value = site;
        option.textContent = displayProviderName(site);
        return option;
      });
      const marketMedianOption = document.createElement("option");
      marketMedianOption.value = marketMedianSite;
      marketMedianOption.textContent = "میانه همه پلتفرم‌ها";
      options.push(marketMedianOption);
      select.replaceChildren(...options);
      select.disabled = false;
      if (previous === marketMedianSite || sites.includes(previous)) select.value = previous;
      else select.value = sites[0];
      host.replaceChildren(...sites.map((site) => {
        const label = document.createElement("label");
        label.className = "chart-site-option";
        const input = document.createElement("input");
        input.type = "checkbox"; input.value = site; input.checked = previousSelection.has(site);
        input.addEventListener("change", () => {
          syncChartSymbol();
        });
        const name = document.createElement("span"); name.textContent = displayProviderName(site);
        label.append(input, name); return label;
      }));
      const availableSelections = new Set([...host.querySelectorAll("input:checked")].map((input) => input.value));
      const count = availableSelections.size;
      document.getElementById("chart-compare-count").textContent = count ? `${count}` : "";
      document.getElementById("chart-compare-trigger").setAttribute("aria-label", count ? `مقایسه سایت‌ها، ${count} سایت انتخاب شده` : "مقایسه سایت‌ها");
      if (!chartInitialized) initializeChart();
      else syncChartSymbol();
    }

    // /\ Keep comparison controls out of the way until the reader chooses to compare sites.
    const compareTrigger = document.getElementById("chart-compare-trigger");
    const compareMenu = document.getElementById("chart-compare-menu");
    function setCompareMenuOpen(open) {
      compareMenu.hidden = !open;
      compareTrigger.setAttribute("aria-expanded", String(open));
    }
    compareTrigger.addEventListener("click", () => setCompareMenuOpen(compareMenu.hidden));
    document.getElementById("chart-compare-close").addEventListener("click", () => {
      setCompareMenuOpen(false);
      compareTrigger.focus();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".chart-compare-wrap")) setCompareMenuOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !compareMenu.hidden) {
        setCompareMenuOpen(false);
        compareTrigger.focus();
      }
    });

    return { updateChartSites, syncChartSymbol, initializeChart, isChartInitialized: () => chartInitialized, marketMedianSite };
}
