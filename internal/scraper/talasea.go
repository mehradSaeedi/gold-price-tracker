package scraper

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
)

type talaseaResponse struct {
	Price json.RawMessage `json:"price"`
	Fee   json.RawMessage `json:"fee"`
}

type TalaseaScraper struct {
	Client *http.Client
}

func (s TalaseaScraper) GetPrice() (Price, error) {
	url := "https://api.talasea.ir/api/market/getGoldPrice"

	resp, err := s.Client.Get(url)
	if err != nil {
		return Price{}, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Talasea returned http status %d", resp.StatusCode)
	}

	var data talaseaResponse

	if err = json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Price{}, fmt.Errorf("decode Talasea response: %w", err)
	}
	basePrice, err := parseTalaseaNumber(data.Price)
	if err != nil {
		return Price{}, fmt.Errorf("decode Talasea price: %w", err)
	}
	fee, err := parseTalaseaNumber(data.Fee)
	if err != nil {
		return Price{}, fmt.Errorf("decode Talasea fee: %w", err)
	}

	return Price{
		Site: "Talasea",
		Buy:  int64(math.Floor(basePrice * 1000 * (1 + fee))),
		Sell: int64(math.Floor(basePrice * 1000 * (1 - fee))),
		// /\ The API's fee is already applied to these buy and sell prices.
		BuyFee:             &Fee{Rate: fee},
		SellFee:            &Fee{Rate: fee},
		FeeIncludedInPrice: true,
	}, nil
}

// Talasea may encode numeric values either as JSON numbers or quoted strings.
func parseTalaseaNumber(raw json.RawMessage) (float64, error) {
	if len(raw) == 0 {
		return 0, fmt.Errorf("value is missing")
	}
	value := strings.TrimSpace(string(raw))
	if strings.HasPrefix(value, `"`) {
		var quoted string
		if err := json.Unmarshal(raw, &quoted); err != nil {
			return 0, err
		}
		value = strings.TrimSpace(quoted)
	}
	value = strings.ReplaceAll(value, ",", "")
	number, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, fmt.Errorf("%q is not numeric: %w", value, err)
	}
	return number, nil
}
