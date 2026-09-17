-- Tokens for agents that start and end waits on your behalf.
--
-- A Claude Code hook can open a wait the moment a prompt is sent and close it
-- when the turn finishes, which is the whole loop with no button to forget.
-- The hook needs a credential, and the device id is the wrong one: it is the
-- only thing the rest of the API checks, it never expires, and it grants
-- everything - history, profile, the right to mint pairing codes. Hook
-- commands live in settings files that get committed and screenshared.
--
-- So: a separate credential that can do two things and nothing else.
--
-- Only a hash is stored. The token is 32 random bytes, so a fast hash is the
-- right tool - there is nothing to brute force - but it does mean a copy of
-- this table is not a copy of anyone's tokens.

CREATE TABLE IF NOT EXISTS agent_tokens (
  id           uuid        PRIMARY KEY,
  account_id   uuid        NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  -- sha256 of the token as issued. The token itself is shown once and never
  -- again, exactly like the pairing codes.
  token_hash   text        NOT NULL UNIQUE,
  label        text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  -- Kept rather than deleted, so "revoked last Tuesday" is still answerable.
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS agent_tokens_account_idx
  ON agent_tokens (account_id, created_at DESC);
