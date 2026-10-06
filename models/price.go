package models

import "time"

type Price struct {
	Site      string
	Buy       int64
	Sell      int64
	TimeStamp time.Time
}
