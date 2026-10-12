    const numberFormat = new Intl.NumberFormat();
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
      "Snapp Sarmayeh": "https://app.snappsarmayeh.ir/",
      "Digi Gold": "https://dg.gold/",
      "Zarpin": "https://zarpin.com/",
      "Daric": "https://daric.gold/",
      "Zarafza": "https://zarafza.com/",
      "Zarpay": "https://zarpay24.com/trade-gold",
    };
    // /\ TradingView's chart asks this adapter for its supported resolutions and stored bars.
    const supportedResolutions = ["1", "5", "15", "60", "1D"];
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
    let widget = null;
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
      throw new Error(`Unsupported chart interval: ${resolution}`);
    }

    // /\ Map the selected controls to a distinct symbol so changing site or fee side reloads the chart.
    function selectedSymbol() {
      const { site, side, grams } = chartSelection();
      return site ? `${site} · ${side} · ${grams}g` : "Gold prices";
    }

    // /\ Saved chart names carry the selected series, so reopening a layout restores its site and fee side too.
    function selectionForSymbol(symbolName) {
      const match = /^(.*) · (buy|sell) · ([\d.]+)g$/.exec(symbolName || "");
      if (!match) return chartSelection();
      return { site: match[1], side: match[2], grams: Number(match[3]) };
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
        if (!chart) throw new Error("Saved chart was not found in this browser");
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
        if (!saved) throw new Error("Saved indicator template was not found in this browser");
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
      if (!response.ok) throw new Error(`Candle API returned HTTP ${response.status}`);
      const candles = await response.json();
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
        const siteSelect = document.getElementById("chart-site");
        if ([...siteSelect.options].some((option) => option.value === site)) siteSelect.value = site;
        document.getElementById("chart-side").value = side;
        document.getElementById("grams").value = String(grams);
        setTimeout(() => onResolve({
          name: site ? `${site} ${side}` : "Gold prices",
          full_name: site ? `${site} ${side} price per gram` : "Gold prices",
          ticker: symbolName,
          description: "18-karat gold price per gram in toman",
          type: "commodity",
          session: "24x7",
          timezone: "Asia/Tehran",
          exchange: "Gold providers",
          listed_exchange: "Gold providers",
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
          if (loadedRecentFallback) notices.push("showing latest stored candles outside the requested range");
          if (candles.length && !candles.every((candle) => candle[feeField])) notices.push("some fees unknown; raw prices used for those readings");
          const noticeText = notices.length ? ` · ${notices.join(" · ")}` : "";
          document.getElementById("chart-status").textContent = bars.length
            ? `${selection.site} · ${selection.side} · ${interval} · ${selection.grams}g order · ${bars.length} candles · Tehran time${noticeText}`
            : `No stored candles found for ${selection.site} (${interval}).${noticeText}`;
          onResult(bars, { noData: bars.length === 0 });
        } catch (error) {
          document.getElementById("chart-status").textContent = `Could not load candles: ${error.message}`;
          onError(error.message);
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
            document.getElementById("chart-status").textContent = `Live candle refresh failed: ${error.message}`;
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
      widget = new TradingView.widget({
        container: "candle-chart",
        library_path: "/charting_library/",
        datafeed,
        symbol: "Gold prices",
        interval: "1",
        locale: "en",
        timezone: "Asia/Tehran",
        // /\ Convert Gregorian time-axis dates to Persian-calendar labels without changing the candle timestamps.
        // custom_formatters: {
        //   tickMarkFormatter(date, tickMarkType) {
        //     const formatter = persianAxisFormats[tickMarkType] || persianAxisFormats.Date;
        //     return formatter.format(date);
        //   },
        // },
        autosize: true,
        theme: "light",
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
        overrides: { "mainSeriesProperties.priceAxisProperties.autoScale": true },
        loading_screen: { backgroundColor: "#ffffff", foregroundColor: "#245b42" },
      });
      widget.onChartReady(() => {
        widgetReady = true;
        syncChartSymbol();
      });
    }

    // /\ Reload the series when the user changes site, buy or sell side, or order size.
    function syncChartSymbol() {
      if (!widgetReady) return;
      const symbol = selectedSymbol();
      if (!chartSelection().site || symbol === displayedSymbol) return;
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
        option.textContent = site;
        return option;
      }));
      select.disabled = false;
      if (sites.includes(previous)) select.value = previous;
      syncChartSymbol();
    }

    function formatFee(fee, included) {
      if (!fee) return "Fee: unknown";
      const parts = [];
      if (fee.rate) parts.push(`${numberFormat.format(fee.rate * 100)}%`);
      if (fee.fixedToman) parts.push(`${numberFormat.format(fee.fixedToman)} toman`);
      if (parts.length === 0) parts.push("0%");
      return `Fee: ${parts.join(" + ")}${included ? " (included in price)" : ""}`;
    }

    function feeKnown(price, feeField) {
      return price.feeIncludedInPrice || price[feeField] != null;
    }

    function effective(price, field, feeField, grams) {
      const fee = price[feeField] || { rate: 0, fixedToman: 0 };
      const base = price[field] * grams;
      if (price.feeIncludedInPrice) return base;
      return field === "buy"
        ? base * (1 + fee.rate) + fee.fixedToman
        : base * (1 - fee.rate) - fee.fixedToman;
    }

    // /\ Turn the first fee-known quote in the already sorted list into the simple customer-facing answer.
    function renderDecisionSummary(field, ranked, feeField, grams) {
      const side = field === "buy" ? "buy" : "sell";
      const heading = document.getElementById(`best-${side}-heading`);
      const provider = document.getElementById(`best-${side}-provider`);
      const amount = document.getElementById(`best-${side}-amount`);
      const detail = document.getElementById(`best-${side}-detail`);
      if (ranked.length === 0) {
        heading.textContent = "No comparable estimate yet";
        provider.textContent = "Waiting for a current quote with known fees";
        amount.textContent = "—";
        detail.textContent = "Quotes with unknown fees are not ranked.";
        return;
      }

      const winner = ranked[0];
      const winnerAmount = Math.round(effective(winner, field, feeField, grams));
      const tied = ranked.filter((price) => Math.round(effective(price, field, feeField, grams)) === winnerAmount);
      heading.textContent = ranked.length === 1
        ? `Only comparable ${side} estimate`
        : tied.length > 1 ? "Tied estimate" : field === "buy" ? "Lowest estimated buy cost" : "Highest estimated sale proceeds";
      provider.textContent = tied.length > 1
        ? `${tied.slice(0, 2).map((price) => price.site).join(" and ")}${tied.length > 2 ? ` + ${tied.length - 2} more` : ""}`
        : winner.site;
      amount.textContent = `${numberFormat.format(winnerAmount)} toman`;
      detail.textContent = `For ${numberFormat.format(grams)} g, including known fees.`;
    }

    function renderRows(target, prices, field, feeField, grams) {
      const usable = prices.filter((price) => price.available && !price.stale && price[field] > 0);
      const ranked = usable.filter((price) => feeKnown(price, feeField));
      const unranked = usable.filter((price) => !feeKnown(price, feeField));
      const pending = prices.filter((price) => !price.available || price.stale || price[field] <= 0);
      ranked.sort((a, b) => field === "buy"
        ? effective(a, field, feeField, grams) - effective(b, field, feeField, grams)
        : effective(b, field, feeField, grams) - effective(a, field, feeField, grams));
      renderDecisionSummary(field, ranked, feeField, grams);
      const body = document.getElementById(target);
      const totals = ranked.map((price) => effective(price, field, feeField, grams));
      const best = field === "buy" ? Math.min(...totals) : Math.max(...totals);
      const worst = field === "buy" ? Math.max(...totals) : Math.min(...totals);
      // /\ Only label a winner and a laggard when there is an actual price difference to distinguish.
      const hasRankSpread = ranked.length > 1 && best !== worst;
      body.replaceChildren(...[...ranked, ...unranked, ...pending].map((price) => {
        const row = document.createElement("tr");
        if (!price.available || price.stale || price[field] <= 0) row.classList.add("pending");
        const total = effective(price, field, feeField, grams);
        const isRankedPrice = ranked.includes(price);
        const isBest = hasRankSpread && isRankedPrice && total === best;
        const isWorst = hasRankSpread && isRankedPrice && total === worst;
        if (isBest) row.classList.add("best");
        if (isWorst) row.classList.add("worst");
        if (price.stale) row.classList.add("stale");
        const quoteDate = price.timestamp ? new Date(price.timestamp) : null;
        const quoteTime = quoteDate && !Number.isNaN(quoteDate.getTime())
          ? `Source quote: ${quoteDate.toLocaleTimeString(undefined, { timeZone: "Asia/Tehran" })}`
          : "Source quote time unavailable";
        const refreshed = price.fetchedAt
          ? `Fetched: ${new Date(price.fetchedAt).toLocaleTimeString(undefined, { timeZone: "Asia/Tehran" })}`
          : "Not fetched yet";
        const site = `${price.site}\n${price.source || "Source unknown"}${price.stale ? " · STALE" : ""}`;
        const unit = price.available && price[field] > 0
          ? `${numberFormat.format(price[field])} toman\n${formatFee(price[feeField], price.feeIncludedInPrice)}\n${quoteTime}\n${refreshed}`
          : "Waiting for price…";
        const estimate = price.available && !price.stale && price[field] > 0
          ? (feeKnown(price, feeField) ? `${numberFormat.format(Math.round(total))} toman` : "Not ranked: fee unknown")
          : "Unavailable";
        const movement = quoteMovements.get(`${price.site}:${field}`);
        const movementIsFresh = movement && Date.now() - movement.changedAt < 1400;
        for (const [index, cellValue] of [site, unit, estimate].entries()) {
          const cell = document.createElement("td");
          cell.className = ["provider-cell", "quote-cell", "estimate-cell"][index];
          if (index === 0) {
            const [provider, source] = cellValue.split("\n");
            const name = document.createElement(providerTradeLinks[provider] ? "a" : "span");
            if (providerTradeLinks[provider]) {
              name.href = providerTradeLinks[provider];
              name.target = "_blank";
              name.rel = "noopener noreferrer";
              name.title = `Open ${provider} trading page in a new tab`;
            }
            name.className = "provider-link";
            name.textContent = provider;
            cell.append(name);
            const sourceLabel = document.createElement("span");
            sourceLabel.className = "provider-source";
            sourceLabel.textContent = source;
            cell.append(sourceLabel);
          } else if (index === 1 && price.available && price[field] > 0) {
            const [amount, fee, quote, fetched] = cellValue.split("\n");
            const value = document.createElement("span");
            value.className = `quote-value${movementIsFresh ? ` quote-${movement.direction}` : ""}`;
            value.textContent = amount;
            cell.append(value);
            if (movement && movement.direction) {
              const direction = document.createElement("span");
              direction.className = `price-direction direction-${movement.direction}${movementIsFresh ? " movement-new" : ""}`;
              direction.textContent = movement.direction === "up" ? "↑ Up" : "↓ Down";
              direction.title = "Direction of the most recent source-price change";
              cell.append(direction);
            }
            const feeLabel = document.createElement("span");
            feeLabel.className = `fee-label${price[feeField] == null && !price.feeIncludedInPrice ? " fee-unknown" : ""}`;
            feeLabel.textContent = fee.replace(/^Fee: /, "Fee · ");
            // /\ Keep fee and source quote time together so both can be read without scanning separate lines.
            const quoteContext = document.createElement("div");
            quoteContext.className = "quote-context";
            quoteContext.append(feeLabel);
            const quoteMeta = document.createElement("span");
            quoteMeta.className = "quote-meta quote-time";
            quoteMeta.textContent = quote;
            quoteContext.append(quoteMeta);
            cell.append(quoteContext);
            const fetchedMeta = document.createElement("span");
            fetchedMeta.className = "quote-meta fetch-time";
            fetchedMeta.textContent = fetched;
            cell.append(fetchedMeta);
          } else if (index === 2) {
            const amount = document.createElement("span");
            amount.className = price.available && !price.stale && price[field] > 0 && feeKnown(price, feeField)
              ? "estimate-value"
              : "estimate-unavailable";
            amount.textContent = cellValue;
            cell.append(amount);
            if (movementIsFresh) cell.classList.add(`quote-${movement.direction}`);
            if (isBest || isWorst) {
              const rankNote = document.createElement("span");
              rankNote.className = `rank-note ${isBest ? "rank-best" : "rank-worst"}`;
              rankNote.textContent = isBest ? "Best" : "Least favorable";
              const rankContext = document.createElement("span");
              rankContext.className = "rank-context";
              rankContext.textContent = isBest
                ? field === "buy" ? "Lowest cost" : "Highest proceeds"
                : field === "buy" ? "Highest cost" : "Lowest proceeds";
              cell.append(rankNote);
              cell.append(rankContext);
            }
          } else {
            cell.textContent = cellValue;
          }
          row.appendChild(cell);
        }
        return row;
      }));
    }

    async function refreshPrices() {
      const status = document.getElementById("status");
      try {
        const response = await fetch("/api/prices");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
                changedAt: Date.now(),
              });
            }
          }
        }
        updateChartSites(prices);
        const grams = Math.min(10000, Math.max(0.001, Number(document.getElementById("grams").value) || 1));
        renderRows("buy-prices", prices, "buy", "buyFee", grams);
        renderRows("sell-prices", prices, "sell", "sellFee", grams);
        status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
      } catch (error) {
        status.textContent = `Could not load prices: ${error.message}`;
      }
    }

    refreshPrices();
    setInterval(refreshPrices, 5000);
    document.getElementById("grams").addEventListener("input", refreshPrices);
    document.getElementById("grams").addEventListener("change", syncChartSymbol);
    initializeChart();
    document.getElementById("chart-site").addEventListener("change", syncChartSymbol);
    document.getElementById("chart-side").addEventListener("change", syncChartSymbol);
