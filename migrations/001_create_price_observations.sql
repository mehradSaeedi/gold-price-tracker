-- /\ This first migration creates one append-only row for every quote the app accepts.
CREATE TABLE IF NOT EXISTS price_observations (
    -- /\ Identity gives every reading a stable ID, even when a provider repeats a price.
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- /\ These labels tell us whose quote this is and where this app got it.
    site TEXT NOT NULL CHECK (site <> ''),
    source TEXT NOT NULL CHECK (source <> ''),
    -- /\ Prices are integer toman per gram in the existing scraper model.
    buy_toman BIGINT NOT NULL CHECK (buy_toman > 0),
    sell_toman BIGINT NOT NULL CHECK (sell_toman > 0),
    -- /\ NULL means unknown; zero means the source explicitly reported no fee.
    buy_fee_rate DOUBLE PRECISION NULL CHECK (buy_fee_rate IS NULL OR buy_fee_rate BETWEEN 0 AND 1),
    buy_fee_fixed_toman BIGINT NULL CHECK (buy_fee_fixed_toman IS NULL OR buy_fee_fixed_toman >= 0),
    sell_fee_rate DOUBLE PRECISION NULL CHECK (sell_fee_rate IS NULL OR sell_fee_rate BETWEEN 0 AND 1),
    sell_fee_fixed_toman BIGINT NULL CHECK (sell_fee_fixed_toman IS NULL OR sell_fee_fixed_toman >= 0),
    -- /\ A NULL pair means the fee is unknown; otherwise both components are saved together.
    CHECK ((buy_fee_rate IS NULL) = (buy_fee_fixed_toman IS NULL)),
    CHECK ((sell_fee_rate IS NULL) = (sell_fee_fixed_toman IS NULL)),
    -- /\ Source time can be missing; fetched_at is when this app collected the observation.
    fee_included_in_price BOOLEAN NOT NULL DEFAULT FALSE,
    source_timestamp TIMESTAMPTZ NULL,
    fetched_at TIMESTAMPTZ NOT NULL
);

-- /\ This index makes a provider's newest observations quick to fetch for chart history.
CREATE INDEX IF NOT EXISTS price_observations_site_fetched_at_idx
    ON price_observations (site, fetched_at DESC);
