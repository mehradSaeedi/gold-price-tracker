package scraper

import "net/http"

// /\ Tapsi Gold is backed by MelliGold and uses the same public price endpoint.
type TapsiScraper struct {
	Client *http.Client
}

func (s TapsiScraper) GetPrice() (Price, error) {
	price, err := (MelligoldScraper{Client: s.Client}).GetPrice()
	if err != nil {
		return (ZarScopeScraper{Client: s.Client, Slug: "tapsi", Site: "TapsiGold"}).GetPrice()
	}
	price.Site = "TapsiGold"
	if price.Source == "" {
		price.Source = "MelliGold public API"
	}
	price.Available = true
	return price, nil
}
