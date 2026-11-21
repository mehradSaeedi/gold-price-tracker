package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/mehradSaeedi/gold-price-tracker/internal/scraper"
	"github.com/mehradSaeedi/gold-price-tracker/internal/storage"
)

// /\ Collect a quote the same way for HTTP scrapers and the WebSocket feed: validate it, show it, then append it.
func recordPrice(price scraper.Price, store *priceStore, database pricePersistence) error {
	return recordPriceAt(price, store, database, time.Now)
}

func recordPriceAt(price scraper.Price, store *priceStore, database pricePersistence, nowFn func() time.Time) error {
	price, err := store.set(price)
	if err != nil {
		return fmt.Errorf("invalid quote: %w", err)
	}

	providerLock := store.persistenceLock(price.Site)
	providerLock.Lock()
	defer providerLock.Unlock()
	persistedAt := nowFn()
	store.mu.RLock()
	lastPersistedAt := store.lastPersistedAt[price.Site]
	store.mu.RUnlock()
	if !lastPersistedAt.IsZero() && persistedAt.Sub(lastPersistedAt) < 30*time.Second {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// /\ Save every quote, including repeats, so the history can measure flat periods reliably.
	if err := database.SaveObservation(ctx, price); err != nil {
		return fmt.Errorf("save quote to PostgreSQL: %w", err)
	}
	store.mu.Lock()
	store.lastPersistedAt[price.Site] = persistedAt
	store.mu.Unlock()

	// /\ Recompute the last day's exact-flat time and jumps from the full saved observation history.
	now := persistedAt
	stagnation, err := database.QuoteStagnation(
		ctx,
		price.Site,
		now.Add(-24*time.Hour),
		now,
		staleAfter,
	)
	if err != nil {
		return fmt.Errorf("calculate quote stagnation: %w", err)
	}

	store.setStagnation(price.Site, stagnation)
	return nil
}

// /\ Refresh one site's price in the background and save each accepted result.
func pollPrices(name, source string, fetcher priceFetcher, store *priceStore, health *healthStore, database *storage.Postgres) {
	refresh := func() {
		health.recordAttempt(name, time.Now())

		price, err := fetcher.GetPrice()

		if err != nil {
			health.recordFailure(name, "quote fetch failed", time.Now())
			log.Printf("%s price update failed: %v", name, err)
			return
		}

		if price.Source == "" {
			price.Source = source
		}

		if err := recordPrice(price, store, database); err != nil {
			health.recordFailure(name, "quote processing failed", time.Now())
			log.Printf("%s quote update failed: %v", name, err)
			return
		}

		health.recordSuccess(name, time.Now())
		log.Printf("updated and saved %s prices", price.Site)
	}

	refresh()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		refresh()
	}
}
