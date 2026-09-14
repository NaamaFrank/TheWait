/**
 * Test environment, applied before anything reads the configuration.
 *
 * `server/config.js` snapshots `process.env` when it is first imported, so this
 * has to run before it. Import it as the *first* import of any suite that
 * touches the database - module bodies are evaluated depth-first in source
 * order, which is what makes that work.
 */

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

/**
 * Tests empty every table, so refuse to point at something that does not look
 * disposable. `THEWAIT_ALLOW_DESTRUCTIVE_TESTS=1` overrides it for a CI
 * database named something else.
 */
export function assertDisposable(url) {
  if (!url || process.env.THEWAIT_ALLOW_DESTRUCTIVE_TESTS === '1') return;

  const name = url.split('/').pop()?.split('?')[0] ?? '';

  if (!/test|scratch|ci|tmp/i.test(name)) {
    throw new Error(
      `Refusing to truncate "${name}": it does not look like a test database. ` +
        'Point TEST_DATABASE_URL at one, or set THEWAIT_ALLOW_DESTRUCTIVE_TESTS=1.'
    );
  }
}
