package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	wallGoldPriceURL   = "https://api.wallgold.ir/api/v1/prices"
	wallGoldMarketsURL = "https://api.wallgold.ir/api/v1/markets"
	wallGoldGoldSymbol = "GLD_18C_750TMN"
)

// /\ These are the public price and market records used by WallGold's app.
type wallGoldPriceResponse struct {
	Result []wallGoldPriceEntry `json:"result"`
}

type wallGoldPriceEntry struct {
	Symbol string          `json:"symbol"`
	Side   string          `json:"side"`
	Price  json.RawMessage `json:"price"`
}

type wallGoldMarketsResponse struct {
	Result []wallGoldMarket `json:"result"`
}

type wallGoldMarket struct {
	Symbol            string          `json:"symbol"`
	OTCFeeCoefficient json.RawMessage `json:"otcFeeCoefficient"`
}

type WallGoldScraper struct {
	Client *http.Client
}

// /\ Get the 18-karat quote and the market's published OTC fee coefficient.
func (s WallGoldScraper) GetPrice() (Price, error) {
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}

	var priceData wallGoldPriceResponse
	if err := getWallGoldJSON(client, wallGoldPriceURL, &priceData); err != nil {
		return Price{}, fmt.Errorf("fetch WallGold prices: %w", err)
	}

	var buy, sell int64
	var foundBuy, foundSell bool
	for _, item := range priceData.Result {
		if item.Symbol != wallGoldGoldSymbol {
			continue
		}
		value, err := parseWallGoldPrice(item.Price)
		if err != nil {
			return Price{}, fmt.Errorf("parse WallGold %s price: %w", item.Side, err)
		}
		switch strings.ToLower(item.Side) {
		case "buy":
			buy, foundBuy = value, true
		case "sell":
			sell, foundSell = value, true
		}
	}
	if !foundBuy || !foundSell {
		return Price{}, fmt.Errorf("WallGold response did not include both sides for %s", wallGoldGoldSymbol)
	}

	price := Price{
		Site: "WallGold",
		Buy:  buy,
		Sell: sell,
	}

	// /\ Fee data is separate, so keep usable prices if that endpoint is down.
	var marketData wallGoldMarketsResponse
	if err := getWallGoldJSON(client, wallGoldMarketsURL, &marketData); err != nil {
		return price, nil
	}
	for _, market := range marketData.Result {
		if market.Symbol != wallGoldGoldSymbol || len(market.OTCFeeCoefficient) == 0 {
			continue
		}
		fee, err := parseWallGoldRate(market.OTCFeeCoefficient)
		if err != nil {
			return price, nil
		}
		// /\ WallGold publishes one structural OTC fee rate for both sides.
		price.BuyFee = &Fee{Rate: float64(fee)}
		price.SellFee = &Fee{Rate: float64(fee)}
		break
	}
	return price, nil
}

// /\ Decode a JSON endpoint after checking its HTTP status.
func getWallGoldJSON(client *http.Client, url string, target any) error {
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP status %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
		return err
	}
	return nil
}

// /\ Accept a price or fee coefficient whether the API sends it as a number or string.
func parseWallGoldPrice(raw json.RawMessage) (int64, error) {
	var value int64
	if err := json.Unmarshal(raw, &value); err == nil {
		return value, nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return 0, err
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(text), 10, 64)
	if err != nil {
		return 0, err
	}
	return parsed, nil
}

// /\ OTC coefficients are fractional rates, so unlike prices they may be decimals.
func parseWallGoldRate(raw json.RawMessage) (float64, error) {
	var rate float64
	if err := json.Unmarshal(raw, &rate); err == nil {
		return rate, nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return 0, err
	}
	rate, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
	if err != nil {
		return 0, err
	}
	return rate, nil
}
