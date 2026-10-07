# WallGold scraper report

Date: 2026-10-06

## What was added

The original eight-site list already had scraper code for Milli, Talano, Goldika, Talasea, Taline, MelliGold, and HamrahGold. WallGold was the missing site. An empty `internal/wallgold.go` file declared a separate package but did not fetch data, so I removed that stub and added the working scraper in `internal/scraper/wallgold.go`.

The new `WallGoldScraper`:

1. Calls WallGold's public prices endpoint: <https://api.wallgold.ir/api/v1/prices>.
2. Selects the 18-karat gold symbol `GLD_18C_750TMN` and reads its `buy` and `sell` sides.
3. Calls WallGold's markets endpoint: <https://api.wallgold.ir/api/v1/markets> and reads `otcFeeCoefficient` for that symbol.
4. Returns the values using the existing `Price` and `Fee` types. The coefficient is stored as a fraction, so `0.005` means 0.5%.

The scraper accepts price values encoded as JSON numbers or strings. If the price endpoint fails or omits either side, it returns an error. If only the separate markets/fee request fails or has an unreadable coefficient, it still returns the prices and leaves the fee unknown. The main program registers WallGold with the same 30-second polling loop as the other HTTP scrapers.

The code comments added for this work use the `// /\\` marker requested earlier.

## Files changed

- `internal/scraper/wallgold.go` — added the WallGold API scraper.
- `cmd/scraper/main.go` — registered WallGold with the dashboard's polling loop.
- `internal/wallgold.go` — removed the empty package stub so there is only one WallGold implementation.
- `WALLGOLD_SCRAPER_REPORT.md` — this report.

## Potential problems and limits

- **The API response shape can change.** The scraper expects a `result` array with `symbol`, `side`, and `price` entries, and a markets `result` array with `symbol` and `otcFeeCoefficient`. It reports missing buy/sell prices as an error instead of silently publishing zero.
- **The fee is the published structural coefficient.** WallGold also has an amount-specific order-fee endpoint, and the actual checkout amount can vary with promotions or minimum fees. This scraper does not know the user's intended order amount, so it cannot calculate an order-specific fee. Zarscope's WallGold review also describes the structural 0.5% rate and a temporary zero-buy-fee campaign; check the order preview when exact current fees matter: <https://zarscope.com/platforms/wallgold>.
- **No source timestamp is used.** The public price records do not provide a timestamp in the shape this scraper consumes, so `Timestamp` records when this program fetched the quote.
- **Price meaning follows WallGold's API labels.** The scraper assigns the API's `buy` side to `Price.Buy` and `sell` to `Price.Sell`; if WallGold changes what those labels mean from the customer's point of view, the labels may need to be swapped.
- **The markets request is optional.** A fee endpoint outage does not discard good prices. The dashboard will show the fee as unknown for that update.
- **Live endpoint verification was unavailable during this edit.** The browsing tool could not open the WallGold API endpoints, and shell DNS access is restricted in this environment. The endpoints and fields were taken from the earlier site/API inspection in this conversation. I compiled the scraper successfully, but could not run it against WallGold or test its live response here.

## Reference endpoints

- Prices: <https://api.wallgold.ir/api/v1/prices>
- Markets and fee coefficient: <https://api.wallgold.ir/api/v1/markets>
- Amount-specific OTC fee: <https://api.wallgold.ir/api/v1/orders/otc-order-fee?symbol=GLD_18C_750TMN&side=buy&orderAmount=100000>

## Dashboard and additional providers — 2026-10-06

### Why sites were missing from the page

The original dashboard only listed entries that had already produced a successful `Price`. A network error, a rejected request, or a still-connecting WebSocket therefore made the site disappear. This was why the page could show fewer sites than the configured scraper set.

`cmd/scraper/main.go` now creates a row for every configured provider at startup. Each row remains visible while it is waiting for its first successful response. `Price.Available`, added in `internal/scraper/scraper.go`, lets the page distinguish a missing price from a real zero.

`cmd/scraper/index.html` now renders two rankings:

