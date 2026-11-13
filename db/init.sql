-- Fut a Postgres első indulásakor. Létrehozza a "support" adatbázist és a tickets táblát.
CREATE DATABASE support;
\connect support

CREATE TABLE tickets (
    id                 BIGSERIAL PRIMARY KEY,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    message_id         TEXT UNIQUE,
    from_email         TEXT NOT NULL,
    subject            TEXT,
    body               TEXT,
    language           TEXT,
    category           TEXT NOT NULL,
    priority           TEXT NOT NULL,          -- P1..P4
    sentiment          TEXT,
    summary            TEXT,
    confidence         NUMERIC(4,3),
    queue              TEXT NOT NULL,          -- melyik csapathoz kerül
    status             TEXT NOT NULL DEFAULT 'open',
    guardrail_triggered BOOLEAN NOT NULL DEFAULT false,
    guardrail_reasons  JSONB NOT NULL DEFAULT '[]'::jsonb,
    llm_model          TEXT,
    llm_latency_ms     INTEGER,
    prompt_tokens      INTEGER,
    completion_tokens  INTEGER
);

CREATE INDEX tickets_queue_status_idx ON tickets (queue, status);

-- Gyors áttekintő nézet
CREATE VIEW ticket_stats AS
SELECT category, priority, queue,
       count(*)                                   AS tickets,
       round(avg(confidence), 3)                  AS avg_confidence,
       round(avg(llm_latency_ms))                 AS avg_latency_ms,
       sum(CASE WHEN guardrail_triggered THEN 1 ELSE 0 END) AS guardrail_hits
FROM tickets
GROUP BY category, priority, queue;
