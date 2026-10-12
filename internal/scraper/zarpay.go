package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

type zarpayResponse struct {
	Symbol  string `json:"symbol"`
	Buy     string `json:"buy_price"`
	Sell    string `json:"sell_price"`
	BuyFee  string `json:"fee_percentage"`
	SellFee string `json:"sell_fee_percentage"`
}

type ZarpayScraper struct {
	Client *http.Client
}

func (s ZarpayScraper) GetPrice() (Price, error) {
	url := "https://zarpay24.com/market/coins"

	resp, err := s.Client.Get(url)
	if err != nil {
		return Price{}, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Zarpay returned status %d", resp.StatusCode)
	}

	var data []zarpayResponse

	if err = json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Price{}, err
	}

	var raw zarpayResponse
	for _, item := range data {
		if item.Symbol == "GOLD" {
			raw.Buy = item.Buy
			raw.Sell = item.Sell
			raw.BuyFee = item.BuyFee
			raw.SellFee = item.SellFee
		}
	}
	buy, _ := strconv.ParseInt(raw.Buy, 10, 64)
	sell, _ := strconv.ParseInt(raw.Sell, 10, 64)
	buyFee, _ := strconv.ParseFloat(raw.BuyFee, 64)
	sellFee, _ := strconv.ParseFloat(raw.SellFee, 64)

	return Price{
		Site:    "Zarpay",
		Source:  "Zarpay public API",
		Buy:     buy,
		Sell:    sell,
		BuyFee:  &Fee{Rate: buyFee / 100},
		SellFee: &Fee{Rate: sellFee / 100},
	}, nil
}
