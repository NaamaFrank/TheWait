# The Wait

Things to Do While Claude Is Running — a mobile-first app that turns LLM latency
into something useful. Start a timer when you fire off a prompt, clear one small
task sized to how long you have been waiting, and watch a real globe of other
developers doing the same.

No sign-up. An anonymous account is created on first launch and everything
hangs off that. A second device joins it with a pairing code, so your phone and
your laptop are one person rather than two.

The interface implements the "Soft Toy" design: a six-screen horizontal carousel
inside a phone frame, Archivo and Baloo 2, and chunky offset-shadow buttons.

## Running it

The app needs a Postgres database. One line gets you one locally:

```bash
npm install
npm run db:up      # postgres 16 in docker, on port 55432
export DATABASE_URL=postgres://thewait:thewait@127.0.0.1:55432/thewait
npm start          # http://127.0.0.1:8080 - migrations run on boot
```

```bash
npm run dev        # same, with --watch
npm test           # 146 tests; needs TEST_DATABASE_URL or DATABASE_URL
npm run db:migrate # apply migrations without starting the server
npm run db:import  # one-off: load the old JSON files into the database
npm run db:down    # stop and remove the local container
npm run icons      # regenerate the PWA icons
npm run cities     # rebuild the city catalogue from GeoNames
```

Copy `.env.example` for the full list of settings.

One dependency (`pg`) and no build step — ES modules straight to the browser,
and Node's standard library for everything else on the server.

**Tests truncate every table.** Point `TEST_DATABASE_URL` at a throwaway
database; the suite refuses to run against one whose name does not look
disposable unless you set `THEWAIT_ALLOW_DESTRUCTIVE_TESTS=1`. They also run
one file at a time, because they share the database.

## Layout

```
server/
  config.js            environment + tunables, one place
  app.js               route registration
  index.js             migrate, then listen
  http/                router, body parsing, responses, static files, errors
  db/                  pool, migrations, schema.sql, one repository per table
  domain/              sessions, analytics, progress, leaderboard, presence,
                       suggestions, devices, cities, countries, places,
                       people, time
  routes/              thin HTTP adapters over the domain
public/
  index.html           phone frame, status strip, carousel track, dock
  manifest.webmanifest PWA manifest
  sw.js                service worker (app shell + API caching)
  offline.html         offline fallback
  data/                countries-110m + 50m + 10m, the globe's land geometry
  icons/               generated PWA icons
  styles/              tokens -> base -> components -> screens
  js/core/             api, store, carousel, dom, format, identity, avatar,
                       wait timer, pwa
  js/components/       globe renderer, geo (topojson + projection), place
                       picker, shared UI
  js/screens/          wait, live, stats, streaks, board, you
scripts/
  generate-icons.mjs   writes public/icons/*.png (no image dependencies)
  build-cities.mjs     writes data/cities.json from GeoNames
  import-json-data.mjs one-off: the old JSON files into Postgres
data/
  cities.json          31,716 cities worldwide (committed)
  regions.json         the 29 old region points, kept only to read old records
  suggestions.json     190 suggestions (committed)
```

The layering rule: `routes` never contain logic, `domain` never touches HTTP,
and `db` never knows what a session is. On the client, `screens` own their own
data fetching and lifecycle; `components` are given data and render it.

## The six screens

| Screen | What it is |
| --- | --- |
| **Wait** | The clock, the current task, XP, and today's two numbers |
| **Live** | The globe, a filter, and a ticker of who else is waiting |
| **Stats** | When you wait, how much of it you used, the shape of the waits, and each one |
| **Streaks** | The streak, the week strip, and six badges |
| **Board** | Weekly XP leaderboard |
| **You** | Avatar, display name, status, home city, pin colour, visibility, linked devices |

Screens live side by side in one wide track and are swiped between. A gesture
locks to an axis after six pixels, so a vertical flick still scrolls the screen
it started on. `#/live`, `#/stats` and so on open straight onto a screen, which
is what the manifest's shortcuts use.

## API

