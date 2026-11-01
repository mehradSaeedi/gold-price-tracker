package scraper

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

const snappResponseFixture = `{
	"assetPriceDtoList": [
		{
			"assetDto": {
				"assetType": "SILVER",
				"unitType": "GRAM",
				"buyFeePercentage": 0.5,
				"sellFeePercentage": 0.5
			},
			"price": 120,
			"change24h": 1.25
		},
		{
			"assetDto": {
				"assetType": "GOLD",
				"unitType": "MILLI_GRAM",
				"buyFeePercentage": 0.010,
				"sellFeePercentage": 0.010
			},
			"price": 257040,
			"change24h": -0.42
		}
	]
}`

func TestParseSnappAssetPriceResponse(t *testing.T) {
	response, err := decodeSnappAssetPriceResponse([]byte(snappResponseFixture))
	if err != nil {
		t.Fatal(err)
	}
	if len(response.AssetPriceDTOList) != 2 {
		t.Fatalf("assetPriceDtoList length = %d, want 2", len(response.AssetPriceDTOList))
	}
	gold := response.AssetPriceDTOList[1]
	if gold.AssetDTO.AssetType != "GOLD" {
		t.Fatalf("assetDto.assetType = %q, want GOLD", gold.AssetDTO.AssetType)
	}
	var rawPrice int64
	if err := json.Unmarshal(gold.Price, &rawPrice); err != nil {
		t.Fatalf("unmarshal sibling price: %v", err)
	}
	if rawPrice != 257040 {
		t.Fatalf("sibling price = %d, want 257040", rawPrice)
	}

	got, err := parseSnappAssetPrice(response)
	if err != nil {
		t.Fatalf("parseSnappAssetPrice returned error: %v", err)
	}
	if got.Buy != 25_704_000 || got.Sell != 25_704_000 {
		t.Errorf("prices = (%d, %d), want (25704000, 25704000) toman per gram", got.Buy, got.Sell)
	}
	if got.UnitType != "TOMAN_PER_GRAM" || got.SourceUnitType != "MILLI_GRAM" {
		t.Errorf("units = (%q, %q), want normalized TOMAN_PER_GRAM and source MILLI_GRAM", got.UnitType, got.SourceUnitType)
	}
	if got.BuyFee == nil || got.BuyFee.Rate != 0.010 {
		t.Errorf("buy fee = %+v, want 0.010 (1%%) as a fractional rate", got.BuyFee)
	}
	if got.SellFee == nil || got.SellFee.Rate != 0.010 {
		t.Errorf("sell fee = %+v, want 0.010 (1%%) as a fractional rate", got.SellFee)
	}
	if got.Change24h != -0.42 {
		t.Errorf("change24h = %v, want -0.42", got.Change24h)
	}
}

func TestDecodeSnappAssetPriceResponseInsideEnvelope(t *testing.T) {
	const wrapped = `{"response":{"assetPriceDtoList":[{"assetDto":{"assetType":"GOLD","unitType":"MILLI_GRAM","buyFeePercentage":0.010,"sellFeePercentage":0.010},"price":257040,"change24h":-0.42}]}}`
	response, err := decodeSnappAssetPriceResponse([]byte(wrapped))
	if err != nil {
		t.Fatalf("decodeSnappAssetPriceResponse returned error: %v", err)
	}
	if len(response.AssetPriceDTOList) != 1 || response.AssetPriceDTOList[0].AssetDTO.AssetType != "GOLD" {
		t.Fatalf("decoded response did not contain the GOLD asset: %+v", response.AssetPriceDTOList)
	}
	var price int64
	if err := json.Unmarshal(response.AssetPriceDTOList[0].Price, &price); err != nil {
		t.Fatalf("unmarshal sibling price: %v", err)
	}
	if price != 257040 {
		t.Errorf("price = %d, want 257040", price)
	}
}

func TestSnappSarmayehGetPriceDecodesActualResponse(t *testing.T) {
	client := &http.Client{Transport: snappRoundTripper(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "Bearer test-access-token" {
			t.Errorf("Authorization = %q, want test access token", r.Header.Get("Authorization"))
		}
		return &http.Response{
			Status:     "200 OK",
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(snappResponseFixture)),
			Request:    r,
		}, nil
	})}
	scraper, err := newTestSnappScraper(t, client)
	if err != nil {
		t.Fatal(err)
	}
	got, err := scraper.GetPrice()
	if err != nil {
		t.Fatalf("GetPrice returned error: %v", err)
	}
	if got.Buy != 25_704_000 || got.SourceUnitType != "MILLI_GRAM" {
		t.Errorf("GetPrice returned buy=%d sourceUnitType=%q, want 25704000 and MILLI_GRAM", got.Buy, got.SourceUnitType)
	}
}

type snappRoundTripper func(*http.Request) (*http.Response, error)

func (transport snappRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestParseSnappAssetPriceRequiresOneGoldAsset(t *testing.T) {
	tests := []struct {
		name     string
		response string
	}{
		{
			name:     "missing gold",
			response: `{"assetPriceDtoList":[{"assetDto":{"assetType":"SILVER"},"price":100}]}`,
		},
		{
			name: "duplicate gold",
			response: `{"assetPriceDtoList":[` +
				`{"assetDto":{"assetType":"GOLD"},"price":100},` +
				`{"assetDto":{"assetType":"GOLD"},"price":200}]}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var response snappAssetPriceResponse
			if err := json.Unmarshal([]byte(test.response), &response); err != nil {
				t.Fatal(err)
			}
			if _, err := parseSnappAssetPrice(response); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestParseSnappAssetPriceRejectsUnknownUnit(t *testing.T) {
	const responseJSON = `{"assetPriceDtoList":[{"assetDto":{"assetType":"GOLD","unitType":"OUNCE","buyFeePercentage":0,"sellFeePercentage":0},"price":100,"change24h":0}]}`
	var response snappAssetPriceResponse
	if err := json.Unmarshal([]byte(responseJSON), &response); err != nil {
		t.Fatal(err)
	}
	if _, err := parseSnappAssetPrice(response); err == nil {
		t.Fatal("expected an error for an unsupported unit")
	}
}
