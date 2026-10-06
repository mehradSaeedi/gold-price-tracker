package scraper

import "time"

type Fee struct {
	// /\ Rate is a fraction of the order value (0.005 means 0.5%).
	Rate       float64 `json:"rate"`
	FixedToman int64   `json:"fixedToman"`
}

type Price struct {
	Site               string    `json:"site"`
	Source             string    `json:"source"`
	Buy                int64     `json:"buy"`
	Sell               int64     `json:"sell"`
	BuyFee             *Fee      `json:"buyFee,omitempty"`
	SellFee            *Fee      `json:"sellFee,omitempty"`
	FeeIncludedInPrice bool      `json:"feeIncludedInPrice,omitempty"`
	Timestamp          time.Time `json:"timestamp"`
	FetchedAt          time.Time `json:"fetchedAt"`
	Available          bool      `json:"available"`
	Stale              bool      `json:"stale"`
}

type Scraper interface {
	GetPrice() (Price, error)
}