- Buy prices, ascending.
- Sell prices, ascending. The lowest sell price is green and the highest is red.

These colours only compare the displayed quote. They do not calculate an order total after an amount-specific fee, a minimum fee, a campaign, or delivery costs.

### New scrapers

| Provider | Code | Source | Fee stored |
| --- | --- | --- | --- |
| TapsiGold | `internal/scraper/tapsi.go` | MelliGold public price endpoint, because TapsiGold is backed by MelliGold | 0.5% each side, inherited from the MelliGold scraper |
| Snapp Sarmayeh | `internal/scraper/snappsarmayeh.go` | `https://snappsarmayeh.ir/wp-json/snapp-sarmayeh-market/v1/prices` | 1% each side |
| Daric | `internal/scraper/zarscope.go` | Zarscope public gold sources feed | Parsed from the current Zarscope fee label; observed 0.25% each side |
| Invi | `internal/scraper/zarscope.go` | Zarscope public gold sources feed | Parsed from the current Zarscope fee label; observed 1% each side |
| Digi Gold | `internal/scraper/zarscope.go` | Zarscope public gold sources feed | Parsed from the current Zarscope fee label; observed 0.5% each side |
| Zarpin | `internal/scraper/zarscope.go` | Zarscope public gold sources feed | Parsed from the current Zarscope fee label; observed 0.5% each side |

The fallback endpoint is `https://api.zarscope.com/api/sources/?metal=gold`. It returns each platform's raw buy and sell price in rial, fee labels, timestamp, and stale status. The fallback scraper converts rials to toman before returning the app's `Price` value. It refuses a stale or non-positive quote.

### Important limits

- Daric, Invi, Digi Gold, and Zarpin are using the allowed Zarscope fallback because I could not identify a stable, unauthenticated first-party price endpoint for each one from their public pages. Their price and fee can therefore lag behind the provider's own checkout screen.
- TapsiGold may fail whenever the shared MelliGold endpoint redirects or changes its response. Its row will remain visible as waiting rather than disappear.
- Snapp Sarmayeh's endpoint publishes a single reference price, not separate buy and sell prices. The scraper puts that same price in both columns and reports the published 1% fee separately.
- Rankings use raw displayed price. A rate fee, a fixed fee, an account-tier fee, and temporary promotions can change which provider is cheapest for a particular order amount.
- Zarscope's fee labels are deliberately parsed conservatively. An unfamiliar label is shown as an unknown fee instead of being guessed.

All code added for this update uses the `// /\\` comment marker where a comment explains an implementation decision.

---

# Follow-up changes: trustworthy quote freshness and fee-aware comparisons

Date: 2026-10-06

This section records the changes made after the initial project review. The earlier report above is kept as history; the notes below describe the current behavior.

## 1. Old quotes become visibly stale

The server records `FetchedAt` whenever it accepts a quote. This is the time *our program* got the response. `Timestamp` is kept separately for the source's quote time, when a source provides one. That distinction matters: a quote can have been fetched just now while the source itself says it is old, or a source may not publish a quote time at all.

The API computes `Stale` when a quote has not been fetched for more than 90 seconds. Polling normally happens every 30 seconds, so this allows a missed refresh while still making a broken scraper apparent. A failed refresh leaves the last good price available for inspection, but it ages into the stale group and is excluded from current rankings. The dashboard shows the source quote time and our fetch time separately.

## 2. Rankings include the known fees

The dashboard now has an order-size field in grams, initially 1 gram. For a buy estimate it calculates `unit price × grams × (1 + percentage fee) + fixed fee`. For a sell estimate it calculates `unit price × grams × (1 - percentage fee) - fixed fee`. Lower estimated buy cost wins; higher estimated sell proceeds wins.

Fixed fees are treated as one charge per order. This gives fixed fees a concrete meaning for the estimate, but actual providers may have minimums, tier rules, promotions, or fees that depend on order value in a more complex way. Quotes with an unknown fee remain visible, but are marked “Not ranked: fee unknown” and do not receive best/worst highlighting. Talasea's fee is treated as already included in its buy/sell values, so it is not added a second time.

