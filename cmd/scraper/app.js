    // /\ Use Persian digits for every price while comparing the original numeric values.
    const numberFormat = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
    const decimalNumberFormat = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
    // /\ Keep small price moves visible as a useful percentage while formatting it with Persian digits.
    const movementPercentFormat = new Intl.NumberFormat("fa-IR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    const movementDisplayMs = 5000;
    // /\ These links take users to each provider's trading site or official entry point.
    const providerTradeLinks = {
      "Milli": "https://milli.gold/app/",
      "WallGold": "https://wallgold.ir/app/buy",
      "Talano": "https://talano.ir/",
      "Goldika": "https://goldika.ir/",
      "Talasea": "https://talasea.ir/",
      "Taline": "https://taline.ir/app",
      "MelliGold": "https://melligold.com/",
      "Hamrahgold": "https://hamrahgold.com/",
      "TapsiGold": "https://tapsi.gold/",
      "Invi": "https://invi.ir/",
      "Myshemsh": "https://myshemsh.ir/",
      "Gerami": "https://gerami.com/gold/",
      "Snapp Sarmayeh": "https://app.snappsarmayeh.ir/",
      "Digi Gold": "https://dg.gold/",
      "Zarpin": "https://zarpin.com/",
      "Daric": "https://daric.gold/",
      "Zarafza": "https://zarafza.com/",
      "Zarpay": "https://zarpay24.com/trade-gold",
    };
    // /\ Show familiar Persian provider names while retaining the API's original identifiers internally.
    const providerDisplayNames = {
      Milli: "میلی",
      WallGold: "وال‌گلد",
      Talano: "طلانو",
      Goldika: "گلدیکا",
      Talasea: "طلاسی",
      Taline: "طلاین",
      MelliGold: "ملی‌گلد",
      Hamrahgold: "همراه‌گلد",
      TapsiGold: "تپسی‌گلد",
      Invi: "اینوی",
      Myshemsh: "مای‌شمش",
      Gerami: "گرمی",
      "Snapp Sarmayeh": "اسنپ سرمایه",
      "Digi Gold": "دیجی‌گلد",
      Zarpin: "زرپین",
      Daric: "داریک",
      Zarafza: "زرافزا",
      Zarpay: "زرپی",
    };
    // /\\ Translate the collector's source labels so quote provenance stays understandable in the Persian UI.
    const quoteSourceDisplayNames = {
      "Milli public API": "رابط عمومی میلی",
      "WallGold public API": "رابط عمومی وال‌گلد",
      "Talano public API": "رابط قیمت طلانو",
      "Goldika public API": "رابط عمومی گلدیکا",
      "Talasea public API": "رابط عمومی طلاسی",
      "Taline website": "وب‌سایت طلاین",
      "MelliGold public API": "رابط عمومی ملی‌گلد",
      "MelliGold API or Zarscope fallback": "رابط ملی‌گلد یا زرسکوپ",
      "TapsiGold public API": "رابط عمومی تپسی‌گلد",
      "Invi WebSocket": "داده زنده از ارتباط اینوی",
      "Myshemsh Socket.IO": "داده زنده از ارتباط مای‌شمش",
      "Gerami public API": "رابط عمومی گرمی",
      "Snapp Sarmayeh public API": "رابط عمومی اسنپ سرمایه",
      "Digi Gold public API": "رابط عمومی دیجی‌گلد",
      "Zarpin public API": "رابط عمومی زرپین",
      "Daric public API": "رابط عمومی داریک",
      "Zarafza public API": "رابط عمومی زرافزا",
      "Zarpay public API": "رابط عمومی زرپی",
      "Zarscope public feed": "داده‌های قیمت زرسکوپ",
      "HamrahGold WebSocket": "ارتباط زنده همراه‌گلد",
    };
    // /\ TradingView's chart asks this adapter for its supported resolutions and stored bars.
    const supportedResolutions = ["1", "5", "15", "60", "1D"];
    // /\\ Make the chart pane match the surrounding dashboard, including when TradingView restores old preferences.
    const darkChartOverrides = {
      "paneProperties.background": "#181a1f",
      "paneProperties.backgroundType": "solid",
      "paneProperties.vertGridProperties.color": "#292c32",
      "paneProperties.horzGridProperties.color": "#292c32",
      "scalesProperties.textColor": "#a8abb2",
      "scalesProperties.lineColor": "#3a3d44",
      "mainSeriesProperties.candleStyle.upColor": "#47c78b",
      "mainSeriesProperties.candleStyle.downColor": "#ee777d",
      "mainSeriesProperties.candleStyle.borderUpColor": "#47c78b",
      "mainSeriesProperties.candleStyle.borderDownColor": "#ee777d",
      "mainSeriesProperties.candleStyle.wickUpColor": "#47c78b",
      "mainSeriesProperties.candleStyle.wickDownColor": "#ee777d",
    };
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
    const subscriptions = new Map();
    // /\ Remember the latest direction per provider and side so the last move stays visible between refreshes.
    const quoteMovements = new Map();
    // /\ Start with the best effective buy estimate; each sortable column can choose its own natural direction.
    const sortState = { key: "buyPrice", direction: "asc" };
    let widget = null;
    let chartInitialized = false;
    let widgetReady = false;
    let displayedSymbol = "";
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

    // /\ Show the chart's API interval with a Persian label in the page status.
    function displayInterval(interval) {
      return ({ "1m": "۱ دقیقه", "5m": "۵ دقیقه", "15m": "۱۵ دقیقه", "1h": "۱ ساعت", "1d": "۱ روز" })[interval] || interval;
    }

    // /\ Map the selected controls to a distinct symbol so changing site or fee side reloads the chart.
    function selectedSymbol() {
      const { site, side, grams } = chartSelection();
      // /\\ TradingView gets a plain ASCII key; Persian names stay in the chart's visible title.
      const siteKey = site.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
      return site ? `GPT_${siteKey}_${side.toUpperCase()}_${grams}` : "";
    }

    // /\ Saved chart names carry the selected series, so reopening a layout restores its site and fee side too.
    function selectionForSymbol(symbolName) {
      const internalMatch = /^GPT_(.+)_(BUY|SELL)_([0-9]+(?:\.[0-9]+)?)$/i.exec(symbolName || "");
      if (internalMatch) {
        const site = Object.keys(providerDisplayNames).find((name) =>
          name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") === internalMatch[1].toUpperCase(),
        );
        if (site) return { site, side: internalMatch[2].toLowerCase(), grams: Number(internalMatch[3]) };
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
      const interval = apiInterval(resolution);
      const params = new URLSearchParams({
        site: selection.site,
        interval,
        grams: String(selection.grams),
        limit: String(limit),
      });
      if (Number.isFinite(from)) params.set("from", new Date(from * 1000).toISOString());
      if (Number.isFinite(to)) params.set("to", new Date(to * 1000).toISOString());
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
        const { site, side, grams } = selectionForSymbol(symbolName);
        if (!site) {
          document.getElementById("chart-status").textContent = "برای نمایش نمودار، ابتدا دریافت قیمت یک ارائه‌دهنده را منتظر بمانید.";
          return;
        }
        const siteSelect = document.getElementById("chart-site");
        if ([...siteSelect.options].some((option) => option.value === site)) siteSelect.value = site;
        document.getElementById("chart-side").value = side;
        document.getElementById("grams").value = String(grams);
        setTimeout(() => onResolve({
          name: site ? `${displayProviderName(site)} · ${side === "buy" ? "خرید" : "فروش"}` : "قیمت طلا",
          full_name: site ? `${displayProviderName(site)} · ${side === "buy" ? "خرید" : "فروش"} · ${decimalNumberFormat.format(grams)} گرم` : "قیمت طلا",
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
        if (!selection.site) {
          onResult([], { noData: true });
          return;
        }
        try {
          let { bars, candles, interval } = await loadBars(
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
            const earlierCandles = earlier.candles.filter(
              (candle) => Date.parse(candle.timestamp) < firstRequestedTime,
            );
            bars = [...earlierBars, ...bars];
            candles = [...earlierCandles, ...candles];
          }
          let loadedRecentFallback = false;
          if (isFirstCall && bars.length === 0) {
            ({ bars, candles, interval } = await loadBars(selection, resolution, null, null));
            loadedRecentFallback = bars.length > 0;
          }
          const feeField = `${selection.side}FeesKnown`;
          const notices = [];
          if (loadedRecentFallback) notices.push("آخرین کندل‌های ذخیره‌شده خارج از بازه درخواستی نمایش داده می‌شوند");
          if (candles.length && !candles.every((candle) => candle[feeField])) notices.push("برای برخی داده‌ها کارمزد نامشخص است و نرخ خام نمایش داده می‌شود");
          const noticeText = notices.length ? ` · ${notices.join(" · ")}` : "";
          document.getElementById("chart-status").textContent = bars.length
            ? `${displayProviderName(selection.site)} · ${selection.side === "buy" ? "خرید" : "فروش"} · ${displayInterval(interval)} · سفارش ${decimalNumberFormat.format(selection.grams)} گرم · ${numberFormat.format(bars.length)} کندل · به وقت تهران${noticeText}`
            : `برای ${displayProviderName(selection.site)} در بازه ${displayInterval(interval)} کندلی ذخیره نشده است.${noticeText}`;
          onResult(bars, { noData: bars.length === 0 });
        } catch (error) {
          document.getElementById("chart-status").textContent = error.message || "دریافت کندل‌ها ناموفق بود.";
          onError(error.message || "دریافت داده‌های نمودار ناموفق بود.");
        }
      },
      subscribeBars(_symbolInfo, resolution, onTick, listenerGuid) {
        const selection = selectionForSymbol(_symbolInfo.ticker || _symbolInfo.name);
        const interval = apiInterval(resolution);
        const intervalSeconds = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 }[interval];
        const refresh = async () => {
          if (!selection.site) return;
          const now = Math.floor(Date.now() / 1000);
          try {
            const { bars } = await loadBars(selection, resolution, now - intervalSeconds * 3, now + intervalSeconds, 1);
            if (bars.length) onTick(bars[bars.length - 1]);
          } catch (error) {
            document.getElementById("chart-status").textContent = "به‌روزرسانی زنده نمودار ناموفق بود.";
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
      if (!window.TradingView?.widget) {
        document.getElementById("chart-status").textContent = "کتابخانه نمودار بارگذاری نشده است؛ نشانی فایل‌های نمودار را بررسی کنید.";
        return;
      }
      const symbol = selectedSymbol();
      if (!symbol) return;
      chartInitialized = true;
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
        theme: "dark",
        // / Show the drawing toolbar in fullscreen, and leave the rest of the library features at their defaults.
        enabled_features: ["side_toolbar_in_fullscreen_mode"],
        // / Hide unsupported search/compare controls and the default volume pane; our count is not traded volume.
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
        overrides: { ...darkChartOverrides, "mainSeriesProperties.priceAxisProperties.autoScale": true },
        loading_screen: { backgroundColor: "#181a1f", foregroundColor: "#d0a74e" },
      });
      widget.onChartReady(() => {
        // /\\ A saved TradingView preference can restore a light pane, so reapply the dashboard theme after loading.
        widget.changeTheme("dark")
          .then(() => {
            widget.applyOverrides(darkChartOverrides);
            return widget.activeChart().setResolution("5");
          })
          .catch(() => {
            document.getElementById("chart-status").textContent = "تنظیم ظاهر تیره نمودار انجام نشد.";
          })
          .finally(() => {
            widgetReady = true;
            displayedSymbol = symbol;
            syncChartSymbol();
          });
      });
    }

    // /\ Reload the series when the user changes site, buy or sell side, or order size.
    function syncChartSymbol() {
      if (!widgetReady) return;
      const symbol = selectedSymbol();
      if (!chartSelection().site || !symbol || symbol === displayedSymbol) return;
      displayedSymbol = symbol;
      widget.activeChart().setSymbol(symbol, () => {});
    }

    // /\ Keep the site's dropdown in sync with providers known to the existing live-price API.
    function updateChartSites(prices) {
      const select = document.getElementById("chart-site");
      const sites = [...new Set(prices.map((price) => price.site).filter(Boolean))].sort();
      const previous = select.value;
      if (!sites.length) return;
      select.replaceChildren(...sites.map((site) => {
        const option = document.createElement("option");
        option.value = site;
        option.textContent = displayProviderName(site);
        return option;
      }));
      select.disabled = false;
      if (sites.includes(previous)) select.value = previous;
      else select.value = sites[0];
      if (!chartInitialized) initializeChart();
      else syncChartSymbol();
    }

    // /\ Return the known fee object; a nil value must stay unknown instead of silently becoming zero.
    function feeFor(price, side) {
      return price[`${side}Fee`];
    }

    // /\ Included fees are already in the quote; otherwise the API's known fee object makes the estimate comparable.
    function feeKnown(price, side) {
      return price.feeIncludedInPrice || feeFor(price, side) != null;
    }

    // /\ Preserve the project's existing buy-adds and sell-subtracts fee convention for whole orders.
    function effectiveTotal(price, side, grams) {
      const fee = feeFor(price, side) || { rate: 0, fixedToman: 0 };
      const base = price[side] * grams;
      if (price.feeIncludedInPrice) return base;
      return side === "buy"
        ? base * (1 + fee.rate) + fee.fixedToman
        : base * (1 - fee.rate) - fee.fixedToman;
    }

    // /\\ Rank only current providers whose fee information lets us make a fair total-cost comparison.
    function renderDecisionSummary(prices, grams) {
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
          detail.textContent = "نرخ‌های قدیمی یا کارمزدهای نامشخص رتبه‌بندی نمی‌شوند.";
          continue;
        }
        const winner = candidates[0];
        const winnerAmount = Math.round(effectiveTotal(winner, side, grams));
        const tied = candidates.filter((price) => Math.round(effectiveTotal(price, side, grams)) === winnerAmount);
        heading.textContent = tied.length > 1 ? "بهترین قیمت مشترک" : side === "buy" ? "کمترین هزینه خرید" : "بیشترین دریافتی فروش";
        provider.textContent = tied.length > 1
          ? tied.slice(0, 2).map((price) => displayProviderName(price.site)).join(" و ") + (tied.length > 2 ? ` و ${numberFormat.format(tied.length - 2)} پلتفرم دیگر` : "")
          : displayProviderName(winner.site);
        amount.textContent = formatToman(winnerAmount);
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
          amount.textContent = `+ ${formatToman(roundedDifference)}`;
        } else if (roundedDifference < 0) {
          heading.textContent = "زیان احتمالی";
          amount.classList.add("opportunity-negative");
          amount.textContent = `− ${formatToman(Math.abs(roundedDifference))}`;
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

    // /\ Format toman amounts consistently; the caller always sorts the unformatted numeric value.
    function formatToman(value, decimals = 0) {
      const formatted = decimals ? decimalNumberFormat.format(value) : numberFormat.format(Math.round(value));
      return `${formatted} تومان`;
    }

    // /\ Map the site's stable API key to the Persian name shown to dashboard users.
    function displayProviderName(site) {
      return providerDisplayNames[site] || site || "نامشخص";
    }

    // /\\ Show a Persian source label while preserving unfamiliar source names as a fallback.
    function displayQuoteSource(source) {
      return quoteSourceDisplayNames[source] || source || "نامشخص";
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
    function renderComparisonTable(prices, grams) {
      const usable = prices.filter((price) => price.available && !price.stale && price.buy > 0 && price.sell > 0);
      const bestBuy = Math.min(...usable.filter((price) => feeKnown(price, "buy")).map((price) => effectiveTotal(price, "buy", grams)));
      const bestSell = Math.max(...usable.filter((price) => feeKnown(price, "sell")).map((price) => effectiveTotal(price, "sell", grams)));
      const rows = [...prices].sort((a, b) => {
        const statusOrder = Number(!a.available || a.stale) - Number(!b.available || b.stale);
        if (statusOrder) return statusOrder;
        const comparison = compareNumeric(sortValue(a, sortState.key, grams), sortValue(b, sortState.key, grams), sortState.direction);
        return comparison || displayProviderName(a.site).localeCompare(displayProviderName(b.site), "fa");
      });
      const body = document.getElementById("comparison-rows");
      body.replaceChildren(...rows.map((price) => {
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
          const favicon = document.createElement("img");
          favicon.className = "provider-logo";
          favicon.src = `${new URL(tradeURL).origin}/favicon.ico`;
          favicon.alt = "";
          favicon.setAttribute("aria-hidden", "true");
          favicon.loading = "lazy";
          favicon.addEventListener("error", () => favicon.remove(), { once: true });
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
        const source = document.createElement("span");
        source.className = "source-detail";
        source.textContent = `منبع نرخ: ${displayQuoteSource(price.source)}`;
        providerCell.append(source);
        if (price.stale) {
          const status = document.createElement("span");
          status.className = "mt-1 block text-xs font-normal text-muted stale-status";
          status.textContent = "داده قدیمی";
          providerCell.append(status);
        }
        row.append(providerCell);

        const feeCells = [];
        for (const side of ["buy", "sell"]) {
          const priceCell = document.createElement("td");
          const quote = document.createElement("span");
          quote.className = "quote-line number";
          quote.textContent = usableQuote ? formatToman(price[side]) : "—";
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
          if (effectiveValue != null) {
            effectiveText.className = "effective-line effective-price number";
            effectiveText.textContent = formatToman(effectiveValue);
            if (!price.stale && (side === "buy" ? effectiveValue === bestBuy : effectiveValue === bestSell)) {
              priceCell.classList.add("best-effective");
            }
          } else {
            effectiveText.className = "effective-line";
            effectiveText.textContent = usableQuote ? "مبلغ نهایی: نامشخص" : "در انتظار نرخ";
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
      }));
    }

    async function refreshPrices() {
      const status = document.getElementById("status");
      try {
        const response = await fetch("/api/prices");
        if (!response.ok) throw new Error("پاسخ سرور ناموفق بود.");
        const prices = await response.json();
        // /\ Compare each fresh quote with its previous reading and remember its latest direction.
        for (const price of prices) {
          for (const side of ["buy", "sell"]) {
            if (!price.available || price[side] <= 0) continue;
            const key = `${price.site}:${side}`;
            const previous = quoteMovements.get(key);
            if (!previous) {
              quoteMovements.set(key, { value: price[side], direction: "", changedAt: 0 });
            } else if (price[side] !== previous.value) {
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
        renderDecisionSummary(prices, grams);
        renderComparisonTable(prices, grams);
        const updateTime = new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
        status.textContent = `آخرین به‌روزرسانی: ${updateTime}`;
      } catch (error) {
        status.textContent = "دریافت قیمت‌ها ناموفق بود؛ اتصال سرور را بررسی کنید.";
      }
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
    // /\ Let keyboard and mouse users sort by the real numeric values behind each displayed price or fee.
    document.querySelectorAll("button[data-sort-key]").forEach((button) => {
      button.addEventListener("click", () => chooseSort(button.dataset.sortKey));
    });
    // /\ A provider's chart action selects it in the existing chart and takes the user to that chart.
    document.getElementById("comparison-rows").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-chart-provider]");
      if (!button) return;
      document.getElementById("chart-site").value = button.dataset.chartProvider;
      syncChartSymbol();
      document.getElementById("chart-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("chart-site").addEventListener("change", syncChartSymbol);
    document.getElementById("chart-side").addEventListener("change", syncChartSymbol);
