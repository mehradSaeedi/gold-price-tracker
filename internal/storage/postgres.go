package storage

import (
	"context"
	"fmt"
	"math"
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

// /\ Candles adjusts each raw quote for its known fees before grouping the values into OHLC buckets.
func (p *Postgres) Candles(ctx context.Context, site, interval string, seconds int64, from, to *time.Time, limit int, grams float64) ([]Candle, error) {
	if seconds <= 0 || limit <= 0 || math.IsNaN(grams) || math.IsInf(grams, 0) || grams < 0.001 || grams > 10000 {
		return nil, fmt.Errorf("candle interval, limit, and order size must be within their allowed ranges")
	}
	intervalValue := fmt.Sprintf("%d seconds", seconds)
	rows, err := p.pool.Query(ctx, `
		WITH bucketed AS (
			SELECT id, site, fetched_at,
			       -- /\ Convert each known fee to its per-gram effect before OHLC picks the extremes.
			       CASE
			         WHEN fee_included_in_price OR buy_fee_rate IS NULL THEN buy_toman
			         ELSE round(buy_toman::numeric * (1::numeric + buy_fee_rate::numeric) + buy_fee_fixed_toman::numeric / $6::numeric)::bigint
			       END AS buy_price,
			       -- /\ Selling subtracts both the percentage and the per-gram share of the fixed fee.
			       CASE
			         WHEN fee_included_in_price OR sell_fee_rate IS NULL THEN sell_toman
			         ELSE round(sell_toman::numeric * (1::numeric - sell_fee_rate::numeric) - sell_fee_fixed_toman::numeric / $6::numeric)::bigint
			       END AS sell_price,
			       -- /\ Tell the chart if any observation had to fall back to an unadjusted quote.
			       (fee_included_in_price OR buy_fee_rate IS NOT NULL) AS buy_fees_known,
			       (fee_included_in_price OR sell_fee_rate IS NOT NULL) AS sell_fees_known,
			       date_bin($1::interval, fetched_at, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS bucket
			FROM price_observations
			WHERE site = $2
			  AND ($3::timestamptz IS NULL OR fetched_at >= $3)
			  AND ($4::timestamptz IS NULL OR fetched_at < $4)
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
		LIMIT $5
	`, intervalValue, site, from, to, limit, grams)
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

// /\ Close releases the pool's connections when the app shuts down.
func (p *Postgres) Close() {
	p.pool.Close()
}
