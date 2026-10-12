package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type melligoldResponse struct {
	Data struct {
		Buy  int64 `json:"price_buy"`
		Sell int64 `json:"price_sell"`
		// / The provider puts its quote timestamp inside the data object with the prices.
		CreatedAt int64 `json:"timestamp"`
	} `json:"data"`
}

type MelligoldScraper struct {
	Client *http.Client
}

func (s MelligoldScraper) GetPrice() (Price, error) {
	url := "https://melligold.com/api/v1/exchange/buy-sell-price/?symbol=XAU18"

	resp, err := s.Client.Get(url)

	if err != nil {
		return Price{}, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Melligold returned status %d", resp.StatusCode)
	}

	var data melligoldResponse

	if err = json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Price{}, err
	}

	quoteTime := time.Unix(data.Data.CreatedAt, 0)
	return Price{
		Site:      "MelliGold",
		Source:    "MelliGold public API",
		Buy:       data.Data.Buy,
		Sell:      data.Data.Sell,
		BuyFee:    &Fee{Rate: 0.005},
		SellFee:   &Fee{Rate: 0.005},
		Timestamp: &quoteTime,
		Available: true,
		// /\ Published buy and sell commission on MelliGold's fee page.
	}, nil
}
