package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
)

type zarafzaResponse struct {
	Data struct {
		G18 struct {
			Sell struct {
				Price float64 `json:"price"`
			} `json:"sell"`
			Buy struct {
				Price float64 `json:"price"`
			} `json:"buy"`
		} `json:"G18"`
	} `json:"data"`
}

type ZarafzaScraper struct {
	Client *http.Client
}

func (s ZarafzaScraper) GetPrice() (Price, error) {
	url := "https://api.zarafza.com/v2/prices"

	resp, err := s.Client.Get(url)
	if err != nil {
		return Price{}, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Zarafza returned status %d", resp.StatusCode)
	}

	var data zarafzaResponse

	if err = json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Price{}, err
	}

	return Price{
		Site:    "Zarafza",
		Source:  "Zarafza public API",
		Buy:     int64(data.Data.G18.Sell.Price),
		Sell:    int64(data.Data.G18.Buy.Price),
		BuyFee:  &Fee{Rate: 0.005},
		SellFee: &Fee{Rate: 0.005},
		// Buy and sell are reversed for Zarafza
	}, err
}
