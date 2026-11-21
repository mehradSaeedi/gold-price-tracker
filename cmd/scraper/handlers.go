package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/mehradSaeedi/gold-price-tracker/internal/storage"
)

type apiErrorResponse struct {
	Error apiError `json:"error"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// `providerStatus` is the combined response item returned by GET /api/providers.
// It includes collector health plus the provider's current quote status.
type providerStatus struct {
	providerHealth
	Available bool `json:"available"`
	Stale     bool `json:"stale"`
	Unchanged bool `json:"unchanged"`
}

// `priceStatus` is a temporary lookup value built from `priceStore`.
// Keyed by provider site so health records can be joined with quote status.
type priceStatus struct {
	Available bool
	Stale     bool
	Unchanged bool
}

type historyOptions struct {
	interval string
	seconds  int64
	grams    float64
	from     *time.Time
	to       *time.Time
	limit    int
}

func parseHistoryOptions(query url.Values) (historyOptions, error) {
	options := historyOptions{
		interval: query.Get("interval"),
		grams:    1,
		limit:    500,
	}

	seconds, ok := candleIntervals[options.interval]
	if !ok {
		return historyOptions{}, fmt.Errorf(
			"interval must be one of: 1m, 5m, 15m, 1h, 1d",
		)
	}

	options.seconds = seconds
	if rawGrams := query.Get("grams"); rawGrams != "" {
		grams, err := strconv.ParseFloat(rawGrams, 64)
		if err != nil || math.IsNaN(grams) || math.IsInf(grams, 0) || grams < 0.001 || grams > 10000 {
			return historyOptions{}, fmt.Errorf("grams must be between 0.001 and 10000")
		}
		options.grams = grams
	}

	var err error
	options.from, err = parseCandleTime(query.Get("from"))
	if err != nil {
		return historyOptions{}, err
	}

	options.to, err = parseCandleTime(query.Get("to"))
	if err != nil {
		return historyOptions{}, err
	}

	if options.from != nil && options.to != nil &&
		!options.from.Before(*options.to) {
		return historyOptions{}, fmt.Errorf("from must be earlier than to")
	}

	if rawLimit := query.Get("limit"); rawLimit != "" {
		limit, err := strconv.Atoi(rawLimit)
		if err != nil || limit < 1 || limit > 2000 {
			return historyOptions{}, fmt.Errorf("limit must be between 1 and 2000")
		}
		options.limit = limit
	}

	return options, nil
}

func writeAPIError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(apiErrorResponse{
		Error: apiError{Code: code, Message: message},
	}); err != nil {
		log.Printf("encode API error: %v", err)
	}

}

// /\ These fixed choices let the API accept friendly interval names without trusting arbitrary SQL input.
var candleIntervals = map[string]int64{
	"1m":  60,
	"5m":  5 * 60,
	"15m": 15 * 60,
	"1h":  60 * 60,
	"1d":  24 * 60 * 60,
}

// /\ parseCandleTime accepts optional RFC3339 timestamps and normalizes them to UTC.
func parseCandleTime(value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil, fmt.Errorf("time must be RFC3339, for example 2026-10-07T10:30:00Z")
	}
	parsed = parsed.UTC()
	return &parsed, nil
}

func registerAPIHandlers(mux *http.ServeMux, store *priceStore, health *healthStore, database *storage.Postgres) {
	// /\ The page polls this endpoint to fill its price table.
	mux.HandleFunc("/api/prices", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeAPIError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if err := json.NewEncoder(w).Encode(store.list()); err != nil {
			log.Printf("encode prices: %v", err)
		}
	})

	// /\ Return OHLC candles derived from raw observations, with newest history bounded by a result limit.
	mux.HandleFunc("/api/candles", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeAPIError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
			return
		}
		query := r.URL.Query()
		site := query.Get("site")
		if site == "" {
			writeAPIError(w, http.StatusBadRequest, "invalid_parameter", "site is required")
			return
		}

		options, err := parseHistoryOptions(query)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid_parameter", err.Error())
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		candles, err := database.Candles(
			ctx,
			site,
			options.interval,
			options.seconds,
			options.from,
			options.to,
			options.limit,
			options.grams,
		)

		if err != nil {
			log.Printf("load %s %s candles: %v", site, options.interval, err)
			writeAPIError(w, http.StatusInternalServerError, "internal_error", "could not load candles")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if err := json.NewEncoder(w).Encode(candles); err != nil {
			log.Printf("encode candles: %v", err)
		}
	})

	// /\\ Return the winning fee-aware buy and sell provider in each market-history bucket.
	mux.HandleFunc("/api/best-offers", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeAPIError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
			return
		}

		query := r.URL.Query()

		options, err := parseHistoryOptions(query)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid_parameter", err.Error())
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		configuredSites := store.list()
		sites := make([]string, 0, len(configuredSites))
		for _, price := range configuredSites {
			if !price.Unchanged {
				sites = append(sites, price.Site)
			}
		}
		points, err := database.BestOffers(ctx,
			options.interval,
			options.seconds,
			options.from,
			options.to,
			options.limit,
			options.grams,
			sites)
		if err != nil {
			log.Printf("load %s best offers: %v", options.interval, err)
			writeAPIError(w, http.StatusInternalServerError, "internal_error", "could not load best offers")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if err := json.NewEncoder(w).Encode(points); err != nil {
			log.Printf("encode best offers: %v", err)
		}
	})

	mux.HandleFunc("/api/providers", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeAPIError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")

		// `healthProviders` contains the attempt and error information
		healthProviders := health.list()
		// `prices` contains `Available` and `Stale`
		prices := store.list()
		priceBySite := make(map[string]priceStatus, len(prices))
		for _, price := range prices {
			priceBySite[price.Site] = priceStatus{
				Available: price.Available,
				Stale:     price.Stale,
				Unchanged: price.Unchanged,
			}
		}

		result := make([]providerStatus, 0, len(healthProviders))
		for _, provider := range healthProviders {
			price := priceBySite[provider.Site]
			result = append(result, providerStatus{
				providerHealth: provider,
				Available:      price.Available,
				Stale:          price.Stale,
				Unchanged:      price.Unchanged,
			})
		}

		if err := json.NewEncoder(w).Encode(result); err != nil {
			log.Printf("encode providers: %v", err)
		}
	})

}
