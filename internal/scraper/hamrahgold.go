package scraper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/websocket"
)

// HamrahGold uses the Pusher protocol (protocol=7 in its WebSocket URL),
// rather than the Socket.IO protocol.
type hamrahMessage struct {
	Event   string          `json:"event"`
	Channel string          `json:"channel"`
	Data    json.RawMessage `json:"data"`
}

type hamrahPayload struct {
	Board []hamrahItem `json:"board"`
}

type hamrahItem struct {
	Symbol string          `json:"symbol"`
	Buy    json.RawMessage `json:"buy"`
	Sell   json.RawMessage `json:"sell"`
}

type HamrahScraper struct {
	URI string
}

func NewHamrahScraper() *HamrahScraper {
	return &HamrahScraper{
		URI: "wss://hgprcsh.hamrahgold.com/app/crcifq5uxcv6qdz7mgfh?protocol=7&client=js&version=8.6.0&flash=false",
	}
}

// Start connects to HamrahGold's Pusher-compatible WebSocket, subscribes to
// the public prices channel, and forwards each gold18k update to prices.
func (s *HamrahScraper) Start(prices chan<- Price) error {
	// The server checks Origin against its browser app. The PWA is the public
	// HamrahGold app domain, so identify this connection as coming from there.
	header := http.Header{}
	header.Set("Origin", "https://pwa.hamrahgold.com")
	conn, _, err := websocket.DefaultDialer.Dial(s.URI, header)
	if err != nil {
		return fmt.Errorf("HamrahGold WebSocket dial failed: %w", err)
	}
	defer conn.Close()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("HamrahGold WebSocket read failed: %w", err)
		}

		var msg hamrahMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			return fmt.Errorf("HamrahGold sent an invalid WebSocket message: %w", err)
		}

		switch msg.Event {
		case "pusher:connection_established":
			// Pusher does not send application events until we subscribe.
			subscription := struct {
				Event string `json:"event"`
				Data  struct {
					Channel string `json:"channel"`
				} `json:"data"`
			}{
				Event: "pusher:subscribe",
			}
			subscription.Data.Channel = "prices"
			if err := conn.WriteJSON(subscription); err != nil {
				return fmt.Errorf("HamrahGold prices subscription failed: %w", err)
			}
		case "pusher:error":
			return fmt.Errorf("HamrahGold rejected the WebSocket request: %s", msg.Data)
		case "pusher:subscription_succeeded":
			fmt.Println("HamrahGold: subscribed to prices")
		case "pusher:ping":
			if err := conn.WriteJSON(map[string]string{"event": "pusher:pong", "data": "{}"}); err != nil {
				return fmt.Errorf("HamrahGold pong failed: %w", err)
			}
		default:
			// The event name can vary between deployments. The prices channel
			// identifies the data we want, so accept its application events.
			if msg.Event != "updated" && msg.Channel != "prices" {
				continue
			}
			price, ok, err := parseHamrahPrice(msg)
			if err != nil {
				fmt.Printf("HamrahGold: ignoring malformed price update: %v\n", err)
				continue
			}
			if ok {
				prices <- price
			}
		}
	}
}

func parseHamrahPrice(msg hamrahMessage) (Price, bool, error) {
	if msg.Channel != "" && msg.Channel != "prices" {
		return Price{}, false, nil
	}

	// Pusher's data field is commonly a JSON-encoded string. Some publishers
	// send the object directly, so accept both representations.
	data := msg.Data
	var encoded string
	if err := json.Unmarshal(data, &encoded); err == nil {
		data = []byte(encoded)
	}

	// Also accept the envelope format used by some HamrahGold endpoints, where
	// the event data contains its own channel and another JSON data value.
	var envelope struct {
		Channel string          `json:"channel"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(data, &envelope); err == nil && len(envelope.Data) > 0 {
		if envelope.Channel != "" && envelope.Channel != "prices" {
			return Price{}, false, nil
		}
		data = envelope.Data
		if err := json.Unmarshal(data, &encoded); err == nil {
			data = []byte(encoded)
		}
	}

	var payload hamrahPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return Price{}, false, err
	}
	for _, item := range payload.Board {
		if item.Symbol != "gold18k" {
			continue
		}
		buy, err := parseHamrahAmount(item.Buy)
		if err != nil {
			return Price{}, false, fmt.Errorf("invalid buy price: %w", err)
		}
		sell, err := parseHamrahAmount(item.Sell)
		if err != nil {
			return Price{}, false, fmt.Errorf("invalid sell price: %w", err)
		}
		return Price{
			Site:    "Hamrahgold",
			Buy:     sell / 10,
			Sell:    buy / 10,
			BuyFee:  &Fee{},
			SellFee: &Fee{},
			// /\ HamrahGold advertises no transaction commission.
		}, true, nil
	}
	return Price{}, false, nil
}

func parseHamrahAmount(raw json.RawMessage) (int64, error) {
	value := strings.Trim(string(raw), `"`)
	amount, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, err
	}
	return amount, nil
}
