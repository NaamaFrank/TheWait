-- Accounts: one person, any number of devices.
--
-- Identity used to be the device. Opening the app on a laptop after using it on
-- a phone therefore produced two unrelated users with separate XP, streaks and
-- history. The profile and everything earned now belong to an account, and a
-- device is one way of reaching it.
--
-- Existing devices each become their own account, so nothing is lost and nobody
-- is merged with a stranger. Linking is opt-in, through a pairing code.

CREATE TABLE IF NOT EXISTS accounts (
  account_id    uuid PRIMARY KEY,
  display_name  text        NOT NULL,
  status        text,
  city_id       integer     NOT NULL,
  location_mode text        NOT NULL DEFAULT 'manual'
                            CHECK (location_mode IN ('manual', 'device')),
  tint          text        NOT NULL,
  visible       boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- Devices hang off an account. The profile columns move up to the account.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts (account_id) ON DELETE CASCADE;

-- Every existing device becomes an account carrying its current profile.
INSERT INTO accounts (account_id, display_name, status, city_id, location_mode, tint, visible, created_at, last_seen_at)
SELECT device_id, display_name, status, city_id, location_mode, tint, visible, created_at, last_seen_at
FROM devices
WHERE account_id IS NULL
ON CONFLICT (account_id) DO NOTHING;

UPDATE devices SET account_id = device_id WHERE account_id IS NULL;

ALTER TABLE devices ALTER COLUMN account_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS devices_account_idx ON devices (account_id);

-- What was earned belongs to the account, not the device that logged it. The
-- device is kept alongside as provenance, and may outlive nothing in particular.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts (account_id) ON DELETE CASCADE;
ALTER TABLE completions ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts (account_id) ON DELETE CASCADE;

UPDATE sessions s SET account_id = d.account_id
FROM devices d WHERE d.device_id = s.device_id AND s.account_id IS NULL;

UPDATE completions c SET account_id = d.account_id
FROM devices d WHERE d.device_id = c.device_id AND c.account_id IS NULL;

ALTER TABLE sessions ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE completions ALTER COLUMN account_id SET NOT NULL;

-- A device can be unlinked without erasing the history it recorded.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_device_id_fkey;
ALTER TABLE completions DROP CONSTRAINT IF EXISTS completions_device_id_fkey;
ALTER TABLE sessions ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE completions ALTER COLUMN device_id DROP NOT NULL;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_device_id_fkey
  FOREIGN KEY (device_id) REFERENCES devices (device_id) ON DELETE SET NULL;

ALTER TABLE completions
  ADD CONSTRAINT completions_device_id_fkey
  FOREIGN KEY (device_id) REFERENCES devices (device_id) ON DELETE SET NULL;

-- Every read is by account now.
CREATE INDEX IF NOT EXISTS sessions_account_started_idx ON sessions (account_id, started_at DESC);
CREATE INDEX IF NOT EXISTS completions_account_time_idx ON completions (account_id, completed_at DESC);

DROP INDEX IF EXISTS sessions_device_started_idx;
DROP INDEX IF EXISTS completions_device_time_idx;

/*
 * Pairing codes.
 *
 * Short-lived and single use: claiming one is an UPDATE guarded on both, so two
 * racing claims cannot both succeed. Nothing here is ever published - a code in
 * flight is as good as the account it points at.
 */
CREATE TABLE IF NOT EXISTS pairing_codes (
  code       text PRIMARY KEY,
  account_id uuid        NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  attempts   integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS pairing_codes_expiry_idx ON pairing_codes (expires_at);
