package main

import (
	"compress/gzip"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"math"
	"net/http"
	"net/http/cookiejar"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/joho/godotenv"
	"github.com/mehradSaeedi/gold-price-tracker/internal/scraper"
	"github.com/mehradSaeedi/gold-price-tracker/internal/storage"
)

// /\ Bundle the dashboard and chart assets so the server can run from any working directory.
//
//go:embed frontend fonts charting_library
var page embed.FS

type gzipResponseWriter struct {
	http.ResponseWriter
	writer *gzip.Writer
}

// gzip replaces the response body's writer, so Content-Length from the uncompressed
// file would be wrong. Let net/http choose chunked encoding for the compressed body.
func (w *gzipResponseWriter) WriteHeader(status int) {
	w.Header().Del("Content-Length")
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipResponseWriter) Write(data []byte) (int, error) {
	return w.writer.Write(data)
}

// chartAssetHandler compresses and caches the large, versioned TradingView assets.
func chartAssetHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/charting_library/") {
			next.ServeHTTP(w, r)
			return
		}

		if strings.HasPrefix(r.URL.Path, "/charting_library/bundles/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=86400")
		}

		// HEAD and byte-range requests need the original file representation; don't gzip them.
		if r.Method == http.MethodHead || r.Header.Get("Range") != "" || !acceptsGzip(r.Header.Get("Accept-Encoding")) {
			next.ServeHTTP(w, r)
			return
		}

		// BestSpeed keeps the large chart download compact without spending much VPS CPU.
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		gz, err := gzip.NewWriterLevel(w, gzip.BestSpeed)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		defer gz.Close()
		next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, writer: gz}, r)
	})
}

func acceptsGzip(header string) bool {
	// Browsers send a comma-separated list of supported encodings; honor gzip;q=0.
	for _, item := range strings.Split(header, ",") {
		parts := strings.Split(strings.TrimSpace(item), ";")
		if strings.TrimSpace(parts[0]) != "gzip" {
			continue
		}
		for _, option := range parts[1:] {
			name, value, ok := strings.Cut(strings.TrimSpace(option), "=")
			if ok && strings.TrimSpace(name) == "q" && strings.TrimSpace(value) == "0" {
				return false
			}
		}
		return true
	}
	return false
}

// /\ In-memory prices shared by the scrapers and the dashboard page.
type priceStore struct {
	mu     sync.RWMutex
	prices map[string]scraper.Price
}

type providerHealth struct {
	// Status              string     `json:"status"`
	LastAttemptAt       *time.Time `json:"lastAttemptAt"`
	LastSuccessAt       *time.Time `json:"lastSuccessAt"`
	LastError           string     `json:"lastError,omitempty"`
	LastErrorAt         *time.Time `json:"lastErrorAt,omitempty"`
	ConsecutiveFailures int        `json:"consecutiveFailures,omitempty"`
	Site                string     `json:"site"`
}

type healthStore struct {
	mu        sync.RWMutex
	providers map[string]providerHealth
}

func newHealthStore(sites []string) *healthStore {
	providers := make(map[string]providerHealth, len(sites))
	for _, site := range sites {
		providers[site] = providerHealth{Site: site}
	}
	return &healthStore{providers: providers}
}

const (
	staleAfter     = 90 * time.Second
	// /	We look for at least twelve flat hours while allowing up to two jumps.
	unchangedAfter = 12 * time.Hour
)

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

