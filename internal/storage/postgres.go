package storage

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mehradSaeedi/gold-price-tracker/internal/scraper"
)

// /\ Postgres owns the pool that all scraper goroutines share safely.
type Postgres struct {
	pool *pgxpool.Pool
}

// /\ OHLC stores the first, highest, lowest, and last price in one candle.
type OHLC struct {
	// /\ Open is the first observed value in this bucket.
	Open int64 `json:"open"`
	// /\ High is the largest observed value in this bucket.
	High int64 `json:"high"`
	// /\ Low is the smallest observed value in this bucket.
	Low int64 `json:"low"`
	// /\ Close is the last observed value in this bucket.
	Close int64 `json:"close"`
}

// /\ Candle keeps buy and sell price history separate for one provider and time bucket.
type Candle struct {
	// /\ Site identifies which provider's observations formed this candle.
	Site string `json:"site"`
	// /\ Interval is the requested bucket size, such as 5m or 1h.
	Interval string `json:"interval"`
	// /\ Timestamp is the UTC start of the bucket, not the time the API responded.
	Timestamp time.Time `json:"timestamp"`
	// /\ Buy contains OHLC values for the provider's buy quote.
	Buy OHLC `json:"buy"`
	// /\ Sell contains OHLC values for the provider's sell quote.
	Sell OHLC `json:"sell"`
	// /\ OrderSizeGrams tells the chart which order size was used to spread fixed fees per gram.
	OrderSizeGrams float64 `json:"orderSizeGrams"`
	// /\ These flags let the dashboard disclose when it had to show a raw quote because the fee was unknown.
	BuyFeesKnown  bool `json:"buyFeesKnown"`
	SellFeesKnown bool `json:"sellFeesKnown"`
	// /\ ObservationCount shows how many raw rows contributed to this candle.
	ObservationCount int64 `json:"observationCount"`
}

// /\\ BestOfferPoint records the most competitive known-fee quote in each time bucket.
type BestOfferPoint struct {
	Timestamp time.Time `json:"timestamp"`
	BuySite   string    `json:"buySite,omitempty"`
	BuyToman  int64     `json:"buyToman,omitempty"`
	SellSite  string    `json:"sellSite,omitempty"`
	SellToman int64     `json:"sellToman,omitempty"`
}

// QuoteStagnation is the exact-flat time and number of price jumps found in a lookback window.
type QuoteStagnation struct {
	FlatSeconds int64
	JumpCount   int64
}

// /\ OpenPostgres checks the connection now, so a bad database URL fails at startup instead of on the first quote.
func OpenPostgres(ctx context.Context, connectionString string) (*Postgres, error) {
	pool, err := pgxpool.New(ctx, connectionString)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Postgres{pool: pool}, nil
}

