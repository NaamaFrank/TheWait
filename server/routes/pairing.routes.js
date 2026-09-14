import { config } from '../config.js';
import { readJsonBody } from '../http/body.js';
import { cancelPairingCodes, createPairingCode, redeemPairingCode } from '../domain/pairing.js';

/**
 * Linking devices.
 *
 * A code is only ever returned to the device that asked for it, and is never
 * logged: while it is live it is as good as the account it points at.
 */
export function registerPairingRoutes(router) {
  router.post('/api/pair', ({ deviceId }) => createPairingCode(deviceId));

  router.post('/api/pair/cancel', ({ deviceId }) => cancelPairingCodes(deviceId));

  router.post('/api/pair/claim', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    return redeemPairingCode(deviceId, body.code);
  });
}
