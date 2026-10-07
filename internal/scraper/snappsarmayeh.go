package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const snappSarmayehPriceURL = "https://snappsarmayeh.ir/wp-json/snapp-sarmayeh-market/v1/prices"

type snappSarmayehResponse struct {
	Gold struct {
		PricePerGram float64 `json:"pricePerGram"`
		FetchedAt    string  `json:"fetchedAt"`
		Available    bool    `json:"available"`
	} `json:"gold"`
}

type SnappSarmayehScraper struct {
	Client *http.Client
}

// /\ Snapp publishes one gold reference price; its gold fee is 1% per side.
func (s SnappSarmayehScraper) GetPrice() (Price, error) {
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Get(snappSarmayehPriceURL)
	if err != nil {
		return Price{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Snapp Sarmayeh returned HTTP status %d", resp.StatusCode)
	}
	var data snappSarmayehResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Price{}, err
	}
	if !data.Gold.Available || data.Gold.PricePerGram <= 0 {
		return Price{}, fmt.Errorf("Snapp Sarmayeh has no current gold quote")
	}
	var timestamp *time.Time
	if parsed, err := time.Parse(time.RFC3339Nano, data.Gold.FetchedAt); err == nil {
		timestamp = &parsed
	}
	return Price{
		Site:      "Snapp Sarmayeh",
		Buy:       int64(data.Gold.PricePerGram),
		Sell:      int64(data.Gold.PricePerGram),
		BuyFee:    &Fee{Rate: 0.01},
		SellFee:   &Fee{Rate: 0.01},
		Timestamp: timestamp,
		Available: true,
	}, nil
}
