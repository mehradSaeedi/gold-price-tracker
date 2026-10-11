package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
)

type daricResponse struct {
	Buy  float64 `json:"bestBuy"`
	Sell float64 `json:"bestSell"`
}

type DaricScraper struct {
	Client *http.Client
}

func (s DaricScraper) GetPrice() (Price, error) {
	url := "https://apie.daric.gold/public/general/PairList?src=TMN&dest=GOLD18"

	resp, err := s.Client.Get(url)
	if err != nil {
		return Price{}, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Daric returnd status %d", resp.StatusCode)
	}

	var data []daricResponse

	if err = json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Price{}, err
	}

	return Price{
		Site:    "Daric",
		Buy:     int64(data[0].Buy),
		Sell:    int64(data[0].Sell),
		BuyFee:  &Fee{Rate: 0.005},
		SellFee: &Fee{Rate: 0.005},

		// FeeIncludedInPrice: true,
	}, nil
}
