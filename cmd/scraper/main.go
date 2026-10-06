package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/mehradSaeedi/gold-price-tracker/internal/scraper"
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
func (s *priceStore) set(price scraper.Price) error {
	if price.Site == "" || price.Buy <= 0 || price.Sell <= 0 {
		return fmt.Errorf("quote must have a site and positive buy and sell prices")
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
	return nil
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

// /\ Refresh one site's price in the background.
func pollPrices(name, source string, fetcher priceFetcher, store *priceStore) {
	refresh := func() {
		price, err := fetcher.GetPrice()
		if err != nil {
			log.Printf("%s price update failed: %v", name, err)
			return
		}
		if price.Source == "" {
			price.Source = source
		}
		if err := store.set(price); err != nil {
			log.Printf("%s returned invalid quote: %v", name, err)
			return
		}
		log.Printf("updated %s prices", price.Site)
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
		go pollPrices(item.name, item.source, item.fetcher, store)
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
					if err := store.set(price); err != nil {
						log.Printf("HamrahGold returned invalid quote: %v", err)
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
	http.Handle("/", http.FileServer(http.FS(page)))

	log.Println("Dashboard available at http://localhost:8080")
	log.Fatal(http.ListenAndServe("0.0.0.0:8080", nil))
}
