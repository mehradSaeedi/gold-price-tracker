package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// /\ Keep only the two directional quote fields that this scraper needs from the response.
type geramiResponse struct {
	Data struct {
		Pair struct {
			BuyPrice  string `json:"buy_price"`
			SellPrice string `json:"sell_price"`
		} `json:"pair"`
	} `json:"data"`
}

// /\ Let the caller provide a reusable HTTP client for Gerami's public API.
type GeramiScraper struct {
	Client *http.Client
}

// /\ Fetch Gerami's directional gold quotes and attach the confirmed half-percent fee on both sides.
func (s GeramiScraper) GetPrice() (Price, error) {
	const endpoint = "https://api.gerami.com/api/v1/pairs/XAU750g_IRT/chart?range=1%20MONTH"

	client := s.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Get(endpoint)
	if err != nil {
		return Price{}, fmt.Errorf("Gerami request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Gerami returned status %d", resp.StatusCode)
	}

	var response geramiResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return Price{}, fmt.Errorf("decode Gerami response: %w", err)
	}
	pair := response.Data.Pair
	buy, err := geramiInt64(pair.BuyPrice)
	if err != nil {
		return Price{}, fmt.Errorf("invalid Gerami buy price: %w", err)
	}
	sell, err := geramiInt64(pair.SellPrice)
	if err != nil {
		return Price{}, fmt.Errorf("invalid Gerami sell price: %w", err)
	}
	return Price{
		Site:    "Gerami",
		Source:  "Gerami public API",
		Buy:     buy,
		Sell:    sell,
		BuyFee:  &Fee{Rate: 0.005},
		SellFee: &Fee{Rate: 0.005},
	}, nil
}

// /\ Parse integer Toman price strings strictly so malformed or missing values cannot look like valid zero quotes.
func geramiInt64(raw string) (int64, error) {
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil {
		return 0, err
	}
	if value < 0 {
		return 0, fmt.Errorf("amount cannot be negative")
	}
	return value, nil
}