Talano's previously ignored `buyFee` and `sellFee` fields are now carried into the quote when their values are between 0 and 1. The implementation assumes those values are fractional rates (for example, 0.005 means 0.5%). This assumption needs confirmation against Talano's API documentation or a known checkout example before treating those estimates as exact. An invalid/out-of-range value becomes unknown instead of being used.

## 3. The quote source is exposed

Each quote now includes a `Source` label, displayed under the site name. The directly polled providers identify their first-party source; Zarscope-sourced providers identify the fallback feed. MelliGold and TapsiGold preserve the fallback label when their direct request fails and Zarscope supplies the quote. This lets users see when a listed platform's number is collected elsewhere.

## 4. Invalid prices and missing source times are not disguised

Before storing a quote, the server rejects a missing site name or a buy/sell value of zero or less. Invalid fee values (negative rates, rates above 100%, or negative fixed fees) are discarded as unknown while the otherwise-valid price is retained. These are final guards shared by all HTTP scrapers and the HamrahGold WebSocket, so malformed data cannot replace a good price with zero or produce a nonsensical fee estimate.

For sources that do not publish a quote timestamp, the scraper now leaves `Timestamp` empty. The API's `FetchedAt` still shows when we received it. The dashboard says when source quote time is unavailable rather than presenting our fetch time as if the provider supplied it. Existing parsers that require a timestamp still return errors or use their documented fallback behavior; this update does not prove that every provider's timestamp format or currency unit is correct.

## 5. Fee display and comparison behavior

The fee display differentiates unknown fees from a known zero fee. Known percentage and fixed fees are included in the estimate; an absent fee is not guessed. Current highlights only compare fresh quotes with known fee treatment. The estimate is an aid for comparing the scraped data, not a checkout guarantee: provider-specific minimums, campaigns, account tiers, delivery, and other order rules are not represented.

## Files changed in this follow-up

- `internal/scraper/scraper.go` — added source, fetch time, and stale fields to the shared quote model.
- `cmd/scraper/main.go` — validates quotes before storing them, records fetch time and source labels, and computes the 90-second stale state for API responses.
- `cmd/scraper/index.html` — displays source and quote/fetch times, adds an order-size control, estimates totals after known fees, and excludes stale or unknown-fee quotes from current rankings.
- `internal/scraper/talano.go` — carries through Talano's published buy/sell fee fields when they are within the expected fractional-rate range.
- `internal/scraper/melligold.go` and `internal/scraper/tapsi.go` — preserve whether the quote came from MelliGold directly or Zarscope as fallback.
- `internal/scraper/taline.go`, `internal/scraper/talasea.go`, `internal/scraper/wallgold.go`, `internal/scraper/hamrahgold.go`, `internal/scraper/snappsarmayeh.go`, and `internal/scraper/zarscope.go` — avoid inventing source quote timestamps for sources that do not provide a parseable timestamp.
- `WALLGOLD_SCRAPER_REPORT.md` was renamed to `PROJECT_REVIEW_AND_CHANGELOG.md` so it can hold project-wide history and follow-up notes.

## Remaining accuracy checks

- Confirm Talano's fee units and whether those fees are already included in its returned buy/sell prices.
- Confirm the exact meaning and units of each provider's buy/sell prices. This implementation validates that they are positive but cannot infer a wrong rial/toman conversion from a plausible positive number.
- Provider APIs and fee policies can change. The estimates should be compared against provider checkout previews before being used for an actual order.

---

# Stage 1: PostgreSQL observation storage

Date: 2026-10-07

## What Stage 1 does

The app now opens a PostgreSQL connection pool at startup using the `DATABASE_URL` environment variable. It fails early if the database cannot be reached. The Milli scraper is the pilot: after a successful result passes the existing quote validation and updates the dashboard's in-memory store, the app appends that result to PostgreSQL. The other scrapers still update the dashboard but are not persisted in this stage.

The insert has a five-second context deadline. A context deadline is a time limit attached to one database operation; it prevents a stuck database write from holding the Milli polling goroutine forever. A failed insert is logged, and the dashboard still has the validated in-memory quote. The database error is visible in the app log.

