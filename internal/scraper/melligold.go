package scraper

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

type melligoldResponse struct {
	Data struct {
		Buy  int64 `json:"price_buy"`
		Sell int64 `json:"price_sell"`
	} `json:"data"`
	CreatedAt string `json:"timestamp"`
}

type MelligoldScraper struct {
	Client *http.Client
}

func (s MelligoldScraper) GetPrice() (Price, error) {
	url := "https://melligold.com/api/v1/exchange/buy-sell-price?symbol=XAU18"

	resp, err := s.Client.Get(url)
	if err != nil {
		return melliGoldFallback(s.Client, "MelliGold")
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return melliGoldFallback(s.Client, "MelliGold")
	}

	var data melligoldResponse

	if err = json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return melliGoldFallback(s.Client, "MelliGold")
	}

	timestamp, err := strconv.ParseInt(data.CreatedAt, 10, 64)
	if err != nil {
		return melliGoldFallback(s.Client, "MelliGold")
	}

	quoteTime := time.Unix(timestamp, 0)
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

// /\ MelliGold redirects its public endpoint in some networks, so fall back to Zarscope's collected quote.
func melliGoldFallback(client *http.Client, site string) (Price, error) {
	price, err := (ZarScopeScraper{Client: client, Slug: "melli-gold", Site: site}).GetPrice()
	if err == nil {
		price.Source = "Zarscope public feed (fallback)"
	}
	return price, err
}
