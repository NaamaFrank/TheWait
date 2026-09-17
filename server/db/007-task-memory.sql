-- What the queue remembers about you.
--
-- Two gaps this closes. The first: "Next" was the most-pressed button in the
-- app and recorded nothing, so a suggestion you had turned down eleven times
-- looked exactly like one you had never seen. The second: every task came out
-- of a fixed catalogue written for a stranger, and nobody can write two
-- hundred good twenty-minute tasks for someone they have never met - but you
-- know three.

-- Suggestions you have turned down, counted rather than logged one row per
-- press: the queue only ever asks "how often, and is it blocked".
CREATE TABLE IF NOT EXISTS task_skips (
  account_id      uuid        NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  suggestion_id   text        NOT NULL,
  skips           integer     NOT NULL DEFAULT 0 CHECK (skips >= 0),
  -- Set by "never show me this again", which is a different thing from
  -- skipping it today because you are not in the mood.
  blocked         boolean     NOT NULL DEFAULT false,
  last_skipped_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, suggestion_id)
);

-- Tasks you wrote yourself. They sit in the same queue as the catalogue's, so
-- a wait offers them exactly the way it offers anything else.
CREATE TABLE IF NOT EXISTS user_tasks (
  id          uuid        PRIMARY KEY,
  account_id  uuid        NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  title       text        NOT NULL CHECK (length(btrim(title)) > 0),
  -- Which size of wait it suits, using the catalogue's own buckets.
  bucket      text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Kept rather than deleted, so a completion that points at it still resolves.
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS user_tasks_account_idx
  ON user_tasks (account_id) WHERE archived_at IS NULL;
