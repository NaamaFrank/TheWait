-- The Wait: schema.
--
-- Applied on boot by server/db/migrate.js, which runs each numbered step once
-- and records it. Every statement here must be safe to run against a database
-- that already has it - hence IF NOT EXISTS throughout.
--
-- Identifiers are the device's UUID, generated on the client. There is no user
-- table and no credentials: a device row *is* the account.

CREATE TABLE IF NOT EXISTS devices (
  device_id     uuid PRIMARY KEY,
  city_id       integer      NOT NULL,
  location_mode text         NOT NULL DEFAULT 'manual'
                             CHECK (location_mode IN ('manual', 'device')),
  display_name  text         NOT NULL,
  status        text,
  tint          text         NOT NULL,
  visible       boolean      NOT NULL DEFAULT true,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  last_seen_at  timestamptz  NOT NULL DEFAULT now()
);

-- The leaderboard walks devices that scored this week; it never scans by name.
CREATE INDEX IF NOT EXISTS devices_last_seen_idx ON devices (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id               uuid PRIMARY KEY,
  device_id        uuid        NOT NULL REFERENCES devices (device_id) ON DELETE CASCADE,
  -- The client's id for the wait. Tasks cleared during it carry the same one,
  -- which is how a wait is tied to what was done in it.
  wait_id          uuid,
  label            text        NOT NULL,
  duration_seconds integer     NOT NULL CHECK (duration_seconds >= 0),
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz NOT NULL,
  city_id          integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Every read of a session is "this device, newest first, within a window".
CREATE INDEX IF NOT EXISTS sessions_device_started_idx
  ON sessions (device_id, started_at DESC);

-- Completions join to sessions on wait_id, so it has to be findable.
CREATE INDEX IF NOT EXISTS sessions_wait_idx ON sessions (wait_id) WHERE wait_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS completions (
  id            uuid PRIMARY KEY,
  device_id     uuid        NOT NULL REFERENCES devices (device_id) ON DELETE CASCADE,
  suggestion_id text        NOT NULL,
  category      text        NOT NULL,
  bucket        text        NOT NULL,
  wait_id       uuid,
  -- Priced from the catalogue on the server; the client never sets it.
  xp            integer     NOT NULL CHECK (xp >= 0),
  completed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS completions_device_time_idx
  ON completions (device_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS completions_wait_idx ON completions (wait_id) WHERE wait_id IS NOT NULL;

-- The leaderboard sums xp per device over a window, across all devices.
CREATE INDEX IF NOT EXISTS completions_time_idx ON completions (completed_at DESC);
