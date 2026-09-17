/**
 * One-off import of the JSON files the app used before it had a database.
 *
 * Run with `npm run db:import`. Safe to run twice: every row is inserted with
 * `ON CONFLICT DO NOTHING`, so a second run adds nothing and changes nothing.
 *
 * Devices go first, because sessions and completions reference them. Anything
 * pointing at a device that no longer exists is reported and skipped rather
 * than failing the whole import.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from '../server/config.js';
import { migrate } from '../server/db/migrate.js';
import { closePool, transaction } from '../server/db/pool.js';
import { DEFAULT_CITY_ID, resolveCity } from '../server/domain/cities.js';
import { cityIdForRegion } from '../server/domain/legacy-regions.js';
import { TINTS } from '../server/domain/people.js';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

function read(name) {
  const file = path.join(dataDir, name);
  if (!fs.existsSync(file)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`  could not read ${name}: ${error.message}`);
    return [];
  }
}

/** Old records held a region id; newer ones a city id; some neither. */
function cityIdOf(record) {
  return resolveCity(record.cityId ?? cityIdForRegion(record.regionId) ?? DEFAULT_CITY_ID).id;
}

function defaultTint(deviceId) {
  const sum = [...deviceId].reduce((total, char) => total + char.charCodeAt(0), 0);
  return TINTS[sum % TINTS.length];
}

async function run() {
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  await migrate({ log: false });

  const devices = read('devices.json');
  const sessions = read('sessions.json');
  const completions = read('completions.json');

  console.log(`Found ${devices.length} devices, ${sessions.length} sessions, ${completions.length} completions.\n`);

  const counts = await transaction(async (query) => {
    let devicesIn = 0;
    const known = new Set();

    for (const device of devices) {
      if (!device.deviceId) continue;

      const rows = await query(
        `INSERT INTO devices (device_id, city_id, location_mode, display_name, status, tint, visible, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), COALESCE($9::timestamptz, now()))
         ON CONFLICT (device_id) DO NOTHING
         RETURNING device_id`,
        [
          device.deviceId,
          cityIdOf(device),
          device.locationMode === 'device' ? 'device' : 'manual',
          device.displayName ?? `anon_${device.deviceId.slice(0, 6)}`,
          device.status ?? null,
          device.tint ?? defaultTint(device.deviceId),
          device.visible !== false,
          device.createdAt ?? null,
          device.lastSeenAt ?? null
        ]
      );

      known.add(device.deviceId);
      devicesIn += rows.length;
    }

    let sessionsIn = 0;
    let sessionsSkipped = 0;

    for (const session of sessions) {
      if (!known.has(session.deviceId)) {
        sessionsSkipped += 1;
        continue;
      }

      const rows = await query(
        `INSERT INTO sessions (id, device_id, wait_id, label, duration_seconds, started_at, ended_at, city_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()))
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          session.id ?? randomUUID(),
          session.deviceId,
          session.waitId ?? null,
          session.label ?? 'Prompt run',
          Math.max(0, Math.round(session.durationSeconds ?? 0)),
          session.startedAt,
          session.endedAt ?? session.startedAt,
          session.cityId ?? cityIdOf(session),
          session.createdAt ?? null
        ]
      );

      sessionsIn += rows.length;
    }

    let completionsIn = 0;
    let completionsSkipped = 0;

    for (const completion of completions) {
      if (!known.has(completion.deviceId)) {
        completionsSkipped += 1;
        continue;
      }

      const rows = await query(
        `INSERT INTO completions (id, device_id, suggestion_id, category, bucket, wait_id, xp, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          completion.id ?? randomUUID(),
          completion.deviceId,
          completion.suggestionId ?? 'unknown',
          completion.category ?? 'unknown',
          completion.bucket ?? 'micro',
          completion.waitId ?? null,
          Math.max(0, Math.round(completion.xp ?? 0)),
          completion.at ?? null
        ]
      );

      completionsIn += rows.length;
    }

    return { devicesIn, sessionsIn, sessionsSkipped, completionsIn, completionsSkipped };
  });

  console.log(`Imported ${counts.devicesIn} devices, ${counts.sessionsIn} sessions, ${counts.completionsIn} completions.`);

  if (counts.sessionsSkipped || counts.completionsSkipped) {
    console.log(
      `Skipped ${counts.sessionsSkipped} sessions and ${counts.completionsSkipped} completions ` +
        'whose device is not in devices.json.'
    );
  }

  console.log('\nThe JSON files are left untouched. Delete them once you are happy.');
  await closePool();
}

run().catch(async (error) => {
  console.error(`Import failed: ${error.message}`);
  await closePool().catch(() => {});
  process.exit(1);
});
