import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '127.0.0.1',
  rootDir: path.resolve(serverDir, '..'),
  publicDir: path.resolve(serverDir, '..', 'public'),
  dataDir: path.resolve(serverDir, '..', 'data'),

  /** Max accepted JSON request body. */
  maxBodyBytes: 256 * 1024,

  /** A presence heartbeat is considered live for this long. */
  presenceTtlMs: 90 * 1000,

  /** Upper bound on a single logged wait, guards against clock skew / bad clients. */
  maxSessionSeconds: 6 * 60 * 60,

  /** Sessions retained per device. */
  maxSessionsPerDevice: 500
};
