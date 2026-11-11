package scraper

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type ecogoldQuote struct {
	Symbol    string `json:"symbol"`
	SellPrice string `json:"sell_price"`
	BuyPrice  string `json:"buy_price"`
	Timestamp string `json:"created_at"`
}

type ecogoldResponse struct {
	Data []ecogoldQuote `json:"data"`
}

type EcogoldScraper struct {
	Client *http.Client
}

func (s EcogoldScraper) GetPrice() (Price, error) {
	const endpoint = "https://backend.ecogold.ir/api/prices/otc"

	client := s.Client
	if client == nil {
		client = http.DefaultClient
	}

	resp, err := client.Get(endpoint)
	if err != nil {
		return Price{}, fmt.Errorf("Ecogold request failed: %w", err)
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Ecogold returned http status %d", resp.StatusCode)
	}

	var response ecogoldResponse

	if err = json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return Price{}, fmt.Errorf("decode Ecogold response: %w", err)
	}

	for _, quote := range response.Data {
		if quote.Symbol != "GOLD18-IRT" {
			continue
		}

		buyValue, err := strconv.ParseFloat(strings.TrimSpace(quote.BuyPrice), 64)
		if err != nil || buyValue < 0 {
			return Price{}, fmt.Errorf("invalid Ecogold buy price %q", quote.BuyPrice)
		}
		buy := int64(math.Floor(buyValue))

		sellValue, err := strconv.ParseFloat(strings.TrimSpace(quote.SellPrice), 64)
		if err != nil || sellValue < 0 {
			return Price{}, fmt.Errorf("invalid Ecogold sell price %q", quote.SellPrice)
		}
		sell := int64(math.Floor(sellValue))

		var timestamp *time.Time
		if value := strings.TrimSpace(quote.Timestamp); value != "" {
			parsed, err := time.Parse(time.RFC3339Nano, value)
			if err != nil {
				return Price{}, fmt.Errorf("invalid Ecogold timestamp %q: %w", value, err)
			}
			timestamp = &parsed
		}

		return Price{
			Site:      "Ecogold",
			Source:    "Ecogold public API",
			Buy:       buy,
			Sell:      sell,
			BuyFee:    &Fee{Rate: 0.005},
			SellFee:   &Fee{Rate: 0.01},
			Timestamp: timestamp,
		}, nil

	}

	return Price{}, fmt.Errorf("Ecogold response did not include symbol GOLD18-IRT")
}
