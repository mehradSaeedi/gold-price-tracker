## Quote timestamps and freshness

- `fetchedAt` is when this server accepted the quote.
- `timestamp` is the provider-reported quote time, when available. It may be absent if the provider does not supply one.
- `ageSeconds` is the whole number of seconds since `fetchedAt`, calculated when the API response is generated.
- `stale` is true when no quote is available or the server accepted it more than 90 seconds before the response was generated. This threshold describes current behavior and may change.
- Candle `timestamp` is the UTC start of its interval bucket.

## Providers

### `GET /api/providers`

Returns one entry for each configured provider. This endpoint reports the
collector’s fetch and connection health; it does not certify the provider’s
business status or guarantee that a quote is correct.

Each entry contains:

- `site`: Provider identifier, matching the `site` field in `/api/prices`.
- `available`: Whether a valid quote has been received.
- `stale`: Whether no quote is available or the latest accepted quote is more
  than 90 seconds old.
- `lastAttemptAt`: Time the collector most recently attempted a fetch or
  connection. It is `null` before the first attempt.
- `lastSuccessAt`: Time the collector most recently received and accepted a
  valid quote. It is `null` before the first successful quote.
- `lastError`: A brief, sanitized description of the most recent fetch,
  connection, or quote-processing error. It is omitted when there is no37gg
  recorded error.
- `lastErrorAt`: Time of the most recent recorded error. It is `null` before
  any error and it's always present.
- `consecutiveFailures`: Number of consecutive failed collection attempts. For polling providers, an attempt is one fetch cycle. For streaming providers, an attempt is one connection session. A successful attempt resets the count.

Times are RFC 3339 timestamps. Health data is held in memory and resets when
the service restarts.

## `/api/prices` response fields

Each item in the `GET /api/prices` response describes one configured provider.

- `site`: Provider identifier. Present even before the provider returns its first quote.
- `source`: Name or description of the upstream source used for the quote. It may be empty if no quote has been received.
- `buy`: Customer’s price to buy one gram of 18-karat gold from the provider, in tomans per gram. It is zero before a quote is available.
- `sell`: Amount the customer receives for selling one gram of 18-karat gold to the provider, in tomans per gram. It is zero before a quote is available.
- `buyFee`, `sellFee`: Fee details for the corresponding transaction side. Each is an object with `rate` and `fixedToman`. `rate` is a fraction (`0.005` means 0.5%); `fixedToman` is a fixed amount in tomans. The object is omitted when the fee is unknown. A present object with both values zero means a known zero fee.
- `feeIncludedInPrice`: When `true`, the source quote already includes its fees. This field is omitted when `false`, so an omitted field means fees are not marked as included.
- `change24h`: Provider-reported 24-hour change, when available. It may be omitted.
- `unitType`: Normalized unit identifier, when supplied. It may be omitted; unit metadata is not populated consistently across providers.
- `sourceUnitType`: Provider’s original unit identifier, when supplied. It may be omitted.
- `fetchedAt`: Time this server accepted the latest quote. It is zero time before a quote is available.
- `timestamp`: Provider-reported quote time, when supplied. It may be omitted.
- `ageSeconds`: Whole seconds since `fetchedAt`, calculated when the response is generated. It is zero before a quote is available.
- `flatSeconds`: Total time the quote remained exactly unchanged during the rolling 24-hour analysis window. It is zero when no qualifying flat period has been .
- `jumpCount`: Number of observed buy or sell price changes during that analysis window. It is zero when there are no recorded changes.
- `unchanged`: Whether the quote met the server’s unchanged-price criteria. This is a data-quality signal, not a statement that the provider is unavailable.
- `available`: `true` after a valid quote has been received; otherwise `false`.
- `stale`: `true` when no valid quote is available or the latest accepted quote is more than 90 seconds old.

Fields tagged `omitempty` may be absent from the JSON response. In particular, fee objects, `timestamp`, `change24h`, `unitType`, and `sourceUnitType` are optional. The exact `unchanged` thresholds are implementation details and may change.


## Errors

Errors use a JSON object with a stable machine-readable code and a
human-readable message:

```json
{
  "error": {
    "code": "invalid_parameter",
    "message": "limit must be between 1 and 2000"
  }
}
```

## Historical data

- **Time bounds:** `from` is inclusive and `to` is exclusive. Both filter on when our server fetched the quote (`fetchedAt`).

- **Ordering and limit:** The API selects the newest matching buckets up to `limit`, then returns them in chronological order, oldest first.

### `GET /api/candles`

Returns buy and sell OHLC candles for one provider. The `timestamp` is the UTC
start of the interval bucket. `observationCount` is the number of saved quotes
used to build that candle.

Supported intervals are `1m`, `5m`, `15m`, `1h`, and `1d`. The default limit is
500 and the maximum is 2000. `from` and `to` are RFC 3339 timestamps. `grams`
defaults to 1 and is used when applying fixed fees to prices.

- **Fees in candles:** Prices are adjusted to the customer’s total for the requested `grams` when fee information is known. If a fee is unknown, the raw quote is used; `buyFeesKnown` and `sellFeesKnown` flag whether fees were known for all observations in that candle.

- **Price units:** Candle OHLC values are per-gram prices after fee adjustment. In `/api/best-offers`, `buyToman` and `sellToman` are totals for the requested number of grams.

- **Empty buckets:** Candles omit buckets with no observations. Best offers also omit buckets without any observations from configured providers. If a bucket has observations but no provider with known fees for one side, that side’s `buySite`/`sellSite` is omitted and its price is zero.

**Range defaults:** Candles have no default time bounds; when omitted, the query can include the full available history, subject to `limit`. Best offers default to a range of the newest `limit` intervals ending now.

### `GET /api/best-offers`

Returns the best known-fee buy and sell offer for each interval bucket. `buySite`
and `buyToman` identify where the customer pays the least to buy gold.
`sellSite` and `sellToman` identify where the customer receives the most when
selling gold. `grams` defaults to 1 and affects fixed-fee calculations.

The endpoint uses the same interval, time range, limit, and grams rules as
`/api/candles`.

- **Best-offer selection:** Only providers not marked `unchanged` are considered. Among providers with known fees, the endpoint picks the lowest customer buy total and highest customer sell total per bucket.