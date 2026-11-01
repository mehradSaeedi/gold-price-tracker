package scraper

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const snappSarmayehPriceURL = "https://app.snappsarmayeh.ir/api/lannister/api/web/v1/asset/price"

type SnappSarmayehScraper struct {
	Client      *http.Client
	tokens      *snappTokenManager
	fingerprint string
}

type snappAssetPrice struct {
	AssetDTO  snappAssetDTO   `json:"assetDto"`
	Price     json.RawMessage `json:"price"`
	Change24h json.RawMessage `json:"change24h"`
}

type snappAssetDTO struct {
	AssetType         string          `json:"assetType"`
	UnitType          string          `json:"unitType"`
	BuyFeePercentage  json.RawMessage `json:"buyFeePercentage"`
	SellFeePercentage json.RawMessage `json:"sellFeePercentage"`
}

type snappAssetPriceResponse struct {
	AssetPriceDTOList []snappAssetPrice `json:"assetPriceDtoList"`
}

func (s SnappSarmayehScraper) GetPrice() (Price, error) {
	if s.tokens == nil {
		return Price{}, errors.New("Snapp Sarmayeh OAuth is not configured")
	}

	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	token, err := s.tokens.accessToken()
	if err != nil {
		return Price{}, fmt.Errorf("refresh Snapp Sarmayeh access token: %w", err)
	}
	resp, err := s.getPriceResponse(client, token)
	if err != nil {
		return Price{}, err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		resp.Body.Close()
		token, err = s.tokens.refreshAfterUnauthorized(token)
		if err != nil {
			return Price{}, fmt.Errorf("refresh Snapp Sarmayeh access token after HTTP 401: %w", err)
		}
		resp, err = s.getPriceResponse(client, token)
		if err != nil {
			return Price{}, err
		}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Snapp Sarmayeh app API returned HTTP status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return Price{}, fmt.Errorf("read Snapp Sarmayeh app response: %w", err)
	}
	response, err := decodeSnappAssetPriceResponse(body)
	if err != nil {
		return Price{}, fmt.Errorf("decode Snapp Sarmayeh app response: %w", err)
	}
	return parseSnappAssetPrice(response)
}

func (s SnappSarmayehScraper) getPriceResponse(client *http.Client, token string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, snappSarmayehPriceURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create Snapp Sarmayeh request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	if s.fingerprint != "" {
		req.Header.Set("X-Raw-Fingerprint", s.fingerprint)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request Snapp Sarmayeh app price: %w", err)
	}
	return resp, nil
}

func decodeSnappAssetPriceResponse(body []byte) (snappAssetPriceResponse, error) {
	var lists []json.RawMessage
	if err := findSnappAssetPriceLists(body, &lists); err != nil {
		return snappAssetPriceResponse{}, err
	}
	if len(lists) == 0 {
		return snappAssetPriceResponse{}, errors.New("response has no assetPriceDtoList")
	}
	if len(lists) > 1 {
		return snappAssetPriceResponse{}, errors.New("response has multiple assetPriceDtoList fields")
	}
	var response snappAssetPriceResponse
	if err := json.Unmarshal(lists[0], &response.AssetPriceDTOList); err != nil {
		return snappAssetPriceResponse{}, fmt.Errorf("decode assetPriceDtoList: %w", err)
	}
	return response, nil
}

func findSnappAssetPriceLists(raw []byte, lists *[]json.RawMessage) error {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return nil
	}
	switch trimmed[0] {
	case '{':
		var object map[string]json.RawMessage
		if err := json.Unmarshal(raw, &object); err != nil {
			return err
		}
		for key, value := range object {
			if key == "assetPriceDtoList" {
				*lists = append(*lists, value)
				continue
			}
			if err := findSnappAssetPriceLists(value, lists); err != nil {
				return err
			}
		}
	case '[':
		var array []json.RawMessage
		if err := json.Unmarshal(raw, &array); err != nil {
			return err
		}
		for _, value := range array {
			if err := findSnappAssetPriceLists(value, lists); err != nil {
				return err
			}
		}
	}
	return nil
}