## Schema choices

`migrations/001_create_price_observations.sql` creates `price_observations`. Each row is an immutable observation with provider/source names, buy/sell prices in toman, fee fields, source quote time, and the app's fetch time. There is no uniqueness rule on site/time, because two identical prices fetched at two different times are still two useful observations.

The fee columns are nullable as pairs. `NULL` means the scraper does not know that fee; `0` means it knows the fee is zero. `source_timestamp` can be `NULL` because not every provider gives us one. `fetched_at` is always set by this app. The `(site, fetched_at DESC)` index supports looking up one provider's recent history; indexes speed up reads but add a small amount of work to every insert.

Raw observations are the historical source of truth. Later OHLC candles should be derived from these rows: first price for open, highest for high, lowest for low, and last for close in each interval. No candle table or candle API is added here.

The database stores the normalized `scraper.Price` result, not the original HTTP response body. If upstream payload archival becomes useful, it can be added separately without confusing it with this app-level observation.

## Why pgx and this layer split

The project already had pgx in its module files. `internal/storage/postgres.go` now uses pgx's `pgxpool`, which is a connection pool safe for the concurrent scraper goroutines to share. Direct SQL is used instead of an ORM: this keeps the small append operation and schema visible, and avoids adding a mapping layer before the data model is settled.

The scraper package remains responsible for fetching and parsing provider data. The storage package knows how to connect and write an accepted result. The collector loop connects those two steps. This keeps database details out of individual provider scrapers.

## How to run and check Stage 1

First apply the migration to the local database. Replace the username/password with the credentials configured in your PostgreSQL installation; the database name below is the existing `gold_price_tracker` database:

```sh
export DATABASE_URL='postgres://YOUR_USER:YOUR_PASSWORD@localhost:5432/gold_price_tracker?sslmode=disable'
psql "$DATABASE_URL" -f migrations/001_create_price_observations.sql
```

Then start the app in that shell:

```sh
go run ./cmd/scraper
```

After Milli successfully fetches a quote, query the most recent rows in another terminal:

```sh
psql "$DATABASE_URL" -c "SELECT site, source, buy_toman, sell_toman, fetched_at FROM price_observations ORDER BY fetched_at DESC LIMIT 5;"
```

Wait about 30 seconds and run the query again to see another observation. If Milli's request fails, no row should be added for that failed attempt. Database insert errors appear in the app log.

Run the Go package checks with:

```sh
go test ./...
```

That command compiles and runs the repository's Go tests; it does not prove the database is configured, so the `psql` check above is still needed. Apply the migration before starting the app. The app does not silently create or alter tables on startup.

The storage package also has an opt-in integration test. With `DATABASE_URL` set to the local database connection, run:

```sh
TEST_DATABASE_URL="$DATABASE_URL" go test ./internal/storage -run '^TestSaveObservation$' -v
```

The test writes one uniquely named row, reads it back (including known-versus-unknown fee values), and deletes that row during cleanup. It skips during ordinary `go test ./...` runs unless `TEST_DATABASE_URL` is set.

## Checks completed for this implementation

- Applied the migration to the local `gold_price_tracker` database; PostgreSQL created the table and index successfully.
- Ran an insert inside a transaction and rolled it back to confirm the table accepts a quote without leaving test data.
- Ran `go test ./...` successfully.
- Ran the opt-in pgx integration test successfully against the local database; it verified that the Go storage code inserted and read back the observation.

## Stage 1 files

- `internal/storage/postgres.go` — opens/pings the shared pgx pool, appends a normalized observation, and closes the pool.
- `migrations/001_create_price_observations.sql` — creates the append-only table, data checks, and first history index.
- `cmd/scraper/main.go` — reads `DATABASE_URL`, opens the pool, and persists accepted Milli results with a bounded write context.
- `go.mod` and `go.sum` — pgx becomes a direct dependency of the application; unused ORM dependencies are removed.

## Limits before Stage 2

