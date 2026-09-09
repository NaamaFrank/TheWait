import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * A tiny append-friendly JSON collection persisted to a single file.
 *
 * Reads are served from an in-memory cache; writes are serialised through a
 * promise chain and land via write-to-temp + rename, so a crash mid-write can
 * never leave a truncated file behind. Suitable for a single-process app; swap
 * this module for a real database driver and nothing else has to change.
 */
export class JsonStore {
  #filePath;
  #records = null;
  #queue = Promise.resolve();

  constructor(filePath) {
    this.#filePath = filePath;
  }

  async #load() {
    if (this.#records) return this.#records;

    try {
      const raw = await fs.readFile(this.#filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.#records = Array.isArray(parsed) ? parsed : [];
    } catch {
      // Missing or corrupt file - start from an empty collection.
      this.#records = [];
    }

    return this.#records;
  }

  async #flush() {
    const tempPath = `${this.#filePath}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
    await fs.writeFile(tempPath, JSON.stringify(this.#records, null, 2), 'utf8');
    await fs.rename(tempPath, this.#filePath);
  }

  /** Runs `mutator(records)` exclusively, persists the result, and returns the mutator's value. */
  #transaction(mutator) {
    const run = this.#queue.then(async () => {
      const records = await this.#load();
      const result = await mutator(records);
      await this.#flush();
      return result;
    });

    // Keep the chain alive even if this transaction rejects.
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Returns a shallow copy, optionally filtered. */
  async all(predicate) {
    const records = await this.#load();
    return predicate ? records.filter(predicate) : records.slice();
  }

  async find(predicate) {
    const records = await this.#load();
    return records.find(predicate) ?? null;
  }

  /** Inserts at the head (newest first) and trims to `limit` matching records. */
  insert(record, { limit, scope } = {}) {
    return this.#transaction((records) => {
      records.unshift(record);

      if (limit && scope) {
        let seen = 0;
        for (let i = 0; i < records.length; i += 1) {
          if (!scope(records[i])) continue;
          seen += 1;
          if (seen > limit) records.splice(i--, 1);
        }
      }

      return record;
    });
  }

  /** Inserts when absent, otherwise merges `record` over the existing entry. */
  upsert(record, matcher) {
    return this.#transaction((records) => {
      const index = records.findIndex(matcher);

      if (index === -1) {
        records.unshift(record);
        return record;
      }

      records[index] = { ...records[index], ...record };
      return records[index];
    });
  }

  /** Removes every matching record and returns how many were dropped. */
  remove(predicate) {
    return this.#transaction((records) => {
      const before = records.length;

      for (let i = records.length - 1; i >= 0; i -= 1) {
        if (predicate(records[i])) records.splice(i, 1);
      }

      return before - records.length;
    });
  }
}
