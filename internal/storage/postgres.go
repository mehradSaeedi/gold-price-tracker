package storage

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mehradSaeedi/gold-price-tracker/internal/scraper"
)

// /\ Postgres owns the pool that all scraper goroutines share safely.
type Postgres struct {
	pool *pgxpool.Pool
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
	if !price.Timestamp.IsZero() {
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

// /\ Close releases the pool's connections when the app shuts down.
func (p *Postgres) Close() {
	p.pool.Close()
}
