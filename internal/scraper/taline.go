package scraper

import (
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
)

type TalineScraper struct {
	Client *http.Client
}

func (s TalineScraper) GetPrice() (Price, error) {
	const url = "https://taline.ir/"

	resp, err := s.Client.Get(url)
	if err != nil {
		return Price{}, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Taline returned HTTP status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return Price{}, err
	}

	re := regexp.MustCompile(
		`goldPrices\s*=\s*\{\s*buy:\s*(\d+),\s*sell:\s*(\d+)`,
	)

	matches := re.FindStringSubmatch(string(body))
	if len(matches) != 3 {
		return Price{}, fmt.Errorf("could not find Taline gold prices")
	}

	buy, err := strconv.ParseInt(matches[1], 10, 64)
	if err != nil {
		return Price{}, err
	}

	sell, err := strconv.ParseInt(matches[2], 10, 64)
	if err != nil {
		return Price{}, err
	}

	return Price{
		Site: "Taline",
		Buy:  buy,
		Sell: sell,
		// /\ Taline charges this fixed amount per buy or sell order.
		BuyFee:  &Fee{FixedToman: 5000},
		SellFee: &Fee{FixedToman: 5000},
	}, nil
}
