-- The wait in progress.
--
-- The clock used to live in each browser's localStorage, so a wait started on a
-- phone was invisible on the laptop signed in to the same account - the phone
-- said "paused" while the desktop counted up. There is one wait per account,
-- and every device reads it from here.
--
-- The phase is derived rather than stored: no row means idle, `resumed_at` set
-- means running, and null means paused. One fact, so the three cannot disagree.

CREATE TABLE IF NOT EXISTS active_waits (
  account_id     uuid PRIMARY KEY REFERENCES accounts (account_id) ON DELETE CASCADE,
  -- The id the completed session and its cleared tasks will both carry.
  wait_id        uuid        NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  -- Time banked before the current run; the live segment is added on read.
  accumulated_ms integer     NOT NULL DEFAULT 0 CHECK (accumulated_ms >= 0),
  resumed_at     timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
