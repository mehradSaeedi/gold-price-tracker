package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
)

type digikalaResponse struct {
	Data struct {
		Price int64 `json:"price"`
	} `json:"gold18"`
}

type DigikalaScraper struct {
	Client *http.Client
}

func (s DigikalaScraper) GetPrice() (Price, error) {
	const endpoint = "https://api.digikala.com/wealth/v1/prices/"

	client := s.Client
	if client == nil {
		client = http.DefaultClient
	}

	resp, err := client.Get(endpoint)
	if err != nil {
		return Price{}, fmt.Errorf("Digikala request failed: %w", err)
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Digikala returned http status: %d", resp.StatusCode)
	}

	var data digikalaResponse

	if err = json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Price{}, fmt.Errorf("decode Digikala response: %w", err)
	}
	if data.Data.Price <= 0 {
		return Price{}, fmt.Errorf("Digikala response did not include a positive gold18 price")
	}

	return Price{
		Site:    "Digikala",
		Source:  "Digikala public API",
		Buy:     data.Data.Price * 100,
		Sell:    data.Data.Price * 100,
		BuyFee:  &Fee{Rate: 0.005},
		SellFee: &Fee{Rate: 0.01},
	}, nil
}
