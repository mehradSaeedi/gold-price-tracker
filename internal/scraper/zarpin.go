package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

type zarpinResponse struct {
	Symbol string `json:"code"`
	Price  string `json:"price"`
}

type ZarpinScraper struct {
	Client *http.Client
}

func (s ZarpinScraper) GetPrice() (Price, error) {
	url := "https://api-khazaneh.zarpin.com/v1/prc/prices/?v=2"

	resp, err := s.Client.Get(url)
	if err != nil {
		return Price{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Zarpin returned status %d", resp.StatusCode)
	}

	var data []zarpinResponse

	if err = json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Price{}, fmt.Errorf("Zarpin returned status %d", resp.StatusCode)
	}

	var raw zarpinResponse

	for _, item := range data {
		if item.Symbol == "GOLD_IRT" {
			raw.Price = item.Price
		}
	}
	buyAndSell, _ := strconv.ParseInt(raw.Price, 10, 64)

	return Price{
		Site:    "Zarpin",
		Source:  "Zarpin public API",
		Buy:     buyAndSell,
		Sell:    buyAndSell,
		BuyFee:  &Fee{Rate: 0.005},
		SellFee: &Fee{Rate: 0.005},
	}, nil
}
