-- Profile photos.
--
-- These used to live in the browser that set them and were never uploaded, so
-- they did not follow you to a second device and nobody else ever saw one.
-- Both were deliberate, and both are now unwanted: a photo belongs to the
-- account and is shown to everyone.
--
-- Kept in their own table rather than a column on `accounts`, because every
-- read of an account would otherwise drag the bytes along with it.

CREATE TABLE IF NOT EXISTS avatars (
  account_id uuid PRIMARY KEY REFERENCES accounts (account_id) ON DELETE CASCADE,
  mime       text        NOT NULL,
  bytes      bytea       NOT NULL,
  -- Doubles as the cache-busting version in the URL.
  updated_at timestamptz NOT NULL DEFAULT now()
);
