package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const zarScopeGoldSourcesURL = "https://api.zarscope.com/api/sources/?metal=gold"

// /\ This response is the public Zarscope fallback source for a live quote.
type zarScopeSourcesResponse struct {
	Results []zarScopeSource `json:"results"`
}

type zarScopeSource struct {
	Platform struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	} `json:"platform"`
	LatestBuyPrice  float64 `json:"latest_buy_price"`
	LatestSellPrice float64 `json:"latest_sell_price"`
	BuyFeeLabel     string  `json:"buy_fee_label"`
	SellFeeLabel    string  `json:"sell_fee_label"`
	LatestFetchedAt string  `json:"latest_fetched_at"`
	IsStale         bool    `json:"is_stale"`
}

type ZarScopeScraper struct {
	Client *http.Client
	Slug   string
	Site   string
}

// /\ Fetch a provider from Zarscope only where its own public API is unavailable.
func (s ZarScopeScraper) GetPrice() (Price, error) {
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Get(zarScopeGoldSourcesURL)
	if err != nil {
		return Price{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Zarscope returned HTTP status %d", resp.StatusCode)
	}
	var data zarScopeSourcesResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Price{}, err
	}
	for _, source := range data.Results {
		if source.Platform.Slug != s.Slug {
			continue
		}
		if source.IsStale || source.LatestBuyPrice <= 0 || source.LatestSellPrice <= 0 {
			return Price{}, fmt.Errorf("Zarscope has no current quote for %s", s.Site)
		}
		timestamp, err := time.Parse(time.RFC3339Nano, source.LatestFetchedAt)
		if err != nil {
			timestamp = time.Time{}
		}
		return Price{
			Site:      s.Site,
			Buy:       int64(source.LatestBuyPrice / 10),
			Sell:      int64(source.LatestSellPrice / 10),
			BuyFee:    feeFromZarScopeLabel(source.BuyFeeLabel),
			SellFee:   feeFromZarScopeLabel(source.SellFeeLabel),
			Timestamp: timestamp,
			Available: true,
		}, nil
	}
	return Price{}, fmt.Errorf("Zarscope did not return %s", s.Slug)
}

// /\ Zarscope labels percentage fees with % and fixed fees with تومان.
func feeFromZarScopeLabel(label string) *Fee {
	label = strings.TrimSpace(strings.ReplaceAll(label, "٪", "%"))
	if label == "" || label == "—" {
		return nil
	}
	var rate float64
	if _, err := fmt.Sscanf(label, "%f%%", &rate); err == nil {
		return &Fee{Rate: rate / 100}
	}
	var fixed int64
	if _, err := fmt.Sscanf(strings.ReplaceAll(label, ",", ""), "%d تومان", &fixed); err == nil {
		return &Fee{FixedToman: fixed}
	}
	return nil
}