func parseSnappAssetPrice(response snappAssetPriceResponse) (Price, error) {
	var gold *snappAssetPrice
	for i := range response.AssetPriceDTOList {
		if response.AssetPriceDTOList[i].AssetDTO.AssetType != "GOLD" {
			continue
		}
		if gold != nil {
			return Price{}, errors.New("Snapp Sarmayeh response contains multiple GOLD assets")
		}
		gold = &response.AssetPriceDTOList[i]
	}
	if gold == nil {
		assetTypes := make([]string, 0, len(response.AssetPriceDTOList))
		for _, asset := range response.AssetPriceDTOList {
			assetTypes = append(assetTypes, fmt.Sprintf("%q", asset.AssetDTO.AssetType))
		}
		return Price{}, fmt.Errorf("Snapp Sarmayeh response contains no GOLD asset (asset types: %s)", strings.Join(assetTypes, ", "))
	}

	priceValue, err := snappDecimal(gold.Price)
	if err != nil || math.IsNaN(priceValue) || math.IsInf(priceValue, 0) || priceValue <= 0 {
		return Price{}, errors.New("Snapp Sarmayeh GOLD asset has an invalid price")
	}
	buyFeePercentage, err := snappDecimal(gold.AssetDTO.BuyFeePercentage)
	if err != nil || math.IsNaN(buyFeePercentage) || math.IsInf(buyFeePercentage, 0) || buyFeePercentage < 0 || buyFeePercentage > 1 {
		return Price{}, errors.New("Snapp Sarmayeh GOLD asset has an invalid buyFeePercentage")
	}
	sellFeePercentage, err := snappDecimal(gold.AssetDTO.SellFeePercentage)
	if err != nil || math.IsNaN(sellFeePercentage) || math.IsInf(sellFeePercentage, 0) || sellFeePercentage < 0 || sellFeePercentage > 1 {
		return Price{}, errors.New("Snapp Sarmayeh GOLD asset has an invalid sellFeePercentage")
	}
	change24h, err := snappDecimal(gold.Change24h)
	if err != nil || math.IsNaN(change24h) || math.IsInf(change24h, 0) {
		return Price{}, errors.New("Snapp Sarmayeh GOLD asset has an invalid change24h")
	}

	// Price observations are stored as integer toman per gram. Snapp's
	// MILLI_GRAM quote is rial per milligram: multiply by 1,000 milligrams per
	// gram and divide by 10 rial per toman, for a net factor of 100.
	var pricePerGram float64
	switch gold.AssetDTO.UnitType {
	case "MILLI_GRAM":
		pricePerGram = priceValue * 100
	case "GRAM":
		pricePerGram = priceValue
	default:
		return Price{}, fmt.Errorf("unsupported Snapp Sarmayeh GOLD unitType %q", gold.AssetDTO.UnitType)
	}
	if pricePerGram > math.MaxInt64 {
		return Price{}, errors.New("Snapp Sarmayeh GOLD price exceeds supported range")
	}
	price := int64(math.Round(pricePerGram))
	return Price{
		Site:           "Snapp Sarmayeh",
		Buy:            price,
		Sell:           price,
		BuyFee:         &Fee{Rate: buyFeePercentage},
		SellFee:        &Fee{Rate: sellFeePercentage},
		Change24h:      change24h,
		UnitType:       "TOMAN_PER_GRAM",
		SourceUnitType: gold.AssetDTO.UnitType,
		Available:      true,
	}, nil
}

func snappDecimal(raw json.RawMessage) (float64, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, errors.New("missing decimal")
	}
	var number json.Number
	if err := json.Unmarshal(raw, &number); err == nil {
		return number.Float64()
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return 0, err
	}
	return strconv.ParseFloat(strings.ReplaceAll(text, ",", ""), 64)
}
