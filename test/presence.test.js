import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { heartbeat, resetPresence, snapshot, stopWaiting } from '../server/domain/presence.js';

const DEVICE_A = '11111111-1111-4111-8111-111111111111';
const DEVICE_B = '22222222-2222-4222-8222-222222222222';

const LONDON = 2643743;
const TOKYO = 1850147;

beforeEach(resetPresence);

test('a heartbeat registers exactly one real waiter', () => {
  const result = heartbeat(DEVICE_A, { cityId: LONDON });

  assert.equal(result.realWaiting, 1);
  assert.equal(result.places.find((p) => p.id === LONDON).realWaiting, 1);
});

test('repeat heartbeats from one device do not double count', () => {
  heartbeat(DEVICE_A, { cityId: LONDON });
  const result = heartbeat(DEVICE_A, { cityId: LONDON });

  assert.equal(result.realWaiting, 1);
});

test('separate devices accumulate', () => {
  heartbeat(DEVICE_A, { cityId: LONDON });
  const result = heartbeat(DEVICE_B, { cityId: TOKYO });

  assert.equal(result.realWaiting, 2);
});

test('stopping removes the waiter', () => {
  heartbeat(DEVICE_A, { cityId: LONDON });
  assert.equal(stopWaiting(DEVICE_A).realWaiting, 0);
});

test('simulated activity is reported separately from real waiters', () => {
  const result = snapshot();

  assert.equal(result.realWaiting, 0);
  assert.ok(result.simulatedWaiting > 0, 'ambient activity should be present');
  assert.equal(result.totalWaiting, result.realWaiting + result.simulatedWaiting);
});

test('an unknown city falls back rather than throwing', () => {
  const result = heartbeat(DEVICE_A, { cityId: 999999999 });
  assert.equal(result.realWaiting, 1);
});

test('a malformed device id is rejected', () => {
  assert.throws(() => heartbeat('nope', { cityId: LONDON }), /device id/);
});

test('only devices that opted in are published as people', () => {
  heartbeat(DEVICE_A, { cityId: LONDON, displayName: 'seen', visible: true });
  heartbeat(DEVICE_B, { cityId: TOKYO, displayName: 'hidden', visible: false });

  const result = snapshot();
  const live = result.people.filter((person) => !person.simulated);

  // Both are counted as real waiters; only one of them is named.
  assert.equal(result.realWaiting, 2);
  assert.deepEqual(live.map((person) => person.displayName), ['seen']);
});

test('every generated person is flagged as simulated', () => {
  const generated = snapshot().people.filter((person) => person.simulated);

  assert.ok(generated.length > 0, 'ambient pins should be present');
  assert.ok(generated.every((person) => person.id.startsWith('sim:')));
});

test("the viewer's own city is populated, not empty", () => {
  const TEL_AVIV = 293397;

  // Tel Aviv is nowhere near the top sixty cities, so without seeding it the
  // "my city" filter would show an empty map.
  const global = snapshot();
  const local = snapshot({ viewerCityId: TEL_AVIV });

  assert.equal(global.people.filter((p) => p.cityId === TEL_AVIV).length, 0);

  const crowd = local.people.filter((p) => p.cityId === TEL_AVIV);
  assert.ok(crowd.length >= 3, `expected a crowd at home, got ${crowd.length}`);
  assert.ok(crowd.every((person) => person.simulated), 'all generated, and all flagged');
  assert.equal(new Set(crowd.map((p) => p.id)).size, crowd.length, 'each has its own id');
});

test('people in one city share its coordinates', () => {
  // The app knows what town you are in and deliberately not where in it. The
  // globe fans them apart on screen; the data does not pretend to know more.
  const crowd = snapshot({ viewerCityId: 293397 }).people.filter((p) => p.cityId === 293397);

  assert.ok(crowd.length > 1);
  assert.equal(new Set(crowd.map((p) => `${p.lat},${p.lng}`)).size, 1);
});

test('a focused country is seeded with activity in its own cities', () => {
  // Italy has no city in the featured sixty, so without seeding, searching for
  // it would land on an empty map.
  assert.equal(snapshot().people.filter((p) => p.country === 'Italy').length, 0);

  const focused = snapshot({ focusCountry: 'Italy' }).people.filter((p) => p.country === 'Italy');

  assert.ok(focused.length >= 5, `expected a spread across Italy, got ${focused.length}`);
  assert.ok(new Set(focused.map((p) => p.place)).size >= 5, 'across several cities');
  assert.ok(focused.every((person) => person.simulated), 'all generated, and all flagged');
});

