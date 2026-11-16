CREATE INDEX CONCURRENTLY IF NOT EXISTS price_observations_site_fetched_at_id_idx
    ON price_observations (site, fetched_at DESC, id DESC);