- Only Milli is persisted as the Stage 1 pilot. The other providers and HamrahGold remain in-memory only.
- Each Milli poll waits for its insert to finish, up to five seconds. This is intentionally simple; a queued writer would be a later design if database latency or throughput requires it.
- The polling interval is approximate: each scraper waits 30 seconds after its previous fetch finishes, so request duration is added to that interval.
- The schema stores the app's normalized observation and assumes the existing scraper values are toman per gram. It does not retain raw upstream payloads or independently verify provider units.

---

# Stage 2: persist every collector result

Date: 2026-10-07

## What changed

Every HTTP polling scraper now saves each successfully fetched and validated quote to `price_observations`, rather than only Milli. The existing polling loop still does the initial request and then waits about 30 seconds between completed refreshes.

HamrahGold uses a WebSocket feed rather than a 30-second HTTP poll. Every valid price event it sends now goes through the same collection path and is appended too. We keep each observation even if its price matches the previous one: repeated readings show how long the price stayed at a value and make the raw history complete.

The common `recordPrice` path validates the result, updates the in-memory dashboard, and writes the normalized observation. This is the small collector boundary: scraper code fetches/parses, storage code writes SQL, and the collector connects them. No scraper-specific database code was added, and there was no schema migration for Stage 2.

## Concurrency and failure behavior

All scraper goroutines share the same pgx pool. A pool is designed for concurrent callers; each insert borrows a database connection and returns it when the operation finishes. At this polling rate, this avoids introducing a separate database writer goroutine and queue before we need one.

HamrahGold already sends observations through a channel with a buffer of ten. The consumer stores each event in order. If database inserts temporarily slow down, that bounded channel fills and applies backpressure to the WebSocket reader instead of growing memory without limit. Each database insert still has a five-second deadline.

The dashboard is updated before the database insert. If persistence fails, the quote remains visible in memory and the error is logged, but that observation is not retried and the history will have a gap. A durable retry queue would need a separate design; this stage keeps the failure visible without adding an unbounded in-memory queue that could lose data on restart anyway.

## How to check Stage 2

The local database already has the Stage 1 schema; Stage 2 does not require rerunning the migration. Start the app with the same local connection string used for Stage 1:

```sh
export DATABASE_URL='postgres:///gold_price_tracker?host=/tmp'
go run ./cmd/scraper
```

In another terminal, query recent observations grouped by source:

```sh
psql -d gold_price_tracker -c "SELECT site, source, count(*) AS observations, max(fetched_at) AS latest FROM price_observations GROUP BY site, source ORDER BY site, source;"
```

After roughly 30 seconds, the counts for HTTP pollers with successful requests should increase. HamrahGold's count increases when it emits a valid WebSocket update. A provider that is currently unreachable or returning invalid data will not add rows; its error appears in the app log.

Run the normal Go checks and the PostgreSQL integration check as before:

```sh
go test ./...
TEST_DATABASE_URL="$DATABASE_URL" go test ./internal/storage -run '^TestSaveObservation$' -v
```

The storage integration test inserts a uniquely named row, checks it, and cleans it up. It does not start external scrapers.

## Stage 2 files and limits

- `cmd/scraper/main.go` — moved validation, in-memory refresh, and database append into one collector function used by every HTTP poller and HamrahGold.
- No scraper implementation or database schema changed.
- Raw collection now includes every successfully accepted scrape result, subject to database availability. Failed requests, rejected quotes, and failed inserts are logged and do not become historical observations.
- The polling interval remains completion-based: a slow scrape means the next request starts later than 30 seconds after the previous one began.
- OHLC derivation and candle API remain future work; the database continues to store observations only.

---

# Stage 3: derive OHLC candles and expose them through an API

Date: 2026-10-07

## What changed

The new `GET /api/candles` endpoint derives candles from `price_observations` when requested. It returns buy and sell OHLC values for one provider. No derived candle rows are written, so raw observations remain the historical source of truth.

For each bucket, open and close use the first and last rows ordered by `fetched_at`, with the database row ID breaking timestamp ties. High and low use the maximum and minimum values. `observationCount` tells a chart how many stored samples contributed to each candle. The bucket timestamp is the UTC start of the interval.

