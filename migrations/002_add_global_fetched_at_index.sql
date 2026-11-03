-- This index speeds up market-wide best-offer queries that filter by time across providers.
-- CONCURRENTLY avoids blocking quote inserts while PostgreSQL builds it; run this migration
-- with psql -f (CREATE INDEX CONCURRENTLY cannot run inside a transaction block).
CREATE INDEX CONCURRENTLY IF NOT EXISTS price_observations_fetched_at_idx
    ON price_observations (fetched_at DESC);
