import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { closePool } from './db/pool.js';
import { migrate } from './db/migrate.js';

/**
 * Boot: bring the schema up to date, then start listening.
 *
 * In that order deliberately. Serving requests against a database that has not
 * been migrated produces confusing per-request failures rather than one clear
 * one at startup, and a rolling deploy would show them to real users.
 */
async function start() {
  if (!config.databaseUrl) {
    console.error('[the-wait] DATABASE_URL is not set. See the README for a local database.');
    process.exit(1);
  }

  try {
    await migrate();
  } catch (error) {
    console.error(`[the-wait] could not prepare the database: ${error.message}`);
    process.exit(1);
  }

  const server = http.createServer(createApp());

  server.listen(config.port, config.host, () => {
    console.log(`The Wait is running on http://${config.host}:${config.port}`);
  });

  // Finish in-flight requests, then let go of the database.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(async () => {
        await closePool().catch(() => {});
        process.exit(0);
      });
    });
  }
}

start();
