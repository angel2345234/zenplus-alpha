BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_domain_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_domain_events_aggregate
    ON public.inventory_domain_events
    (aggregate_type, aggregate_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_domain_events_type_time
    ON public.inventory_domain_events
    (event_type, occurred_at DESC);

COMMIT;