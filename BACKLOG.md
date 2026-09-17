# Backlog

Everything raised during the build and not shipped, with why it was left.
Grouped by how it got here, because that changes how much it is owed.

Current branch: `rebuild-postgres-and-ui`.

---

## Unfinished work

Nothing outstanding. Both items that were stated and not delivered are done:

- ~~**Chains of small steps for long waits.**~~ Eight routines in the
  catalogue, three or four steps each, offered on waits long enough to be
  worth one. Every step is a whole small thing and scores on its own, so an
  answer arriving mid-routine costs nothing. A routine is worth exactly what
  one task of that size is worth - the remainder of the division goes to the
  earliest steps, because a routine that quietly pays less than the task it
  replaces is a reason not to start one.
- ~~**Remember what has been shown, across waits.**~~ `task_skips` is now
  `task_memory`, since it is no longer only about skips. The screen reports
  each task as it is painted rather than when the queue is built - a build
  hands back a batch and only the first of it is seen. The last dozen shown
  are held back and come round again after that, which is a far softer signal
  than a skip: you may have cleared it, or the answer simply arrived.

---

## Deferred by agreement

Discussed, agreed to leave, still worth doing.

- ~~**Close the loop with the agent.**~~ Done for Claude Code, and without an
  extension: it has a hook system, so `UserPromptSubmit` opens a wait and
  `Stop` closes it. Scoped `twk_` tokens, loopback only, two endpoints,
  hashed at rest, revocable - see the README.
- **Cursor, and the browsers.** Cursor is VS Code-based, so an extension could
  hook its chat lifecycle, but there is no documented equivalent of Claude
  Code's hooks and that needs checking rather than assuming. claude.ai and
  ChatGPT in a browser still need a browser extension; the hook route does not
  reach them.
- **Concurrent waits.** One wait per account, so two Claude Code sessions at
  once means the second `start` replaces the first. The token would need to
  carry a session id, and `active_waits` a row per session rather than per
  account.
- **"Got a minute?" mode.** The task engine without a wait running. Worth
  knowing the server already accepts a completion with a null `waitId` - it
  scores and belongs to no wait - so this is an entry point, not a feature.
  A quarter of the completions on the development account arrived this way.
- **Multi-wait threads.** A thing picked up across several waits: one page of
  an article, three waits running. Needs its own table and its own screen; the
  larger sibling of the chains above.

---

## Offered, not chosen

Presented as alternatives; another option was picked. Recorded so the thinking
is not lost.

- **Share card: the day strip as hero.** The 24-hour strip, large, with "I wait
  at 8am" as the headline. The most personal-feeling chart in the app.
- **Share card: Wrapped.** Three or four swipeable panels, one number each.
  Highest ceiling, most work, and it wants more history than a new account has.
- **Auto-pause a wait after a long silence.** Proposed, then dropped: the
  rescue prompt is strictly better, because pausing still freezes the clock at
  a moment that has already passed, and the prompt offers a real end time.
- **Sound on clearing a task.** Haptic and the XP pop were built instead. Audio
  needs a preference to go with it, and nobody asked for one.

---

## Known gaps

Flagged during the work, never turned into a task.

- **The long bucket is thin.** 28 items for waits over fifteen minutes, against
  50 for waits under a minute - two of the 28 are "play", three are "connect".
  Waits of 15m+ were 44% of the development account's history, so this is the
  bucket that matters most and says least. Your own tasks work around it; they
  do not fix it.
- **Skips are per-account only.** There is no way to ask which suggestions
  *everyone* skips, which is the query that would let the catalogue be pruned
  and rewritten on evidence. `task_memory` has the data; nothing aggregates
  across accounts.
- **Nothing to do on the globe but look.** No wave, no reaction, no way to see
  what the person in São Paulo did with their two minutes. The globe is the
  app's most distinctive asset and is currently read-only.
- **QR for pairing codes.** The code is typed by hand today. A QR on the
  showing device would remove the typing and the transcription errors with it.
- **Non-Latin city search.** The GeoNames catalogue ships alternate names and
  the importer drops them, so searching for a city in its own script finds
  nothing.
- **Presence and live updates are in-process.** `server/domain/presence.js`
  holds live waiters in a `Map`, and `server/domain/events.js` holds the open
  screens the same way, so a second instance would show a different globe and
  miss half the pushed changes. Both need Redis or equivalent (pub/sub for the
  events) before running more than one.
- **"My country" uses a point, not an extent.** Focusing a country frames it
  from its centroid at a fixed zoom rather than fitting its actual bounds, so
  Chile and Luxembourg get the same treatment.

---

## Housekeeping

- **`main` is behind.** All work is on `rebuild-postgres-and-ui`.
  `git checkout main && git merge --ff-only rebuild-postgres-and-ui` when ready.
- **The weekly recap card was removed**, at request, when the receipt share
  replaced it. The plumbing it exposed was kept: `mix` carries seconds, and
  `progress` stopped crediting abandoned waits.
- **`@napi-rs/canvas` is installed but unsaved.** A preview tool for rendering
  the share cards to PNG so they can be looked at. Not a dependency - `pg` is
  still the only one - and it is not needed to run or test the app.