// /\ SaveObservation appends one accepted quote; it never overwrites an older observation.
func (p *Postgres) SaveObservation(ctx context.Context, price scraper.Price) error {
	var sourceTimestamp any
	if price.Timestamp != nil && !price.Timestamp.IsZero() {
		sourceTimestamp = price.Timestamp
	}

	var buyRate, buyFixed, sellRate, sellFixed any
	if price.BuyFee != nil {
		buyRate = price.BuyFee.Rate
		buyFixed = price.BuyFee.FixedToman
	}
	if price.SellFee != nil {
		sellRate = price.SellFee.Rate
		sellFixed = price.SellFee.FixedToman
	}

	_, err := p.pool.Exec(ctx, `
		INSERT INTO price_observations (
			site, source, buy_toman, sell_toman,
			buy_fee_rate, buy_fee_fixed_toman,
			sell_fee_rate, sell_fee_fixed_toman,
			fee_included_in_price, source_timestamp, fetched_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, price.Site, price.Source, price.Buy, price.Sell,
		buyRate, buyFixed, sellRate, sellFixed,
		price.FeeIncludedInPrice, sourceTimestamp, price.FetchedAt)
	return err
}

// QuoteStagnation adds up exact-flat intervals and counts observed price jumps in the window.
func (p *Postgres) QuoteStagnation(
	ctx context.Context,
	site string,
	windowStart time.Time,
	now time.Time,
	maxGap time.Duration,
) (QuoteStagnation, error) {
	if site == "" || !windowStart.Before(now) || maxGap <= 0 {
		return QuoteStagnation{}, fmt.Errorf("site, time window, and maximum observation gap must be valid")
	}

	var result QuoteStagnation

	err := p.pool.QueryRow(ctx, `
		-- /	Keep one quote before the window so we can compare the first in-window quote too.
		WITH prior AS (
			SELECT id, fetched_at, buy_toman, sell_toman
			FROM price_observations
			WHERE site = $1
				AND fetched_at < $2
			ORDER BY fetched_at DESC, id DESC
			LIMIT 1
		),
		window_rows AS (
			SELECT id, fetched_at, buy_toman, sell_toman
			FROM price_observations
			WHERE site = $1
				AND fetched_at >= $2
				AND fetched_at <= $3
		),
		-- /\ Compare every quote to the one immediately before it, including the saved prior quote.
		sequenced AS (
			SELECT
			fetched_at,
			buy_toman,
			sell_toman,
			LAG(fetched_at) OVER (ORDER BY fetched_at, id) AS previous_at,
			LAG(buy_toman) OVER (ORDER BY fetched_at, id) AS previous_buy,
			LAG(sell_toman) OVER (ORDER BY fetched_at, id) AS previous_sell
			FROM (
				SELECT * FROM prior
				UNION ALL
				SELECT * FROM window_rows
			) observations
		),
		intervals AS (
			-- /\ A matching pair counts as flat only when observations are close enough to trust the interval.
			SELECT
				CASE
					WHEN previous_at IS NOT NULL
					AND buy_toman = previous_buy
					AND sell_toman = previous_sell
					AND fetched_at - previous_at <= $4 * INTERVAL '1 second'
				THEN GREATEST(
					0,
					EXTRACT(
						EPOCH FROM
						LEAST(fetched_at, $3::timestamptz)
						- GREATEST(previous_at, $2::timestamptz)
					)
				)::bigint
				ELSE 0
			END AS flat_seconds,
			CASE
				WHEN previous_at IS NOT NULL
					AND fetched_at >= $2
					AND (buy_toman <> previous_buy OR sell_toman <> previous_sell)
				THEN 1
				ELSE 0
			END AS jump_count
		FROM sequenced

		UNION ALL

		-- /\ Count the still-open flat interval through now when the latest quote is recent.
		SELECT
			CASE
				WHEN $3::timestamptz - latest.fetched_at <= $4 * INTERVAL '1 second'
				THEN GREATEST(
					0,
					EXTRACT(EPOCH FROM $3::timestamptz - GREATEST(latest.fetched_at, $2::timestamptz))
				)::bigint
				ELSE 0
			END AS flat_seconds,
			0 AS jump_count
		FROM (
			SELECT fetched_at
			FROM window_rows
			ORDER BY fetched_at DESC, id DESC
			LIMIT 1
		) latest

	)
	SELECT
		COALESCE(SUM(flat_seconds), 0)::bigint,
		COALESCE(SUM(jump_count), 0)::bigint
	FROM intervals
	`, site, windowStart, now, maxGap.Seconds()).Scan(
		&result.FlatSeconds,
		&result.JumpCount,
	)

	return result, err
}

// /\ Candles adjusts each raw quote for its known fees before grouping the values into OHLC buckets.
func (p *Postgres) Candles(ctx context.Context, site, interval string, seconds int64, from, to *time.Time, limit int, grams float64) ([]Candle, error) {
	if seconds <= 0 || limit <= 0 || math.IsNaN(grams) || math.IsInf(grams, 0) || grams < 0.001 || grams > 10000 {
		return nil, fmt.Errorf("candle interval, limit, and order size must be within their allowed ranges")
	}
	intervalValue := fmt.Sprintf("%d seconds", seconds)
	args := []any{intervalValue, site}
	filters := []string{"site = $2"}
	// Only add a time predicate when its bound exists. Keeping nullable-parameter ORs
	// out of the WHERE clause lets PostgreSQL use the (site, fetched_at) index directly.
	if from != nil {
		args = append(args, *from)
		filters = append(filters, fmt.Sprintf("fetched_at >= $%d", len(args)))
	}
	if to != nil {
		args = append(args, *to)
		filters = append(filters, fmt.Sprintf("fetched_at < $%d", len(args)))
	}
	limitParam := len(args) + 1
	args = append(args, limit)
	gramsParam := len(args) + 1
	args = append(args, grams)
	rows, err := p.pool.Query(ctx, `
		WITH bucketed AS (
			SELECT id, site, fetched_at,
			       -- /\ Convert each known fee to its per-gram effect before OHLC picks the extremes.
			       CASE
			         WHEN fee_included_in_price OR buy_fee_rate IS NULL THEN buy_toman
			         ELSE round(buy_toman::numeric * (1::numeric + buy_fee_rate::numeric) + buy_fee_fixed_toman::numeric / $`+strconv.Itoa(gramsParam)+`::numeric)::bigint
			       END AS buy_price,
			       -- /\ Selling subtracts both the percentage and the per-gram share of the fixed fee.
			       CASE
			         WHEN fee_included_in_price OR sell_fee_rate IS NULL THEN sell_toman
			         ELSE round(sell_toman::numeric * (1::numeric - sell_fee_rate::numeric) - sell_fee_fixed_toman::numeric / $`+strconv.Itoa(gramsParam)+`::numeric)::bigint
			       END AS sell_price,
			       -- /\ Tell the chart if any observation had to fall back to an unadjusted quote.
			       (fee_included_in_price OR buy_fee_rate IS NOT NULL) AS buy_fees_known,
				       (fee_included_in_price OR sell_fee_rate IS NOT NULL) AS sell_fees_known,
				       date_bin($1::interval, fetched_at, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS bucket
			FROM price_observations
			WHERE `+strings.Join(filters, " AND ")+`
		), grouped AS (
			SELECT bucket,
			       (array_agg(buy_price ORDER BY fetched_at, id))[1] AS buy_open,
			       MAX(buy_price) AS buy_high,
			       MIN(buy_price) AS buy_low,
			       (array_agg(buy_price ORDER BY fetched_at DESC, id DESC))[1] AS buy_close,
			       (array_agg(sell_price ORDER BY fetched_at, id))[1] AS sell_open,
			       MAX(sell_price) AS sell_high,
			       MIN(sell_price) AS sell_low,
			       (array_agg(sell_price ORDER BY fetched_at DESC, id DESC))[1] AS sell_close,
			       BOOL_AND(buy_fees_known) AS buy_fees_known,
			       BOOL_AND(sell_fees_known) AS sell_fees_known,
			       COUNT(*) AS observation_count
			FROM bucketed
			GROUP BY bucket
		)
		SELECT bucket, buy_open, buy_high, buy_low, buy_close,
		       sell_open, sell_high, sell_low, sell_close,
		       buy_fees_known, sell_fees_known, observation_count
		FROM grouped
		ORDER BY bucket DESC
		LIMIT $`+strconv.Itoa(limitParam)+`
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	candles := make([]Candle, 0)
	for rows.Next() {
		candle := Candle{Site: site, Interval: interval, OrderSizeGrams: grams}
		if err := rows.Scan(
			&candle.Timestamp,
			&candle.Buy.Open, &candle.Buy.High, &candle.Buy.Low, &candle.Buy.Close,
			&candle.Sell.Open, &candle.Sell.High, &candle.Sell.Low, &candle.Sell.Close,
			&candle.BuyFeesKnown, &candle.SellFeesKnown,
			&candle.ObservationCount,
		); err != nil {
			return nil, err
		}
		candles = append(candles, candle)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// /\ The query finds the newest buckets first to apply the limit; return them chronologically for charting.
	for left, right := 0, len(candles)-1; left < right; left, right = left+1, right-1 {
		candles[left], candles[right] = candles[right], candles[left]
	}
	return candles, nil
}

// /\\ BestOffers finds the cheapest fee-aware buy and highest fee-aware sell quote per bucket.
func (p *Postgres) BestOffers(ctx context.Context, interval string, seconds int64, from, to *time.Time, limit int, grams float64, sites []string) ([]BestOfferPoint, error) {
	if seconds <= 0 || limit <= 0 || math.IsNaN(grams) || math.IsInf(grams, 0) || grams < 0.001 || grams > 10000 {
		return nil, fmt.Errorf("best offer interval, limit, and order size must be within their allowed ranges")
	}
	if len(sites) == 0 {
		return []BestOfferPoint{}, nil
	}
	intervalValue := fmt.Sprintf("%d seconds", seconds)
	rows, err := p.pool.Query(ctx, `
		WITH params AS (
			SELECT $1::interval AS width,
				COALESCE($2::timestamptz, now() - $4 * $1::interval) AS range_start,
				COALESCE($3::timestamptz, now()) AS range_end
		), candidate_buckets AS (
			-- Make only the requested time buckets, then keep the newest limit buckets.
			SELECT generate_series(
				date_bin(width, range_start, TIMESTAMPTZ '2000-01-01 00:00:00+00'),
				date_bin(width, range_end - INTERVAL '1 microsecond', TIMESTAMPTZ '2000-01-01 00:00:00+00'),
				width
			) AS bucket
			FROM params
		), buckets AS (
			SELECT bucket FROM candidate_buckets ORDER BY bucket DESC LIMIT $4
		), sites AS (
			-- Use the app's configured providers instead of scanning historical rows to rediscover them.
			SELECT unnest($6::text[]) AS site
		), latest AS (
			-- For each provider and bucket, fetch its newest quote with an indexed lookup.
			-- This avoids aggregating and sorting every historical observation in the range.
			SELECT buckets.bucket, sites.site,
				CASE WHEN quote.fee_included_in_price THEN round(quote.buy_toman::numeric * $5::numeric)::bigint
				     ELSE round(quote.buy_toman::numeric * (1::numeric + COALESCE(quote.buy_fee_rate, 0)::numeric) * $5::numeric + COALESCE(quote.buy_fee_fixed_toman, 0)::numeric)::bigint END AS buy_total,
				CASE WHEN quote.fee_included_in_price THEN round(quote.sell_toman::numeric * $5::numeric)::bigint
				     ELSE round(quote.sell_toman::numeric * (1::numeric - COALESCE(quote.sell_fee_rate, 0)::numeric) * $5::numeric - COALESCE(quote.sell_fee_fixed_toman, 0)::numeric)::bigint END AS sell_total,
				(quote.fee_included_in_price OR quote.buy_fee_rate IS NOT NULL) AS buy_known,
				(quote.fee_included_in_price OR quote.sell_fee_rate IS NOT NULL) AS sell_known
			FROM buckets
			CROSS JOIN sites
			CROSS JOIN params
			JOIN LATERAL (
				SELECT observation.buy_toman, observation.sell_toman,
				       observation.buy_fee_rate, observation.buy_fee_fixed_toman,
				       observation.sell_fee_rate, observation.sell_fee_fixed_toman,
				       observation.fee_included_in_price
				FROM price_observations AS observation
				WHERE observation.site = sites.site
				  AND observation.fetched_at >= GREATEST(buckets.bucket, params.range_start)
				  AND observation.fetched_at < LEAST(buckets.bucket + params.width, params.range_end)
				ORDER BY observation.fetched_at DESC, observation.id DESC
				LIMIT 1
			) AS quote ON TRUE
		), buys AS (
			-- Ignore providers whose fees are unknown; compare customer-facing totals.
			SELECT DISTINCT ON (bucket) bucket, site, buy_total
			FROM latest WHERE buy_known ORDER BY bucket, buy_total, site
		), sells AS (
			SELECT DISTINCT ON (bucket) bucket, site, sell_total
			FROM latest WHERE sell_known ORDER BY bucket, sell_total DESC, site
		), observed_buckets AS (
			SELECT bucket FROM latest GROUP BY bucket
		)
		SELECT observed_buckets.bucket, COALESCE(buys.site, ''), COALESCE(buys.buy_total, 0),
		       COALESCE(sells.site, ''), COALESCE(sells.sell_total, 0)
		FROM observed_buckets
		LEFT JOIN buys USING (bucket)
		LEFT JOIN sells USING (bucket)
		ORDER BY observed_buckets.bucket ASC
	`, intervalValue, from, to, limit, grams, sites)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	points := make([]BestOfferPoint, 0)
	for rows.Next() {
		var point BestOfferPoint
		if err := rows.Scan(&point.Timestamp, &point.BuySite, &point.BuyToman, &point.SellSite, &point.SellToman); err != nil {
			return nil, err
		}
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return points, nil
}

// /\ Close releases the pool's connections when the app shuts down.
func (p *Postgres) Close() {
	p.pool.Close()
}
