import path from 'node:path';
import { config } from '../config.js';
import { JsonStore } from './json-store.js';

export const sessionStore = new JsonStore(path.join(config.dataDir, 'sessions.json'));
export const deviceStore = new JsonStore(path.join(config.dataDir, 'devices.json'));