func validFee(fee *scraper.Fee) bool {
	return fee == nil || (fee.Rate >= 0 && fee.Rate <= 1 && fee.FixedToman >= 0)
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

	// /\ Save every quote, including repeats, so the history can measure flat periods reliably.
	if err := database.SaveObservation(ctx, price); err != nil {
		return fmt.Errorf("save quote to PostgreSQL: %w", err)
	}

	// /\ Recompute the last day's exact-flat time and jumps from the full saved observation history.
	now := time.Now()
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
	if err := godotenv.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("could not load .env file; check its syntax and permissions")
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		log.Fatal(err)
	}

	client := &http.Client{
		Timeout: 15 * time.Second,
		Jar:     jar,
	}
	snappFetcher, snappConfigErr := scraper.NewSnappSarmayehScraper(client)
	if snappConfigErr != nil {
		log.Printf("Snapp Sarmayeh scraper disabled: %v", snappConfigErr)
	}

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
		"TapsiGold", "Invi", "Myshemsh", "Gerami", "Snapp Sarmayeh", "Daric", "Zarafza", "Zarpay", "Zarpin",
		"Ecogold", "Digikala",
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
		{"MelliGold", "MelliGold API", scraper.MelligoldScraper{Client: client}},
		{"TapsiGold", "MelliGold API", scraper.TapsiScraper{Client: client}},
		{"Daric", "Daric public API", scraper.DaricScraper{Client: client}},
		{"Zarafza", "Zarafza public API", scraper.ZarafzaScraper{Client: client}},
		{"Zarpay", "Zarpay public API", scraper.ZarpayScraper{Client: client}},
		{"Zarpin", "Zarpin public API", scraper.ZarpinScraper{Client: client}},
		{"Gerami", "Gerami public API", scraper.GeramiScraper{Client: client}},
		{"Ecogold", "Ecogold public API", scraper.EcogoldScraper{Client: client}},
		{"Digikala", "Digikala public API", scraper.DigikalaScraper{Client: client}},
	}
	if snappFetcher != nil {
		fetchers = append(fetchers, struct {
			name    string
			source  string
			fetcher priceFetcher
		}{"Snapp Sarmayeh", "Snapp Sarmayeh app API", snappFetcher})
	}
	for _, item := range fetchers {
		go pollPrices(item.name, item.source, item.fetcher, store, database)
	}

	// /\\ Keep Invi's public market stream alive and save each accepted gold quote like the other live feeds.
	invi := scraper.NewInviScraper()
	go func() {
		for {
			prices := make(chan scraper.Price, 10)
			go func() {
				for price := range prices {
					if err := recordPrice(price, store, database); err != nil {
						log.Printf("Invi quote update failed: %v", err)
					}
				}
			}()
			if err := invi.Start(prices); err != nil {
				log.Printf("Invi connection ended: %v", err)
			}
			close(prices)
			time.Sleep(5 * time.Second)
		}
	}()

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

	// /\\ Keep Myshemsh's Socket.IO subscription alive and save each accepted gold quote.
	myshemsh := scraper.NewMyshemshScraper()
	go func() {
		for {
			prices := make(chan scraper.Price, 10)
			go func() {
				for price := range prices {
					if err := recordPrice(price, store, database); err != nil {
						log.Printf("Myshemsh quote update failed: %v", err)
					}
				}
			}()
			if err := myshemsh.Start(prices); err != nil {
				log.Printf("Myshemsh connection ended: %v", err)
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
	// /\\ Return the winning fee-aware buy and sell provider in each market-history bucket.
	http.HandleFunc("/api/best-offers", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		query := r.URL.Query()
		interval := query.Get("interval")
		seconds, ok := candleIntervals[interval]
		if !ok {
			http.Error(w, "interval must be one of: 1m, 5m, 15m, 1h, 1d", http.StatusBadRequest)
			return
		}
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
		configuredSites := store.list()
		sites := make([]string, 0, len(configuredSites))
		for _, price := range configuredSites {
			sites = append(sites, price.Site)
		}
		points, err := database.BestOffers(ctx, interval, seconds, from, to, limit, grams, sites)
		if err != nil {
			log.Printf("load %s best offers: %v", interval, err)
			http.Error(w, "could not load best offers", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if err := json.NewEncoder(w).Encode(points); err != nil {
			log.Printf("encode best offers: %v", err)
		}
	})
	frontend, err := fs.Sub(page, "frontend")
	if err != nil {
		log.Fatalf("open embedded frontend: %v", err)
	}
	http.Handle("/charting_library/", chartAssetHandler(http.FileServer(http.FS(page))))
	http.Handle("/fonts/", http.FileServer(http.FS(page)))
	http.Handle("/", http.FileServer(http.FS(frontend)))

	log.Println("Dashboard available at http://localhost:8080")
	log.Fatal(http.ListenAndServe("0.0.0.0:8080", nil))
}
