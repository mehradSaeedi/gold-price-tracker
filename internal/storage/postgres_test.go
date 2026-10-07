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
		Timestamp: time.Time{},
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