Supported intervals are `1m`, `5m`, `15m`, `1h`, and `1d`. PostgreSQL's `date_bin` performs the bucketing. The local database is PostgreSQL 18; `date_bin` is available in PostgreSQL 14 and later. The buckets align to UTC using the migration's fixed UTC origin.

## API example

```text
GET /api/candles?site=Milli&interval=5m&from=2026-10-07T09:00:00Z&to=2026-10-07T10:00:00Z&limit=200
```

`site` and `interval` are required. `from` and `to` are optional RFC3339 timestamps; `from` is inclusive and `to` is exclusive. `limit` is optional, defaults to 500, and can range from 1 to 2000. The endpoint selects the newest matching buckets up to the limit, then returns them oldest-to-newest for charting. Supplying a time range is recommended for historical chart requests as the observation history grows.

Each response entry contains `site`, `interval`, `timestamp`, `buy` and `sell` OHLC objects, and `observationCount`. An interval with no observations has no candle entry; the API does not invent candles or fill gaps.

## Database and query concepts

OHLC means **open, high, low, close**: the first observation, maximum, minimum, and last observation inside a time bucket. SQL aggregates calculate these directly from the raw rows. The ordered arrays find the first and last values; ordinary `MAX` and `MIN` find the extremes.

The query reads through the existing `(site, fetched_at DESC)` index and applies the selected interval/range at request time. This is simple and guarantees the candle reflects the observations currently stored. It also means long unbounded history requests do more database work; the time filters and result limit help the API caller bound the response. If chart traffic or data volume grows, we can measure this query and consider cached or materialized candles while keeping raw observations authoritative.

## How to check Stage 3

The opt-in integration test inserts four uniquely named observations into one completed minute, asks the same storage query for a one-minute candle, checks both buy and sell open/high/low/close values, then removes the test rows:

```sh
TEST_DATABASE_URL="$DATABASE_URL" go test ./internal/storage -run '^TestCandles$' -count=1 -v
```

The `-count=1` disables Go's test-result cache, so the database test definitely runs. The full package checks remain:

```sh
go test ./...
```

After starting the app, try the endpoint directly:

```sh
curl 'http://localhost:8080/api/candles?site=Milli&interval=1m&limit=10'
```

The local PostgreSQL integration test for `TestCandles` passed, and `go test ./...` passed. The endpoint itself was not exercised through a running server because that also starts all live provider scrapers.

## Stage 3 files and limits

- `internal/storage/postgres.go` — added OHLC response types and a SQL query that derives candles from observations.
- `internal/storage/postgres_test.go` — verifies first/last ordering, extrema, candle time, and observation count against PostgreSQL.
- `cmd/scraper/main.go` — added `/api/candles`, interval and time-range validation, a result cap, and a request timeout.
- No migration was needed: candles are calculated on demand and are not stored separately.
- Candle time uses app `fetched_at`, not source timestamps, because that is the consistent event timeline available for all providers.
- At the initial Stage 3 implementation, the output included raw buy and sell quotes. The later “include known fees in candle prices” follow-up below updates this behavior.

---

# Follow-up: optional quote timestamps and browser candlestick chart

Date: 2026-10-07

## What changed and why

Some providers do not publish the time when their quote was made. The shared `Price.Timestamp` is now a pointer: a real time is included when a scraper can parse one, and `nil` means “not supplied.” Go's JSON encoder omits that field instead of returning the misleading year-one zero date. PostgreSQL likewise receives `NULL` for the missing source time. `FetchedAt` remains set by our app, so we still know when we collected the quote.

The dashboard now has an interactive candlestick chart using TradingView Lightweight Charts 5.2.1. Choose a site, a time interval, and whether to view its buy or sell quote. The browser calls the existing `/api/candles` endpoint and maps each selected OHLC object into the chart library's `{time, open, high, low, close}` format. The API and PostgreSQL remain responsible for deriving candles; the chart library only draws them. It requests at most 500 newest candles and refreshes every 30 seconds.

