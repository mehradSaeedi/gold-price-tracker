package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/mehradSaeedi/gold-price-tracker/internal/scraper"
	"github.com/mehradSaeedi/gold-price-tracker/internal/storage"
)

//go:embed index.html
var page embed.FS

// /\ In-memory prices shared by the scrapers and the dashboard page.
type priceStore struct {
	mu     sync.RWMutex
	prices map[string]scraper.Price
}

const staleAfter = 90 * time.Second

// /\ Keep the latest price from each site for the dashboard.
func newPriceStore(sites []string) *priceStore {
	prices := make(map[string]scraper.Price, len(sites))
	for _, site := range sites {
		prices[site] = scraper.Price{Site: site}
	}
	return &priceStore{prices: prices}
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
	s.prices[price.Site] = price
	s.mu.Unlock()
	return price, nil
}

func validFee(fee *scraper.Fee) bool {
	return fee == nil || (fee.Rate >= 0 && fee.Rate <= 1 && fee.FixedToman >= 0)
}

// /\ Return a snapshot for the dashboard API.
func (s *priceStore) list() []scraper.Price {
	s.mu.RLock()
	prices := make([]scraper.Price, 0, len(s.prices))
	for _, price := range s.prices {
		price.Stale = !price.Available || price.FetchedAt.IsZero() || time.Since(price.FetchedAt) > staleAfter
		prices = append(prices, price)
	}
	s.mu.RUnlock()
	sort.Slice(prices, func(i, j int) bool { return prices[i].Site < prices[j].Site })
	return prices
}

type priceFetcher interface {
	GetPrice() (scraper.Price, error)
}

// /\ These fixed choices let the API accept friendly interval names without trusting arbitrary SQL input.
var candleIntervals = map[string]int64{
	"1m":  60,
	"5m":  5 * 60,
	"15m": 15 * 60,
	"1h":  60 * 60,
	"1d":  24 * 60 * 60,
}

// /\ parseCandleTime accepts optional RFC3339 timestamps and normalizes them to UTC.
func parseCandleTime(value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil, fmt.Errorf("time must be RFC3339, for example 2026-10-07T10:30:00Z")
	}
	parsed = parsed.UTC()
	return &parsed, nil
}

// /\ Collect a quote the same way for HTTP scrapers and the WebSocket feed: validate it, show it, then append it.
func recordPrice(price scraper.Price, store *priceStore, database *storage.Postgres) error {
	price, err := store.set(price)
	if err != nil {
		return fmt.Errorf("invalid quote: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := database.SaveObservation(ctx, price); err != nil {
		return fmt.Errorf("save quote to PostgreSQL: %w", err)
	}
	return nil
}

// /\ Refresh one site's price in the background and save each accepted result.
func pollPrices(name, source string, fetcher priceFetcher, store *priceStore, database *storage.Postgres) {
	refresh := func() {
		price, err := fetcher.GetPrice()
		if err != nil {
			log.Printf("%s price update failed: %v", name, err)
			return
		}
		if price.Source == "" {
			price.Source = source
		}
		if err := recordPrice(price, store, database); err != nil {
			log.Printf("%s quote update failed: %v", name, err)
			return
		}
		log.Printf("updated and saved %s prices", price.Site)
	}

	refresh()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		refresh()
	}
}

