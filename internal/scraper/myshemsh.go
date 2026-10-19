package scraper

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"

	"github.com/gorilla/websocket"
)

// /\ Keep the base API quotes and the fee-adjusted values from the same event so we can compare them.
type myshemshCurrentPrice struct {
	APIBuy  int64   `json:"api_buy"`
	Buy     float64 `json:"buy"`
	Sell    float64 `json:"sell"`
	APISell int64   `json:"api_sell"`
}

// /\ Hold the event name separately from its JSON payload because other events may have a different shape.
type myshemshEvent struct {
	Name string
	Data json.RawMessage
}

// /\ Remove Socket.IO's 42 event marker, then decode the event name and raw data array entries.
func decodeMyshemshEvent(frame []byte) (myshemshEvent, error) {
	var parts []json.RawMessage

	if !bytes.HasPrefix(frame, []byte("42")) {
		return myshemshEvent{}, fmt.Errorf("Not a Socket.IO event frame")
	}

	if err := json.Unmarshal(frame[2:], &parts); err != nil {
		return myshemshEvent{}, err
	}
	if len(parts) != 2 {
		return myshemshEvent{}, fmt.Errorf("Expected event name and data")
	}
	var event myshemshEvent
	if err := json.Unmarshal(parts[0], &event.Name); err != nil {
		return myshemshEvent{}, err
	}

	event.Data = parts[1]

	return event, nil
}

// /\ Ignore non-price events and decode only current_price messages into the matching struct.
func decodeMyshemshPrice(frame []byte) (myshemshCurrentPrice, bool, error) {
	event, err := decodeMyshemshEvent(frame)
	if err != nil {
		return myshemshCurrentPrice{}, false, err
	}

	if event.Name != "current_price" {
		return myshemshCurrentPrice{}, false, nil
	}

	var price myshemshCurrentPrice
	if err := json.Unmarshal(event.Data, &price); err != nil {
		return myshemshCurrentPrice{}, false, err
	}
	if price.APIBuy <= 0 || price.APISell <= 0 || price.Buy <= 0 || price.Sell <= 0 || math.IsNaN(price.Buy) || math.IsInf(price.Buy, 0) || math.IsNaN(price.Sell) || math.IsInf(price.Sell, 0) {
		return myshemshCurrentPrice{}, false, fmt.Errorf("Myshemsh sent invalid gold prices")
	}

	return price, true, nil
}

// /\ Map Myshemsh's pre-fee API quotes into the shared model; the dashboard applies each known 1% fee once.
func myshemshPriceFromUpdate(update myshemshCurrentPrice) Price {
	return Price{
		Site:    "Myshemsh",
		Source:  "Myshemsh Socket.IO",
		Buy:     update.APIBuy,
		Sell:    update.APISell,
		BuyFee:  &Fee{Rate: 0.01},
		SellFee: &Fee{Rate: 0.01},
	}
}

// /\ Keep the Socket.IO URL configurable so the connection can be reused after a disconnect.
type MyshemshScraper struct {
	URI string
}

// /\ Provide the known public Socket.IO endpoint used by Myshemsh's website.
func NewMyshemshScraper() *MyshemshScraper {
	return &MyshemshScraper{
		URI: "wss://myshemsh.ir/socket.io/?EIO=4&transport=websocket",
	}
}

// /\ Complete Engine.IO and Socket.IO setup, then register for Myshemsh's gold price stream.
func (s *MyshemshScraper) connect() (*websocket.Conn, error) {
	uri := s.URI
	if uri == "" {
		uri = "wss://myshemsh.ir/socket.io/?EIO=4&transport=websocket"
	}
	header := http.Header{}
	header.Set("Origin", "https://myshemsh.ir")

	conn, _, err := websocket.DefaultDialer.Dial(uri, header)
	if err != nil {
		return nil, fmt.Errorf("Myshemsh WebSocket dial failed: %w", err)
	}

	_, firstFrame, err := conn.ReadMessage()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("Myshemsh initial WebSocket read failed: %w", err)
	}

	if len(firstFrame) == 0 || firstFrame[0] != '0' {
		conn.Close()
		return nil, fmt.Errorf("unexpected Myshemsh handshake frame: %q", firstFrame)
	}

	if err := conn.WriteMessage(websocket.TextMessage, []byte("40")); err != nil {
		conn.Close()
		return nil, fmt.Errorf("Myshemsh namespace connect failed: %w", err)
	}

	for {
		_, frame, err := conn.ReadMessage()
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("Myshemsh namespace response failed: %w", err)
		}
		switch {
		case bytes.HasPrefix(frame, []byte("40")):
			if err := conn.WriteMessage(websocket.TextMessage, []byte(`42["register",1]`)); err != nil {
				conn.Close()
				return nil, fmt.Errorf("Myshemsh price registration failed: %w", err)
			}
			return conn, nil
		case bytes.HasPrefix(frame, []byte("2")):
			if err := conn.WriteMessage(websocket.TextMessage, []byte("3")); err != nil {
				conn.Close()
				return nil, fmt.Errorf("Myshemsh ping response failed: %w", err)
			}
		case bytes.HasPrefix(frame, []byte("44")):
			conn.Close()
			return nil, fmt.Errorf("Myshemsh rejected namespace connection: %s", frame)
		}
	}
}

// /\\ Keep the Socket.IO subscription alive and forward each gold quote to the shared collector.
func (s *MyshemshScraper) Start(prices chan<- Price) error {
	conn, err := s.connect()
	if err != nil {
		return err
	}
	defer conn.Close()

	for {
		messageType, frame, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("Myshemsh WebSocket read failed: %w", err)
		}
		if messageType != websocket.TextMessage {
			continue
		}

		if bytes.HasPrefix(frame, []byte("2")) {
			if err := conn.WriteMessage(websocket.TextMessage, []byte("3")); err != nil {
				return fmt.Errorf("Myshemsh ping response failed: %w", err)
			}
			continue
		}
		if bytes.HasPrefix(frame, []byte("41")) || bytes.Equal(frame, []byte("1")) {
			return fmt.Errorf("Myshemsh closed the Socket.IO connection")
		}
		if !bytes.HasPrefix(frame, []byte("42")) {
			continue
		}

		update, ok, err := decodeMyshemshPrice(frame)
		if err != nil {
			log.Printf("Myshemsh: ignoring malformed price update: %v", err)
			continue
		}
		if ok {
			prices <- myshemshPriceFromUpdate(update)
		}
	}
}
