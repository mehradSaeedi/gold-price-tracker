package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type daricResponse struct {
	Buy  float64 `json:"bestBuy"`
	Sell float64 `json:"bestSell"`
}

type daricTimeResponse struct {
	Name      string    `json:"name"`
	Timestamp time.Time `json:"lastGlobalPriceUpdated"`
}

type DaricScraper struct {
	Client *http.Client
}

func (s DaricScraper) GetPrice() (Price, error) {
	url := "https://apie.daric.gold/public/general/PairList?src=TMN&dest=GOLD18"
	timeUrl := "https://apie.daric.gold/public/coin/"

	resp, err := s.Client.Get(url)
	if err != nil {
		return Price{}, err
	}

	respTime, err := s.Client.Get(timeUrl)
	if err != nil {
		return Price{}, err
	}

	defer resp.Body.Close()
	defer respTime.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Daric returnd status %d", resp.StatusCode)
	}

	var data []daricResponse
	var timeData []daricTimeResponse

	if err = json.NewDecoder(respTime.Body).Decode(&timeData); err != nil {
		return Price{}, err
	}

	var timestamp *time.Time
	tehran, err := time.LoadLocation("Asia/Tehran")
	if err != nil {
		return Price{}, fmt.Errorf("load Tehran timezone: %w", err)
	}
	for _, timestamps := range timeData {
		if timestamps.Name == "GOLD18" && !timestamps.Timestamp.IsZero() {
			// /\ Daric's Z-stamped value matches the Tehran wall clock; keep its clock reading in Tehran time.
			raw := timestamps.Timestamp
			localTimestamp := time.Date(
				raw.Year(), raw.Month(), raw.Day(), raw.Hour(), raw.Minute(), raw.Second(), raw.Nanosecond(), tehran,
			)
			timestamp = &localTimestamp
			break
		}
	}

	if err = json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Price{}, err
	}

	return Price{
		Site:      "Daric",
		Buy:       int64(data[0].Buy),
		Sell:      int64(data[0].Sell),
		BuyFee:    &Fee{Rate: 0.005},
		SellFee:   &Fee{Rate: 0.005},
		Timestamp: timestamp,
		// FeeIncludedInPrice: true,
	}, nil
}