All endpoints except `/api/health`, `/api/regions`, `/api/presence` and
`/api/suggestions*` require an `X-Device-Id` header holding a UUID.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/me` | Fetch (creating on first call) the anonymous account |
| `GET` | `/api/wait` | The wait in progress, shared by every linked device |
| `POST` | `/api/wait/start` · `/pause` · `/resume` · `/end` | Drive it |
| `POST` | `/api/pair` | Mint a pairing code for this account |
| `POST` | `/api/pair/cancel` | Withdraw any live code |
| `POST` | `/api/pair/claim` | Join the account a code belongs to |
| `POST` | `/api/me` | Set city, display name, status, pin colour or visibility |
| `POST` | `/api/me/locate` | Resolve `{lat,lng}` to the nearest region |
| `GET` | `/api/places?q=&limit=&kinds=` | Ranked search over cities and countries |
| `GET` | `/api/cities/near?lat=&lng=&radiusKm=&limit=` | Cities inside the globe's view |
| `GET` | `/api/sessions?limit=` | This device's waits, newest first |
| `POST` | `/api/sessions` | Log a completed wait |
| `DELETE` | `/api/sessions/:id` | Delete one wait |
| `GET` | `/api/analytics?days=&tzOffset=` | Aggregates, daily breakdown, hourly trend |
| `GET` | `/api/progress?days=&tzOffset=` | XP, streak, week strip, badges, time-use mix |
| `POST` | `/api/progress/complete` | Bank a cleared task |
| `GET` | `/api/leaderboard?days=&tzOffset=&limit=` | Weekly XP board |
| `GET` | `/api/presence?focusCityId=&focusCountry=` | Live snapshot: counts, places and people |
| `POST` | `/api/presence/heartbeat` | Mark this device as waiting |
| `POST` | `/api/presence/stop` | Clear it |
| `GET` | `/api/suggestions?seconds=&category=&count=&seed=&exclude=` | Suggestions for the current wait |
| `GET` | `/api/suggestions/meta` | Buckets and categories |

## Notes on the implementation

**Timezones.** The client sends `Date#getTimezoneOffset()` with anything the
server buckets by day or hour, so "today" and "2 PM" mean what the user's clock
says rather than UTC. The shifting helpers live in `server/domain/time.js` and
are shared by analytics, progress and the leaderboard.

**Suggestions.** 190 entries across 8 categories and 4 duration buckets, each
with a title, a second line, a tag and an XP value. The bucket is chosen from
elapsed seconds, so a 20-second wait suggests unclenching your jaw and a
20-minute wait suggests going to the gym. If a wait outgrows its bucket while
it is running, the queue is refetched.

**XP is earned by clearing tasks, never by waiting.** A completion is priced
from the catalogue on the server, so the client cannot decide what a task is
worth.

Each wait gets an id when the clock starts, and both the tasks cleared during it
and the session logged at the end carry that id. That join is what drives "put
to work", "reclaimed", the time-use mix and the `Ten-Minute Mile` badge. It
replaced matching on timestamps, which quietly lost work: a session's `endedAt`
is `startedAt + elapsed`, so pausing pulls it in ahead of the real end and
anything cleared afterwards fell outside the window — as did anything cleared
within a few milliseconds of the boundary.

**Cities.** Every place GeoNames lists with 15,000 people or more, plus every
national capital whatever its size - 31,716 of them across 244 countries. Nuuk
has 14,798 people and would otherwise have been missing. The catalogue is 1.5 MB and stays on the server:
`/api/cities` answers a search as you type, so the browser never downloads it.
Search ranks exact names above prefixes above later words, breaking ties on
population, which is why `london` finds London before Londrina and
`springfield` leads with Missouri. It scans the whole catalogue unless it
already has enough *exact* matches: stopping as soon as the list looked full
meant `Alta` met Altamira first and never reached Alta at all.

Resolving a coordinate to a city is not simply "the nearest one". Large cities
are catalogued alongside their own districts, so the nearest entry to central
Tokyo is Yoyogi and to Lagos is Shomolu. A substantially larger city within
30km wins instead, which is the answer people expect - while a genuine town
like Hemel Hempstead, 40km from London, keeps its own name.

