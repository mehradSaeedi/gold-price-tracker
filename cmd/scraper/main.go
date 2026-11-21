package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/http/cookiejar"
	"os"
	"time"

	"github.com/joho/godotenv"
	"github.com/mehradSaeedi/gold-price-tracker/internal/scraper"
	"github.com/mehradSaeedi/gold-price-tracker/internal/storage"
)

type priceFetcher interface {
	GetPrice() (scraper.Price, error)
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

	mux := http.NewServeMux()

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

	health := newHealthStore([]string{
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
		go pollPrices(item.name, item.source, item.fetcher, store, health, database)
	}

	// /\\ Keep Invi's public market stream alive and save each accepted gold quote like the other live feeds.
	invi := scraper.NewInviScraper()
	go func() {
		for {
			health.recordAttempt("Invi", time.Now())
			prices := make(chan scraper.Price, 10)
			go func() {
				sessionSucceeded := false
				for price := range prices {
					if err := recordPrice(price, store, database); err != nil {
						health.recordFailure("Invi", "Invi quote update failed", time.Now())
						log.Printf("Invi quote update failed: %v", err)
						continue
					}
					if !sessionSucceeded {
						health.recordSuccess("Invi", time.Now())
						sessionSucceeded = true
					}
				}
			}()
			if err := invi.Start(prices); err != nil {
				health.recordFailure("Invi", "Invi couldn't connect", time.Now())
				log.Printf("Invi connection ended: %v", err)
			}
			close(prices)
			time.Sleep(5 * time.Second)
		}
	}()

	hamrah := scraper.NewHamrahScraper()
	go func() {
		for {
			health.recordAttempt("Hamrahgold", time.Now())
			prices := make(chan scraper.Price, 10)
			go func() {
				sessionSucceeded := false
				for price := range prices {
					if price.Source == "" {
						price.Source = "HamrahGold WebSocket"
					}
					if err := recordPrice(price, store, database); err != nil {
						health.recordFailure("Hamrahgold", "HamrahGold quote update failed", time.Now())
						log.Printf("HamrahGold quote update failed: %v", err)
						continue
					}
					if !sessionSucceeded {
						health.recordSuccess("Hamrahgold", time.Now())
						sessionSucceeded = true
					}
				}
			}()
			if err := hamrah.Start(prices); err != nil {
				health.recordFailure("Hamrahgold", "HamrahGold quote update failed", time.Now())
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
			health.recordAttempt("Myshemsh", time.Now())
			prices := make(chan scraper.Price, 10)
			go func() {
				sessionSucceeded := false
				for price := range prices {
					if err := recordPrice(price, store, database); err != nil {
						health.recordFailure("Myshemsh", "Myshemsh quote update failed", time.Now())
						log.Printf("Myshemsh quote update failed: %v", err)
						continue
					}
					if !sessionSucceeded {
						health.recordSuccess("Myshemsh", time.Now())
						sessionSucceeded = true
					}
				}
			}()
			if err := myshemsh.Start(prices); err != nil {
				health.recordFailure("Myshemsh", "Myshemsh quote update failed", time.Now())
				log.Printf("Myshemsh connection ended: %v", err)
			}
			close(prices)
			time.Sleep(5 * time.Second)
		}
	}()

	registerAPIHandlers(mux, store, health, database)
	registerAssetHandlers(mux)

	log.Println("Dashboard available at http://localhost:8080")
	log.Fatal(http.ListenAndServe("0.0.0.0:8080", mux))
}
