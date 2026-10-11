package scraper

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

type melligoldResponse struct {
	Data struct {
		Buy  int64 `json:"price_buy"`
		Sell int64 `json:"price_sell"`
	} `json:"data"`
	CreatedAt int64 `json:"timestamp"`
}

type MelligoldScraper struct {
	Client *http.Client
}

func (s MelligoldScraper) GetPrice() (Price, error) {
	url := "https://melligold.com/api/v1/exchange/buy-sell-price/?symbol=XAU18"

	resp, err := s.Client.Get(url)
	log.Printf("Melligold status: %s", resp.Status)
	log.Printf("Melligold location: %s", resp.Header.Get("Location"))

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

	quoteTime := time.Unix(data.CreatedAt, 0)
	return Price{
		Site:   "MelliGold",
		Source: "MelliGold public API",
		Buy:    data.Data.Buy,
		Sell:   data.Data.Sell,
		// /\ Published buy and sell commission on MelliGold's fee page.
		BuyFee:    &Fee{Rate: 0.005},
		SellFee:   &Fee{Rate: 0.005},
		Timestamp: &quoteTime,
		Available: true,
	}, nil
}
