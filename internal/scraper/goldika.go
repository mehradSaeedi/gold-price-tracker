package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type goldikaResponse struct {
	Data struct {
		Price struct {
			Buy       int64  `json:"buy"`
			Sell      int64  `json:"sell"`
			CreatedAt string `json:"createdAt"`
		} `json:"price"`
	} `json:"data"`
}

type GoldikaScraper struct {
	Client *http.Client
}

func (s GoldikaScraper) GetPrice() (Price, error) {
	url := "https://api.goldika.ir/api/public/price"

	resp, err := s.Client.Get(url)
	if err != nil {
		return Price{}, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Goldika returned http status %d", resp.StatusCode)
	}

	var data goldikaResponse

	if err = json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Price{}, err
	}

	timestamp, err := time.Parse(time.RFC3339Nano, data.Data.Price.CreatedAt)
	if err != nil {
		return Price{}, err
	}

	return Price{
		Site:      "Goldika",
		Buy:       int64((data.Data.Price.Buy / 10)),
		Sell:      int64((data.Data.Price.Sell / 10)),
		Timestamp: timestamp,
	}, nil
}