**Countries come from the cities**, not a second dataset. Everything needed to
find and frame one is already implied by where its people are, so
`server/domain/countries.js` derives 244 of them at boot: a population-weighted
centre, and the radius holding 98% of the population. Fitting *all* of it would
frame the United States around Honolulu and Anchorage, putting the Pacific on
screen for half a percent of its people. Centres are averaged as vectors rather
than as numbers, which is what keeps Fiji in the Pacific rather than off Africa.

Searching the globe's jump-to box covers both: countries take the first few
slots and cities fill the rest, so `isr` offers Israel while `paris` - matching
no country - is unchanged. Every row says which kind it is, and so does the
focused place, from one `placeKind` badge shared by both - Singapore, Mexico
and Luxembourg are each a city *and* a country, and the badge is what tells the
two rows apart. Picking a place *focuses* it: the globe frames it,
the ticker lists only who is there, and the headline counts them. The profile
screen asks the same endpoint for cities only, because a country is not a home
town.

Presence seeds generated activity around whatever is focused, not just the
sixty featured cities and the viewer's own - otherwise searching for Italy,
which has no city in the featured set, would land on an empty map.

`data/regions.json` and `server/domain/legacy-regions.js` survive only to read
records written before any of this existed, translating the old 29 region ids
to city ids so upgrading never moves someone's home town.

**The globe** is a real orthographic projection of Natural Earth country
topology, decoded from TopoJSON and drawn on a canvas. There is no mapping
library: `public/js/components/geo.js` decodes the arcs into unit-sphere xyz
once and rotates them per frame.

It drills down to city level. The view is a cap of angular radius
`asin(1 / zoom)`, so zoom runs from 0.85 to 1,000 - enough to frame a town of
15,000 people at about a 7km radius.

**Nothing that frames a city uses a fixed zoom.** One cannot work across a
catalogue running from towns of 15,000 to Shanghai's 25 million: at a zoom that
suits Shanghai, "my city" for Tel Aviv shows the whole of Israel. Built-up area
grows roughly with the cube root of population, so `viewRadiusKmFor` follows
that - about 14km for Hemel Hempstead, 23km for Tel Aviv, 62km for London,
88km for Shanghai - and `flyToCity` converts it to the zoom this canvas needs.
"My city", the jump-to picker and tapping a pin all go through it.

Detail arrives in three tiers, each fetched only when someone zooms that far -
110m (96 KB) for the globe, 50m (715 KB) past 1.8x, 10m (3.4 MB) past 9x.
Cities fade in as dots around 1.5x and gain labels at 2.1x, with collision
avoidance so names never pile up.

Transforming half a million points every frame would not hold 60fps, so each
ring carries a bounding cap and is rejected wholesale when it falls outside the
visible cap. At 20x that takes the 10m atlas from 545,000 points to 4,400.

Zoom is a wheel, a pinch, a double-click or the buttons on the globe; the view
eases toward a target rather than snapping, and pins stop growing at 3.4x -
unclamped, a pin at 64x is wider than the canvas.

Dragging moves the camera *against* the pointer, because a point at longitude L
is drawn at `sin(L - camera.lon)`: these are the camera's coordinates, not the
surface's, and the land has to travel with the finger.

Fills and strokes are clipped differently, because they need different things.
A stroke is broken at the horizon and each visible run drawn separately. A fill
cannot be, or the shape would not close — so points behind the horizon are
pushed out onto the limb instead. Their azimuth is already correct, so the path
follows the rim exactly where the hidden part of the country sits, and the fill
closes the way a true spherical clip would with no winding bookkeeping.
`test/geo.test.js` pins all 29 catalogue cities to land, five ocean probes to
water, and asserts no traced polygon ever escapes the drawing circle.

**People are placed by city, not by coordinate.** The app knows what town you
are in and deliberately not where in it, so everyone in a city carries that
city's coordinates. The globe fans co-located pins around the city's position
in *screen* space rather than inventing a street address for each of them -
without that, a crowd projects to one pixel and six people look like one.

Presence also seeds generated activity in the viewer's own city, not just the
sixty featured ones. Otherwise filtering to "my city" lands on an empty map for
anyone who does not live in a megacity.

