-- What the queue has already put in front of you.
--
-- `task_skips` only ever recorded an explicit press of Next, so a suggestion
-- shown and quietly ignored - you cleared something else, or the answer landed
-- and you closed the screen - was invisible. The queue could not tell a task
-- you had never seen from one it had offered you four waits running, which is
-- exactly the repetition it was meant to avoid.
--
-- The table is no longer only about skips, so it is renamed to say what it is:
-- everything the queue remembers about one suggestion for one account.

ALTER TABLE IF EXISTS task_skips RENAME TO task_memory;

ALTER TABLE task_memory
  ADD COLUMN IF NOT EXISTS shown integer NOT NULL DEFAULT 0 CHECK (shown >= 0);

ALTER TABLE task_memory
  ADD COLUMN IF NOT EXISTS last_shown_at timestamptz;

-- The queue asks for the most recently shown handful on every build.
CREATE INDEX IF NOT EXISTS task_memory_recent_idx
  ON task_memory (account_id, last_shown_at DESC NULLS LAST);
