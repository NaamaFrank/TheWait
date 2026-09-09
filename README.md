# The Wait

Things to Do While Claude Is Running — a mobile-first app that turns LLM latency
into something useful. Start a timer when you fire off a prompt, get a suggestion
sized to how long you've been waiting, and watch a live globe of other developers
doing the same.

No sign-up. An anonymous UUID is generated on first launch and everything hangs
off that.

## Running it

```bash
npm start          # http://127.0.0.1:8080
npm run dev        # same, with --watch
npm test           # 27 unit tests
```

No dependencies and no build step — Node's standard library on the server, ES
modules straight to the browser.

## Layout

```
server/
  config.js            environment + tunables, one place
  app.js               route registration
  http/                router, body parsing, responses, static files, errors
  db/                  JsonStore: atomic, serialised JSON collections
  domain/              sessions, analytics, presence, suggestions, devices, regions
  routes/              thin HTTP adapters over the domain
public/
  index.html           app shell
  styles/              tokens -> base -> components -> screens
  js/core/             api client, store, router, dom builder, formatting, identity
  js/components/       globe renderer, charts, icons, shared UI, land geometry
  js/screens/          timer, analytics, globe
data/
  regions.json         29 city/region reference points (committed)
  suggestions.json     190 suggestions (committed)
  sessions.json        runtime, gitignored
  devices.json         runtime, gitignored
```

The layering rule: `routes` never contain logic, `domain` never touches HTTP, and
`db` never knows what a session is. On the client, `screens` own their own data
fetching and lifecycle; `components` are given data and render it.

## API

All endpoints except `/api/health`, `/api/regions`, `/api/presence` and
`/api/suggestions*` require an `X-Device-Id` header holding a UUID.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/me` | Fetch (creating on first call) the anonymous device |
| `POST` | `/api/me` | Set region or display name |
| `POST` | `/api/me/locate` | Resolve `{lat,lng}` to the nearest region |
| `GET` | `/api/regions` | Region catalogue |
| `GET` | `/api/sessions?limit=` | This device's waits, newest first |
| `POST` | `/api/sessions` | Log a completed wait |
| `DELETE` | `/api/sessions/:id` | Delete one wait |
| `GET` | `/api/analytics?days=&tzOffset=` | Aggregates, daily breakdown, hourly trend |
| `GET` | `/api/presence` | Live snapshot for the globe |
| `POST` | `/api/presence/heartbeat` | Mark this device as waiting |
| `POST` | `/api/presence/stop` | Clear it |
| `GET` | `/api/suggestions?seconds=&category=&count=&seed=&exclude=` | Suggestions for the current wait |
| `GET` | `/api/suggestions/meta` | Buckets and categories |

## Notes on the implementation

**Timezones.** The client sends `Date#getTimezoneOffset()` with analytics
requests, so "today" and "2 PM" mean what the user's clock says rather than UTC.

**Suggestions.** 190 entries across 8 categories and 4 duration buckets. The
bucket is chosen from elapsed seconds, so a 20-second wait suggests unclenching
your jaw and a 20-minute wait suggests going to the gym. Passing a `seed` makes
the pick deterministic, which keeps the list from reshuffling while you read it.

**The globe** is a real orthographic projection on a canvas, not a CSS mockup.
Points are rotated on a unit sphere and drawn only when facing the camera, so
markers travel behind the horizon. Continents come from coarse `[lng, lat]` rings
in `public/js/components/land.js`; `test/land.test.js` pins every one of the 29
catalogue cities to land and every ocean probe to water.

**Simulated activity is labelled as such.** A single-user install would show an
empty world, so the presence layer adds slow, deterministic ambient counts per
region. The API reports `realWaiting` and `simulatedWaiting` separately and
`totalWaiting` as their sum — nothing pretends generated numbers are observed
ones. Ambient ripples on the globe are drawn dimmer than real ones.

**Storage** is a JSON file per collection, written through a promise queue with
write-to-temp-then-rename. That is safe for a single process and is deliberately
behind `JsonStore`'s interface — swapping in a real database means rewriting one
file.

## Known limits

- Presence is in-memory, so it resets when the server restarts. That is
  intentional: stale waiters shouldn't come back from the dead.
- `JsonStore` assumes a single server process. Two processes would race.
- Region granularity is a fixed catalogue of 29 cities; browser geolocation is
  snapped to the nearest one and the raw coordinates are never stored.
