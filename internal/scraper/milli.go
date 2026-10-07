package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type milliRespnse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Price18 int64  `json:"price18"`
		Date    string `json:"date"`
	} `json:"data"`
}

type MilliScraper struct {
	Client *http.Client
}

func (s MilliScraper) GetPrice() (Price, error) {
	const url = "https://milli.gold/api/v1/public/milli-price/external"

	resp, err := s.Client.Get(url)
	if err != nil {
		return Price{}, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Milli returned http status %d", resp.StatusCode)
	}

	var data milliRespnse

	if err = json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Price{}, err
	}

	timestamp, err := time.Parse(time.RFC3339Nano, data.Data.Date)
	if err != nil {
		// Older API responses may omit the timezone and fractional seconds.
		timestamp, err = time.Parse("2006-01-02T15:04:05", data.Data.Date)
	}
	if err != nil {
		return Price{}, err
	}

	return Price{
		Site: "Milli",
		Buy:  data.Data.Price18 * 100,
		Sell: data.Data.Price18 * 100,
		// /\ Milli publishes a 0.5% fee for each side of a trade.
		BuyFee:    &Fee{Rate: 0.005},
		SellFee:   &Fee{Rate: 0.005},
		Timestamp: &timestamp,
	}, nil
}
