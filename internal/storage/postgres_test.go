package storage

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/mehradSaeedi/gold-price-tracker/internal/scraper"
)

// /\ TestSaveObservation checks the real pgx insert when TEST_DATABASE_URL points at a migrated test database.
func TestSaveObservation(t *testing.T) {
	connectionString := os.Getenv("TEST_DATABASE_URL")
	if connectionString == "" {
		t.Skip("set TEST_DATABASE_URL to run the PostgreSQL integration check")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	database, err := OpenPostgres(ctx, connectionString)
	if err != nil {
		t.Fatalf("open PostgreSQL: %v", err)
	}
	t.Cleanup(database.Close)

	// /\ A unique test site lets cleanup target only the row made by this test run.
	site := fmt.Sprintf("stage1-test-%d", time.Now().UnixNano())
	fetchedAt := time.Now().UTC().Truncate(time.Microsecond)
	t.Cleanup(func() {
		_, err := database.pool.Exec(context.Background(),
			"DELETE FROM price_observations WHERE site = $1 AND fetched_at = $2", site, fetchedAt)
		if err != nil {
			t.Errorf("remove test observation: %v", err)
		}
	})

	// /\ This sample includes one known fee and one unknown fee to check their different database representations.
	price := scraper.Price{
		Site:      site,
		Source:    "integration test",
		Buy:       1000000,
		Sell:      990000,
		BuyFee:    &scraper.Fee{Rate: 0.005, FixedToman: 5000},
		FetchedAt: fetchedAt,
	}
	if err := database.SaveObservation(ctx, price); err != nil {
		t.Fatalf("save observation: %v", err)
	}

	// /\ Read the saved row back to make sure pgx wrote the values and preserved unknown as SQL NULL.
	var buy, sell, fixed int64
	var rate float64
	var sellFeeUnknown, sourceTimeUnknown bool
	err = database.pool.QueryRow(ctx, `
		SELECT buy_toman, sell_toman, buy_fee_rate, buy_fee_fixed_toman,
		       sell_fee_rate IS NULL, source_timestamp IS NULL
		FROM price_observations
		WHERE site = $1 AND fetched_at = $2
	`, site, fetchedAt).Scan(&buy, &sell, &rate, &fixed, &sellFeeUnknown, &sourceTimeUnknown)
	if err != nil {
		t.Fatalf("read saved observation: %v", err)
	}
	if buy != price.Buy || sell != price.Sell || rate != 0.005 || fixed != 5000 {
		t.Fatalf("saved values differ: buy=%d sell=%d fee_rate=%v fee_fixed=%d", buy, sell, rate, fixed)
	}
	if !sellFeeUnknown || !sourceTimeUnknown {
		t.Fatalf("unknown fee and source time should be SQL NULL: fee_unknown=%t time_unknown=%t", sellFeeUnknown, sourceTimeUnknown)
	}
}

// /\ TestCandles checks OHLC order and extrema against four raw observations in one minute.
func TestCandles(t *testing.T) {
	connectionString := os.Getenv("TEST_DATABASE_URL")
	if connectionString == "" {
		t.Skip("set TEST_DATABASE_URL to run the PostgreSQL integration check")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	database, err := OpenPostgres(ctx, connectionString)
	if err != nil {
		t.Fatalf("open PostgreSQL: %v", err)
	}
	t.Cleanup(database.Close)

	// /\ Put all four readings in a completed UTC minute so the expected candle bucket is stable.
	site := fmt.Sprintf("stage3-test-%d", time.Now().UnixNano())
	bucket := time.Now().UTC().Truncate(time.Minute).Add(-2 * time.Minute)
	t.Cleanup(func() {
		_, err := database.pool.Exec(context.Background(), "DELETE FROM price_observations WHERE site = $1", site)
		if err != nil {
			t.Errorf("remove test observations: %v", err)
		}
	})

	// /\ These values make the first, high, low, and last readings easy to check by eye.
	prices := []scraper.Price{
		{Site: site, Source: "candle integration test", Buy: 110, Sell: 100, FetchedAt: bucket.Add(5 * time.Second)},
		{Site: site, Source: "candle integration test", Buy: 130, Sell: 80, FetchedAt: bucket.Add(15 * time.Second)},
		{Site: site, Source: "candle integration test", Buy: 90, Sell: 120, FetchedAt: bucket.Add(30 * time.Second)},
		{Site: site, Source: "candle integration test", Buy: 120, Sell: 105, FetchedAt: bucket.Add(45 * time.Second)},
	}
	for _, price := range prices {
		if err := database.SaveObservation(ctx, price); err != nil {
			t.Fatalf("save raw observation: %v", err)
		}
	}

	// /\ Ask the normal query for the one-minute range containing the samples.
	candles, err := database.Candles(ctx, site, "1m", 60, &bucket, ptrTime(bucket.Add(time.Minute)), 10, 1)
	if err != nil {
		t.Fatalf("derive candle: %v", err)
	}
	if len(candles) != 1 {
		t.Fatalf("got %d candles, want 1", len(candles))
	}
	candle := candles[0]
	if candle.Buy != (OHLC{Open: 110, High: 130, Low: 90, Close: 120}) {
		t.Errorf("unexpected buy OHLC: %+v", candle.Buy)
	}
	if candle.Sell != (OHLC{Open: 100, High: 120, Low: 80, Close: 105}) {
		t.Errorf("unexpected sell OHLC: %+v", candle.Sell)
	}
	if candle.ObservationCount != 4 || !candle.Timestamp.Equal(bucket) {
		t.Errorf("unexpected candle metadata: count=%d timestamp=%s", candle.ObservationCount, candle.Timestamp)
	}
}

// /\ ptrTime keeps the optional time filters easy to read in the candle test.
func ptrTime(value time.Time) *time.Time {
	return &value
}