**Simulated activity is labelled as such.** A single-user install would show an
empty world and a leaderboard of one, so presence adds ambient counts across 60
large cities with one representative pin each, and the board is padded with
sample players. Those 60 are capped at two per country: straight population
order is honest but puts almost every pin in China and India.
Every generated person carries `simulated: true`, presence reports
`realWaiting` and `simulatedWaiting` separately, and the board screen says how
many real players there are this week.

Padding is scaled to whoever is actually playing and capped below the top real
score, so a real player always leads their own board — a fixed band would put
invented four-figure scores permanently above a genuine week of play. It
disappears altogether once there are enough real players to fill the table.

**The device id is still the only credential**, and it never leaves the server. It is the only credential this app
has, and `/api/presence` is public, so a snapshot identifies waiting devices by
an opaque per-process hash instead. An earlier version published
`live:<deviceId>`, which meant reading the public snapshot was enough to take
over any account visible on the globe. Rows carry `isYou` decided server-side
from the caller's own header, so the client never needs an id it could
recognise. `test/presence.test.js` fails if a UUID appears in a snapshot at all.

**Turning yourself off is immediate.** A presence entry carries the visibility
it was created with, so hiding used to leave you on the globe until your next
heartbeat - up to half a minute of being seen after asking not to be. Saving a
hidden profile now drops the entry there and then.

**The line under your name** is your status if you set one, and otherwise the
opening sentence of whatever task is on screen - "roll your shoulders back five
times". It used to send the category tag, so the globe read "body", which told
nobody anything; the 40-character cap that forced that choice is now 70, since
a task's first sentence runs to 63. Saving a profile pushes it to the globe
immediately rather than waiting up to thirty seconds for the next heartbeat.

**You appear while a wait is running**, and not otherwise, because that is what
the screen claims to show. The Live screen says so rather than leaving you to
wonder, marks your own row, and shows your own photo on it - only to you, since
the photo never leaves the device.

**Avatars are chosen, not uploaded.** Sixteen characters, picked on the You
screen and shown on the globe, the ticker and the board. Photographs were tried
and taken out again: they meant a real face stored on the server, served
unauthenticated to strangers, with no moderation or takedown path - and a
cropped photo is unrecognisable at the sixteen pixels a pin actually gets.
Nothing is uploaded now, so there is nothing to moderate and nothing to leak.

**Privacy.** The rest of it: the profile photo used to be `localStorage`-only — other people only ever see initials, which is also what the
globe draws. Turning off "show me on the globe" removes the device from the
presence snapshot and the public board entirely; you still see your own row.
Browser geolocation is snapped to the nearest catalogued region and the raw
coordinates are never stored.

**The wait belongs to the account, not the browser.** It used to live in each
device's `localStorage`, so a wait running on a phone showed as paused on the
laptop signed in to the same account. `active_waits` holds one row per account
and every device reads it.

The phase is derived from one fact - whether the clock is currently running -
so no two devices can disagree about it, and the arithmetic happens in the
database from its own clock, so a device with a wrong system time cannot bank
the wrong amount. Ending clears the row and writes the session in one
transaction, so two devices pressing "end" cannot both log the same wait.
Between syncs the client counts locally from the last reported figure rather
than from server timestamps, which keeps a skewed clock from showing a wrong
number.

**The Stats screen draws what was already being computed.** The hour-of-day
buckets, the peak hour and the change against the previous period were all
calculated on every request and rendered nowhere - there was even a `hourLabel`
helper written for an axis that never existed. It now opens with a sentence
rather than four cold numbers, and shows the twenty-four hours as a dial, the
window as bars or a calendar depending on its width, the shape of the waits
themselves, personal records, and the individual waits - which were invisible
until now, along with the delete endpoint that had no way to be reached.

`peakHour` used to mean the hour with the longest *average* wait while the ring
sizes its wedges by how many waits an hour holds; they now agree.

**One clock, wherever it is shown.** The time beside your pin on the globe is
the same number the Wait screen shows, because both come from the account's
wait. It used to be counted from when the presence entry appeared - and since
pausing removes that entry and resuming makes a new one, the globe showed the
time since the last resume rather than the whole wait. The elapsed figure now
travels with the heartbeat and is advanced locally between beats, only while
the clock is actually running.