test('a focused city gets a crowd rather than a single pin', () => {
  const HAIFA = 294801;
  const focused = snapshot({ focusCityId: HAIFA }).people.filter((p) => p.cityId === HAIFA);

  assert.ok(focused.length >= 3, `expected a crowd, got ${focused.length}`);
});

/**
 * The device id is this app's only credential, and `/api/presence` is public.
 * A snapshot once published `live:<deviceId>` for every waiting device, which
 * handed any viewer the means to act as anyone they could see.
 */
test('a snapshot never publishes a device id', () => {
  heartbeat(DEVICE_A, { cityId: LONDON, displayName: 'Naama', visible: true });

  const raw = JSON.stringify(snapshot());

  assert.ok(!raw.includes(DEVICE_A), 'the raw id must not appear anywhere in the payload');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/.test(raw), 'nor any UUID');
});

test('row ids are opaque but stable', () => {
  heartbeat(DEVICE_A, { cityId: LONDON, visible: true });

  const first = snapshot().people.find((person) => !person.simulated);
  const second = snapshot().people.find((person) => !person.simulated);

  assert.equal(first.id, second.id, 'the same device keeps the same handle');
  assert.match(first.id, /^live:[0-9a-f]{12}$/);
});

test('only the caller is told which row is theirs', () => {
  heartbeat(DEVICE_A, { cityId: LONDON, displayName: 'A', visible: true });
  heartbeat(DEVICE_B, { cityId: TOKYO, displayName: 'B', visible: true });

  const mine = snapshot({ viewerDeviceId: DEVICE_A }).people.filter((person) => person.isYou);
  assert.deepEqual(mine.map((person) => person.displayName), ['A']);

  // A viewer with no identity is nobody.
  assert.equal(snapshot().people.some((person) => person.isYou), false);
});

test('generated people are never marked as you', () => {
  assert.ok(snapshot({ viewerDeviceId: DEVICE_A }).people.some((person) => person.simulated));
  assert.equal(snapshot({ viewerDeviceId: DEVICE_A }).people.some((p) => p.simulated && p.isYou), false);
});

test('an activity line is long enough to hold a real one', () => {
  /*
   * The globe used to show the category tag - the word "body" - because the
   * cap was 40 characters and a task's opening sentence runs to 63.
   */
  const activity = 'approve the pull request that has been sitting there';
  const result = heartbeat(DEVICE_A, { cityId: LONDON, visible: true, doing: activity });

  assert.equal(result.people.find((person) => !person.simulated).doing, activity);
});

test('an activity line is still bounded', () => {
  const result = heartbeat(DEVICE_A, { cityId: LONDON, visible: true, doing: 'x'.repeat(400) });
  const { doing } = result.people.find((person) => !person.simulated);

  assert.ok(doing.length <= 70, `an activity should be trimmed, got ${doing.length}`);
});

test('the live clock is the wait clock, not the time since this heartbeat', () => {
  /*
   * Pausing removes the presence entry and resuming makes a new one, so
   * counting from when the entry appeared showed the time since the last
   * resume rather than the whole wait. The elapsed figure comes from the
   * account's own clock instead.
   */
  const result = heartbeat(DEVICE_A, {
    cityId: LONDON,
    visible: true,
    elapsedSeconds: 300,
    running: true
  });

  const me = result.people.find((person) => !person.simulated);
  assert.ok(me.waitingSeconds >= 300, `expected the whole wait, got ${me.waitingSeconds}`);
});

test('a held clock does not creep between heartbeats', () => {
  heartbeat(DEVICE_A, { cityId: LONDON, visible: true, elapsedSeconds: 120, running: false });

  const first = snapshot().people.find((person) => !person.simulated).waitingSeconds;
  assert.equal(first, 120, 'paused means paused');
});

test('a missing elapsed figure does not produce nonsense', () => {
  heartbeat(DEVICE_A, { cityId: LONDON, visible: true });

  const me = snapshot().people.find((person) => !person.simulated);
  assert.equal(Number.isFinite(me.waitingSeconds), true);
  assert.ok(me.waitingSeconds >= 0, `got ${me.waitingSeconds}`);
});
