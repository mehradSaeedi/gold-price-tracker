package scraper

import "time"

type Fee struct {
	// /\ Rate is a fraction of the order value (0.005 means 0.5%).
	Rate       float64 `json:"rate"`
	FixedToman int64   `json:"fixedToman"`
}

// Price is a provider's quote for 18-karat gold buy/sell price.
// Buy and Sell are denominated in Toman per gram.
// Buy is the price at which customer buys; Sell is the price at
// which customer sells.
// Fee fields describe additional fees. FeeIncludedInPrice indicates whether
// those fees are already included in Buy and Sell.
type Price struct {
	Site               string     `json:"site"`
	Source             string     `json:"source"`
	Buy                int64      `json:"buy"`
	Sell               int64      `json:"sell"`
	BuyFee             *Fee       `json:"buyFee,omitempty"`
	SellFee            *Fee       `json:"sellFee,omitempty"`
	FeeIncludedInPrice bool       `json:"feeIncludedInPrice,omitempty"`
	Change24h          float64    `json:"change24h,omitempty"`
	UnitType           string     `json:"unitType,omitempty"`
	SourceUnitType     string     `json:"sourceUnitType,omitempty"`
	FetchedAt          time.Time  `json:"fetchedAt"`
	Timestamp          *time.Time `json:"timestamp,omitempty"`
	FlatSeconds        int64      `json:"flatSeconds"`
	JumpCount          int64      `json:"jumpCount"`
	Unchanged          bool       `json:"unchanged"`
	Available          bool       `json:"available"`
	Stale              bool       `json:"stale"`
	AgeSeconds         int64      `json:"ageSeconds"`
	// /\ These totals (FlatSeconds and JumpCount) describe exact flat stretches and observed buy/sell jumps in the rolling window.
	// /\ Unchanged means the quote crossed the backend's flat-time and jump-count thresholds.
	// /\ A nil timestamp means the provider did not give us a quote time.
}

type Scraper interface {
	GetPrice() (Price, error)
}