**A brand-new device is asked before it becomes a stranger.** Opening the app
somewhere new used to create a second person silently, and the first anyone
noticed was a missing streak. The account answers whether it is new - no
history, no second device, a name it never changed - because a refresh clears
nothing on the server and asking local storage meant the dialog returned on
every reload. Local storage only records that the question was asked.

The dialog builds its field once and patches only what changes. Re-rendering on
every keystroke pulls the input out of the document and puts it back, which
drops focus - and on a phone that closes the keyboard after every character.

**One account, many devices.** Identity used to be the device, so opening the
app on a laptop after using it on a phone produced two unrelated people with
separate XP, streaks and history. The profile and everything earned belong to an
`accounts` row; a device is one way of reaching it.

Linking is a pairing code: one device shows eight characters, the other types
them in. No email, no password, nothing about anyone stored - which is the
point, because the alternative is a sign-up form.

A code is a bearer token for an account, so it is treated as one. Five minute
life, single use, one live code per account at a time, and every other code that
account had out is retired the moment one is claimed. The claim is an `UPDATE`
guarded on both `claimed_at IS NULL` and the expiry, so two devices racing on
the same code cannot both win - there is a test for exactly that. The alphabet
leaves out `O`, `I`, `0` and `1`, and the reader maps them back, because these
get read aloud across a room.

The joining device brings its own history with it rather than being stranded on
an account nothing can reach again; the emptied account is then deleted. The
migration gives every existing device its own account, so nothing is lost and
nobody is merged with a stranger.

**Storage is Postgres.** Three tables — `devices`, `sessions`, `completions` —
with foreign keys, check constraints and the indexes the reads actually use.
Deleting a device takes its history with it, a wait cannot be negative, and XP
cannot be. `server/db/schema.sql` is the whole thing.

`server/db/*.repo.js` are the only modules that know SQL or column names. They
speak the domain's shape — camelCase, ISO strings — so nothing above them
changed when the storage did. `server/db/pool.js` is the only module that knows
what a connection is.

Two type parsers earn their keep there: `timestamptz` is kept as the ISO string
Postgres sends rather than becoming a `Date` the app would have to re-serialise,
and `bigint` is parsed to a number, because `SUM(xp)` otherwise arrives as a
string and silently breaks every comparison it touches.

The leaderboard is the one query that spans every device rather than one, so it
is aggregated in the database — `SUM(xp) ... GROUP BY device_id` — instead of
reading the whole completions table into memory. Trimming a device's history to
its limit happens in the same transaction as the insert that triggered it.

**Migrations run on boot**, before the server listens: serving requests against
an unmigrated database turns one clear failure into a hundred confusing ones.
Each step runs once and is recorded, under an advisory lock so that several
instances starting at the same moment on a rolling deploy cannot race.

## Connecting Claude Code

A wait is the gap between sending a prompt and the answer landing. Claude Code
knows exactly when both happen, so it can run the clock for you and there is
nothing to remember and nothing left running overnight.

Two hooks: `UserPromptSubmit` opens a wait, `Stop` closes it.

**1. Mint a token.** You screen, *Connected editors*, "Connect Claude Code".
It is shown once - the server keeps only a sha256 of it.

**2. Give it to the hook script**, which stores it in `~/.thewait/token` at
`0600`. Never paste it into `settings.json`: that file gets committed, copied
between machines and read out over screenshares.

```
node scripts/thewait-hook.mjs login twk_...
node scripts/thewait-hook.mjs status
```

