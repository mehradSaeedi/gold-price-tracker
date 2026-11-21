package main

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/mehradSaeedi/gold-price-tracker/internal/scraper"
	"github.com/mehradSaeedi/gold-price-tracker/internal/storage"
)

// /\ In-memory prices shared by the scrapers and the dashboard page.
type priceStore struct {
	mu              sync.RWMutex
	prices          map[string]scraper.Price
	persistLocks    map[string]*sync.Mutex
	lastPersistedAt map[string]time.Time
}

type pricePersistence interface {
	SaveObservation(context.Context, scraper.Price) error
	QuoteStagnation(context.Context, string, time.Time, time.Time, time.Duration) (storage.QuoteStagnation, error)
}

func validFee(fee *scraper.Fee) bool {
	return fee == nil || (fee.Rate >= 0 && fee.Rate <= 1 && fee.FixedToman >= 0)
}

func newPriceStore(sites []string) *priceStore {
	prices := make(map[string]scraper.Price, len(sites))
	for _, site := range sites {
		prices[site] = scraper.Price{Site: site}
	}

	return &priceStore{
		prices:          prices,
		persistLocks:    make(map[string]*sync.Mutex),
		lastPersistedAt: make(map[string]time.Time),
	}
}

// /\ Save the newest price for this site.
func (s *priceStore) set(price scraper.Price) (scraper.Price, error) {
	if price.Site == "" || price.Buy <= 0 || price.Sell <= 0 {
		return scraper.Price{}, fmt.Errorf("quote must have a site and positive buy and sell prices")
	}
	if !validFee(price.BuyFee) {
		price.BuyFee = nil
	}
	if !validFee(price.SellFee) {
		price.SellFee = nil
	}
	price.Available = true
	price.FetchedAt = time.Now()
	s.mu.Lock()
	if previous, ok := s.prices[price.Site]; ok {
		price.FlatSeconds = previous.FlatSeconds
		price.JumpCount = previous.JumpCount
		price.Unchanged = previous.Unchanged
	}
	s.prices[price.Site] = price
	s.mu.Unlock()
	return price, nil
}

func (s *priceStore) persistenceLock(site string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.persistLocks[site] == nil {
		s.persistLocks[site] = &sync.Mutex{}
	}
	return s.persistLocks[site]
}

func (s *priceStore) setStagnation(site string, stagnation storage.QuoteStagnation) {
	s.mu.Lock()
	defer s.mu.Unlock()

	price, ok := s.prices[site]
	if !ok {
		return
	}

	// /\ Keep the rolling history summary with the quote so the API can return it.
	price.FlatSeconds = stagnation.FlatSeconds
	price.JumpCount = stagnation.JumpCount
	// /\ A couple of exact price changes don't erase a long flat stretch; a third does.
	price.Unchanged = stagnation.FlatSeconds >= int64(unchangedAfter.Seconds()) &&
		stagnation.JumpCount <= 2
	s.prices[site] = price
}

// /\ Return a snapshot for the dashboard API.
func (s *priceStore) list() []scraper.Price {
	s.mu.RLock()

	now := time.Now()
	prices := make([]scraper.Price, 0, len(s.prices))

	for _, price := range s.prices {
		if !price.FetchedAt.IsZero() {
			price.AgeSeconds = int64(now.Sub(price.FetchedAt).Seconds())
		}

		price.Stale = !price.Available ||
			price.FetchedAt.IsZero() ||
			now.Sub(price.FetchedAt) > staleAfter

		prices = append(prices, price)
	}
	s.mu.RUnlock()
	sort.Slice(prices, func(i, j int) bool { return prices[i].Site < prices[j].Site })
	return prices
}

type providerHealth struct {
	LastAttemptAt       *time.Time `json:"lastAttemptAt"`
	LastSuccessAt       *time.Time `json:"lastSuccessAt"`
	LastErrorAt         *time.Time `json:"lastErrorAt"`
	LastError           string     `json:"lastError,omitempty"`
	ConsecutiveFailures int        `json:"consecutiveFailures"`
	Site                string     `json:"site"`
}

type healthStore struct {
	mu        sync.RWMutex
	providers map[string]providerHealth
}

const (
	staleAfter = 90 * time.Second
	// /	We look for at least twelve flat hours while allowing up to two jumps.
	unchangedAfter = 12 * time.Hour
)

func newHealthStore(sites []string) *healthStore {
	providers := make(map[string]providerHealth, len(sites))
	for _, site := range sites {
		providers[site] = providerHealth{Site: site}
	}
	return &healthStore{providers: providers}
}

func (s *healthStore) recordAttempt(site string, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()

	health, ok := s.providers[site]
	if !ok {
		return
	}

	health.LastAttemptAt = &at
	s.providers[site] = health
}

func (s *healthStore) recordSuccess(site string, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()

	health, ok := s.providers[site]
	if !ok {
		return
	}

	health.LastAttemptAt = &at
	health.LastSuccessAt = &at

	health.LastError = ""
	health.LastErrorAt = nil
	health.ConsecutiveFailures = 0

	s.providers[site] = health

}

func (s *healthStore) recordFailure(site, message string, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()

	health, ok := s.providers[site]
	if !ok {
		return
	}

	health.LastAttemptAt = &at
	health.LastErrorAt = &at
	health.LastError = message
	health.ConsecutiveFailures++

	s.providers[site] = health
}

func (s *healthStore) list() []providerHealth {
	s.mu.RLock()
	defer s.mu.RUnlock()

	providers := make([]providerHealth, 0, len(s.providers))

	for _, health := range s.providers {
		providers = append(providers, health)
	}

	sort.Slice(providers, func(i, j int) bool {
		return providers[i].Site < providers[j].Site
	})

	return providers

}
