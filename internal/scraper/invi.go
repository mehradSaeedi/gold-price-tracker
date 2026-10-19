package scraper

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/websocket"
)

// /\\ Invi publishes market updates in a public WebSocket message envelope.
type inviFrame struct {
	Message struct {
		Markets []inviMarket `json:"markets"`
	} `json:"message"`
}

// /\\ Keep just the gold market fields we need for the dashboard's buy and sell sides.
type inviMarket struct {
	Type     string          `json:"type"`
	Market   string          `json:"market"`
	AskPrice json.RawMessage `json:"ask_price"`
	BidPrice json.RawMessage `json:"bid_price"`
}

// /\\ Invi's quote is scaled by 100 in the socket; e.g. 261640 represents 26,164,000 Toman per gram.
const inviPriceScale = 100

// /\\ InviScraper holds the public socket endpoint so the stream can reconnect after a disconnect.
type InviScraper struct {
	URI string
}

// /\\ Use Invi's public market socket by default.
func NewInviScraper() *InviScraper {
	return &InviScraper{URI: "wss://invi.ir/ws"}
}

// /\\ Subscribe to Invi's public market updates and forward each gold quote to the shared collector.
func (s *InviScraper) Start(prices chan<- Price) error {
	uri := s.URI
	if uri == "" {
		uri = "wss://invi.ir/ws"
	}
	header := http.Header{}
	header.Set("Origin", "https://invi.ir")
	conn, _, err := websocket.DefaultDialer.Dial(uri, header)
	if err != nil {
		return fmt.Errorf("Invi WebSocket dial failed: %w", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(map[string]string{
		"channel": "markets",
		"model":   "all",
		"request": "SUBSCRIBE",
	}); err != nil {
		return fmt.Errorf("Invi markets subscription failed: %w", err)
	}
	fmt.Println("Invi: subscribed to public markets")

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("Invi WebSocket read failed: %w", err)
		}
		price, ok, err := parseInviPrice(raw)
		if err != nil {
			fmt.Printf("Invi: ignoring malformed market update: %v\n", err)
			continue
		}
		if ok {
			prices <- price
		}
	}
}

// /\\ Turn the subscribed goldirr ask/bid pair into the dashboard's Toman-per-gram quote.
func parseInviPrice(raw []byte) (Price, bool, error) {
	var frame inviFrame
	if err := json.Unmarshal(raw, &frame); err != nil {
		return Price{}, false, err
	}
	for _, market := range frame.Message.Markets {
		if market.Market != "goldirr" || (market.Type != "" && market.Type != "newprice") {
			continue
		}
		buy, err := parseInviAmount(market.AskPrice)
		if err != nil {
			return Price{}, false, fmt.Errorf("invalid ask_price: %w", err)
		}
		sell, err := parseInviAmount(market.BidPrice)
		if err != nil {
			return Price{}, false, fmt.Errorf("invalid bid_price: %w", err)
		}
		return Price{
			Site:   "Invi",
			Source: "Invi WebSocket",
			Buy:    buy,
			Sell:   sell,
			// /\\ Invi's published fee labels show a 1% charge on both sides; keep it separate from the quoted price.
			BuyFee:  &Fee{Rate: 0.01},
			SellFee: &Fee{Rate: 0.01},
		}, true, nil
	}
	return Price{}, false, nil
}

// /\\ Parse either JSON strings or numbers, apply Invi's observed scale, and reject impossible quotes.
func parseInviAmount(raw json.RawMessage) (int64, error) {
	value := strings.Trim(string(raw), `"`)
	amount, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, err
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 || amount > float64(math.MaxInt64)/inviPriceScale {
		return 0, fmt.Errorf("price is outside the supported range")
	}
	return int64(math.Round(amount * inviPriceScale)), nil
}
