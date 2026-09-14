-- When a device last had eyes on the running wait.
--
-- The clock counts whether or not anyone is watching, so a wait left running
-- when a laptop closed kept accruing for hours. Those sessions are not waits,
-- they are forgetfulness, and they were dragging every average and every
-- distribution on the Stats screen with them.
--
-- This is touched whenever a device reads the wait, which it does every few
-- seconds while the app is open. A large gap between `last_seen_at` and now
-- means nobody was there for that stretch - which is the honest answer to
-- "when did this wait really end?" when no task was cleared to say otherwise.

ALTER TABLE active_waits
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
