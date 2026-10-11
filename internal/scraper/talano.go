package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
)

type talanoResponse struct {
	BuyPrice        int64    `json:"buyPrice"`
	SellPrice       int64    `json:"sellPrice"`
	BuyFee          *float64 `json:"buyFee"`
	SellFee         *float64 `json:"sellFee"`
	PriceSourceType string   `json:"priceSourceType"`
}

type TalanoScraper struct {
	Client *http.Client
}

func (s TalanoScraper) GetPrice() (Price, error) {
	url := "https://service.talano.ir/api/v1/market/price/?market_id=b0808638-7909-4468-83e9-ecac3d22499a"

	resp, err := s.Client.Get(url)
	if err != nil {
		return Price{}, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf(
			"Talano returned http status %d",
			resp.StatusCode,
		)
	}

	var data talanoResponse

	err = json.NewDecoder(resp.Body).Decode(&data)
	if err != nil {
		return Price{}, err
	}

	return Price{
		Site:               "Talano",
		Buy:                data.BuyPrice * 1000,
		Sell:               data.SellPrice * 1000,
		FeeIncludedInPrice: true,
		BuyFee:             talanoFee(data.BuyFee),
		SellFee:            talanoFee(data.SellFee),
	}, nil

}

func talanoFee(value *float64) *Fee {
	if value == nil || *value < 0 || *value > 1 {
		return nil
	}
	return &Fee{Rate: *value}
}