**3. Add the hooks** to `.claude/settings.json` (already done in this repo):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command",
        "command": "node /absolute/path/to/scripts/thewait-hook.mjs start" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command",
        "command": "node /absolute/path/to/scripts/thewait-hook.mjs end" }] }
    ]
  }
}
```

Both are `async`, so nothing waits on the app before your prompt is sent, and
`${CLAUDE_PROJECT_DIR:-...}` keeps the command working whether or not Claude
Code substitutes that variable - the fallback is this checkout.

`THEWAIT_URL` overrides the address if the app is not on `127.0.0.1:3000`. It
must be a local one - the token is refused from anywhere else.

The server has to be running for anything to be recorded. When it is not, the
hook exits silently and that turn is simply not logged.

### What the token can do, and what it cannot

It is a deliberately weaker credential than the device id, which is a permanent
bearer token for the whole account.

- **Two endpoints only.** `POST /api/wait/start` and `POST /api/wait/end`. The
  allowlist lives in `server/http/router.js` and is matched exactly, so a route
  added later is locked out until somebody lists it on purpose. It cannot read
  your history, change your profile, or mint another credential.
- **This machine only.** Refused from any non-loopback address, checked before
  the token is even looked up. The server often binds to `0.0.0.0` so a phone
  can reach the app; that must not widen what a token can do.
- **Hashed at rest.** A copy of `agent_tokens` is not a copy of anybody's
  tokens.
- **Revocable**, from the same card that minted it, with the last-used time
  beside it so an unexpected one is visible.
- **Not usable from a browser.** `Authorization` is deliberately absent from
  the CORS allowlist, so a page on another origin cannot send one even if it
  somehow obtained it.

The hook never fails a turn: no token, no server, a slow reply - it exits 0 and
says nothing.

### Two things to know

**One wait per account.** Two Claude Code sessions at once means the second
`start` replaces the first, and the second `Stop` ends it. Concurrent waits
would need the token to carry a session id.

**`Stop` also fires on clear, resume and compact**, so an `end` can arrive with
no `start` behind it. Harmless - ending nothing logs nothing - but it is why
the wait screen's rescue prompt still earns its place for unhooked sessions.

## Installable (PWA)

The app ships a manifest, icons and a service worker, so it can be added to a
home screen on Android and iOS and launched standalone.

Caching is split by what the request is for. The app shell is cache-first, so a
cold launch paints instantly and works with no connection. `/api/*` is
network-first: live data is never served stale, but the last successful GET is
kept so an offline launch still shows your own history instead of an error.
Anything that mutates state is never cached.

`sw.js` is served with `no-store` and `Service-Worker-Allowed: /` — without the
former a worker update can never roll out. Bump `CACHE_VERSION` in `sw.js` when
the shell changes; `activate` drops every older cache.

The precache list is written by hand, because there is no build step to generate
it. `test/shell-assets.test.js` fails if a module or stylesheet is added,
renamed or removed without the list being updated, which is the failure mode
that would otherwise be invisible.

Icons are generated by `scripts/generate-icons.mjs`, which encodes the PNGs
directly with `zlib` rather than pulling in an image library. Edit the palette
there and re-run `npm run icons`.

## Known limits

- Presence is in-memory, so it resets when the server restarts. That is
  intentional: stale waiters shouldn't come back from the dead.
- Losing every linked device loses the account: there is no recovery, which is
  the price of having no sign-up. Adding email or a passkey later is another
  credential on the same `accounts` row, not another migration.
- Presence is per-instance. Two app instances each keep their own list of who
  is waiting, so the globe would show different people depending on which one
  answered. Moving it to Redis, or to a table with a TTL, is the next step if
  you run more than one.
- City names are GeoNames' primary Latin names, so searching in a local script
  finds nothing, and a place listed under another name is missed (Ulaanbaatar
  is catalogued as Ulan Bator). Places under 15,000 people are absent unless
  they are a capital.
- The view a city gets is estimated from its population, which assumes similar
  density everywhere. A sprawling city is framed a little tight and a very
  dense one a little wide; the bounds keep both usable.
- Archivo and Baloo 2 are loaded from Google Fonts, so a cold offline launch
  falls back to the system stack. Everything else is served locally.
- Installing as a PWA needs HTTPS (or localhost). Over plain HTTP on a LAN
  address the service worker will not register.

## Data credits

City names, coordinates and populations come from
[GeoNames](https://www.geonames.org) under CC BY 4.0. Country outlines come from
[world-atlas](https://github.com/topojson/world-atlas), derived from Natural
Earth, which is public domain.

Both are **vendored**, not called live. `npm run cities` downloads from GeoNames
and writes `data/cities.json`; the atlases were fetched once into `public/data`.
The server never makes an outbound request - it reads those files at boot and
answers every city query from memory, so the app works with no internet and
cannot break because someone else's API changed.

The one exception is the browser: `index.html` loads Archivo and Baloo 2 from
Google Fonts. Everything else the page needs is served locally, and the type
falls back to the system stack if that request fails.