// /\ Start the scrapers and serve the dashboard and its price data.
func main() {
	client := &http.Client{Timeout: 10 * time.Second}
	// /\ Keep database credentials in the environment so they never need to live in source code.
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required; see the Stage 1 instructions in PROJECT_REVIEW_AND_CHANGELOG.md")
	}
	// /\ Start the shared connection pool before launching scrapers, so database failures show up immediately.
	dbCtx, dbCancel := context.WithTimeout(context.Background(), 10*time.Second)
	database, err := storage.OpenPostgres(dbCtx, databaseURL)
	dbCancel()
	if err != nil {
		log.Fatalf("connect to PostgreSQL: %v", err)
	}
	defer database.Close()

	// /\ Keep every configured site visible before its first request succeeds.
	store := newPriceStore([]string{
		"Milli", "WallGold", "Talano", "Goldika", "Talasea", "Taline", "MelliGold", "Hamrahgold",
		"TapsiGold", "Daric", "Invi", "Snapp Sarmayeh", "Digi Gold", "Zarpin",
	})

	fetchers := []struct {
		name    string
		source  string
		fetcher priceFetcher
	}{
		{"Milli", "Milli public API", scraper.MilliScraper{Client: client}},
		// /\ Add WallGold to the same 30-second polling loop as the REST scrapers.
		{"WallGold", "WallGold public API", scraper.WallGoldScraper{Client: client}},
		{"Talano", "Talano public API", scraper.TalanoScraper{Client: client}},
		{"Goldika", "Goldika public API", scraper.GoldikaScraper{Client: client}},
		{"Talasea", "Talasea public API", scraper.TalaseaScraper{Client: client}},
		{"Taline", "Taline website", scraper.TalineScraper{Client: client}},
		{"MelliGold", "MelliGold API or Zarscope fallback", scraper.MelligoldScraper{Client: client}},
		{"TapsiGold", "MelliGold API or Zarscope fallback", scraper.TapsiScraper{Client: client}},
		{"Snapp Sarmayeh", "Snapp Sarmayeh public API", scraper.SnappSarmayehScraper{Client: client}},
		// /\ These four do not expose a usable public quote API, so use Zarscope's public feed.
		{"Daric", "Zarscope public feed", scraper.ZarScopeScraper{Client: client, Slug: "daric", Site: "Daric"}},
		{"Invi", "Zarscope public feed", scraper.ZarScopeScraper{Client: client, Slug: "invi", Site: "Invi"}},
		{"Digi Gold", "Zarscope public feed", scraper.ZarScopeScraper{Client: client, Slug: "digigold", Site: "Digi Gold"}},
		{"Zarpin", "Zarscope public feed", scraper.ZarScopeScraper{Client: client, Slug: "zarpin", Site: "Zarpin"}},
	}
	for _, item := range fetchers {
		go pollPrices(item.name, item.source, item.fetcher, store, database)
	}

	hamrah := scraper.NewHamrahScraper()
	go func() {
		for {
			prices := make(chan scraper.Price, 10)
			go func() {
				for price := range prices {
					if price.Source == "" {
						price.Source = "HamrahGold WebSocket"
					}
					if err := recordPrice(price, store, database); err != nil {
						log.Printf("HamrahGold quote update failed: %v", err)
					}
				}
			}()
			if err := hamrah.Start(prices); err != nil {
				log.Printf("HamrahGold connection ended: %v", err)
			}
			close(prices)
			time.Sleep(5 * time.Second)
		}
	}()

	// /\ The page polls this endpoint to fill its price table.
	http.HandleFunc("/api/prices", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if err := json.NewEncoder(w).Encode(store.list()); err != nil {
			log.Printf("encode prices: %v", err)
		}
	})
	// /\ Return OHLC candles derived from raw observations, with newest history bounded by a result limit.
	http.HandleFunc("/api/candles", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		query := r.URL.Query()
		site := query.Get("site")
		if site == "" {
			http.Error(w, "site is required", http.StatusBadRequest)
			return
		}
		interval := query.Get("interval")
		seconds, ok := candleIntervals[interval]
		if !ok {
			http.Error(w, "interval must be one of: 1m, 5m, 15m, 1h, 1d", http.StatusBadRequest)
			return
		}
		// /\ Fixed fees change their per-gram impact with order size, so let the chart send the selected grams.
		grams := 1.0
		if rawGrams := query.Get("grams"); rawGrams != "" {
			grams, err = strconv.ParseFloat(rawGrams, 64)
			if err != nil || math.IsNaN(grams) || math.IsInf(grams, 0) || grams < 0.001 || grams > 10000 {
				http.Error(w, "grams must be between 0.001 and 10000", http.StatusBadRequest)
				return
			}
		}
		from, err := parseCandleTime(query.Get("from"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		to, err := parseCandleTime(query.Get("to"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if from != nil && to != nil && !from.Before(*to) {
			http.Error(w, "from must be earlier than to", http.StatusBadRequest)
			return
		}
		limit := 500
		if rawLimit := query.Get("limit"); rawLimit != "" {
			limit, err = strconv.Atoi(rawLimit)
			if err != nil || limit < 1 || limit > 2000 {
				http.Error(w, "limit must be between 1 and 2000", http.StatusBadRequest)
				return
			}
		}

		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		candles, err := database.Candles(ctx, site, interval, seconds, from, to, limit, grams)
		if err != nil {
			log.Printf("load %s %s candles: %v", site, interval, err)
			http.Error(w, "could not load candles", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if err := json.NewEncoder(w).Encode(candles); err != nil {
			log.Printf("encode candles: %v", err)
		}
	})
	http.Handle("/", http.FileServer(http.FS(page)))

	log.Println("Dashboard available at http://localhost:8080")
	log.Fatal(http.ListenAndServe("0.0.0.0:8080", nil))
}