Lightweight Charts is loaded as a pinned standalone script from unpkg, so the Go app does not need a JavaScript build step. That means a browser needs internet access to download the library. The TradingView attribution logo is enabled, and the required notice is included in the page source.

## How to check it

Restart the Go app so it serves the updated page and quote model, then visit `http://localhost:8080`. Pick a provider with stored observations; the chart should show its available candles. Changing site, interval, or buy/sell reloads that series. The API can also be checked directly:

```sh
curl 'http://localhost:8080/api/candles?site=Milli&interval=1m&limit=10'
curl 'http://localhost:8080/api/prices'
```

Providers without a source quote time should now omit `timestamp` from their `/api/prices` entry; `fetchedAt` remains present. Providers with parsed source times continue to include `timestamp`.

## Files and concepts

- `internal/scraper/scraper.go` — represents an unavailable source timestamp explicitly as nil.
- Timestamp-aware scrapers and `internal/storage/postgres.go` — pass through known timestamps and store an unknown one as SQL `NULL`.
- `cmd/scraper/index.html` — adds the chart controls, data mapping, refresh behavior, and TradingView attribution.
- This is still raw-observation-first: chart candles are derived on request and no candle rows are written to the database.

## Follow-up: show chart times in Tehran time

Date: 2026-10-07

Lightweight Charts treats bar times as UTC and does not provide a built-in IANA time-zone setting. The dashboard now converts each candle's UTC instant into its `Asia/Tehran` wall-clock equivalent for chart display. It uses the browser's IANA time-zone data for each timestamp, so the offset is chosen for that date instead of being hardcoded as a fixed 3.5 hours. Stored `fetched_at` values and PostgreSQL's UTC candle buckets remain unchanged; only the chart's displayed times are adjusted. The current observation history is recent, so the chart displays the expected Tehran time labels.

To see the change, restart the app and reload the dashboard. This conversion follows the [Lightweight Charts time-zone guidance](https://tradingview.github.io/lightweight-charts/docs/next/time-zones).

---

# Follow-up: include known fees in candle prices

Date: 2026-10-07

## What was wrong

The candle query originally grouped the raw buy and sell quotes. The comparison table applies known fees, so a provider such as MelliGold—with the same raw quote on both sides and a 0.5% fee on each side—looked different in the table but identical in the chart.

## What changed

The candle query now adjusts each raw observation for the applicable fee **before** it calculates open, high, low, and close. It uses the selected order size from the dashboard:

```text
buy effective per gram  = raw buy × (1 + rate) + fixed fee ÷ grams
sell effective per gram = raw sell × (1 - rate) - fixed fee ÷ grams
```

If the provider says the fee is already included, the raw quote is used unchanged. If the fee is unknown, that observation also remains raw; the API identifies incomplete fee coverage and the chart says so. This avoids pretending an unknown fee is zero. Effective values are rounded to whole toman per gram, matching the underlying price unit. The database still stores the original quote and fee separately; only the requested candle view is adjusted.

The candle API accepts optional `grams` (default `1`, allowed range `0.001`–`10000`). The chart sends the same order-size value used by the price comparison table, and changing grams refreshes both views. For a provider with known fees, buy and sell candles can now differ even when their raw quotes match.

## How to check

Restart the app, choose MelliGold (displayed as `MelliGold`), and compare its buy and sell candles with the order size shown above. The two series should reflect the fee in opposite directions. The API can be queried directly with an explicit size:

```sh
curl 'http://localhost:8080/api/candles?site=MelliGold&interval=1m&limit=10&grams=1'
```

`buyFeesKnown` and `sellFeesKnown` in each response candle indicate whether every observation in that candle had a known or already-included fee. Raw rows remain the source of truth; this change only affects on-demand OHLC calculation and chart presentation.

## Files changed

- `internal/storage/postgres.go` — applies fees to individual observations before aggregation, and returns the order size and fee-coverage flags.
- `cmd/scraper/main.go` — validates and forwards the optional `grams` query parameter.
- `cmd/scraper/index.html` — uses the shared order-size input and labels candles when fee data is incomplete.
- `internal/storage/postgres_test.go` — updates the storage call to include its order size.
