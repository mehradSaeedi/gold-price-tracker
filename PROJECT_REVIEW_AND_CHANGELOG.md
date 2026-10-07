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
