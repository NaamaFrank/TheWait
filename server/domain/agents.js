import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  countAgentTokens,
  insertAgentToken,
  listAgentTokens,
  revokeAgentToken,
  useAgentToken
} from '../db/agents.repo.js';
import { accountIdFor } from './devices.js';
import { badRequest, HttpError, notFound } from '../http/errors.js';
import { optionalText } from './validate.js';

/**
 * Credentials for an agent that opens and closes waits for you.
 *
 * A Claude Code hook can start a wait when a prompt is sent and end it when
 * the turn finishes. That hook needs to authenticate, and the device id is
 * emphatically the wrong credential to hand it: it is the only thing the rest
 * of the API checks, it never expires, and it grants the whole account.
 *
 * These do two things - open a wait, close a wait - and nothing else. What
 * enforces that is the route allowlist in `server/http/router.js`, not this
 * module: a scope that is only written down in a comment is not a scope.
 */

/**
 * `twk_` then 32 random bytes.
 *
 * The prefix is for the humans and the secret scanners: a string that turns up
 * in a commit or a screenshot is recognisable as a credential, and grep-able
 * once someone realises it leaked.
 */
const PREFIX = 'twk_';
const TOKEN_BYTES = 32;

/** Enough for a laptop, a desktop and a couple of experiments. */
const MAX_TOKENS = 8;

/**
 * sha256, deliberately, where a password would want argon2.
 *
 * A password is short and guessable, so its hash must be slow. This is 256
 * bits of randomness: there is nothing to guess, and the only thing hashing
 * buys is that a copy of the table is not a copy of anybody's tokens. Making
 * it slow would only slow down every legitimate request.
 */
const hash = (token) => createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * Pulls a token out of an Authorization header.
 *
 * Its own scheme rather than `X-Device-Id`, so nothing that reads a device id
 * can ever be handed one of these by accident, and the other way round.
 */
export function tokenFromHeader(header) {
  if (typeof header !== 'string') return null;

  const [scheme, value] = header.split(' ');
  if (!/^bearer$/i.test(scheme ?? '') || !value?.startsWith(PREFIX)) return null;

  return value.trim();
}

/**
 * The account a token belongs to, or null. Records the use as it goes.
 *
 * Looked up by hash with a plain equality match, and that is genuinely fine
 * here: timing an equality comparison can only help someone who is already
 * able to guess most of the value, and there is nothing to guess - the token
 * is 256 bits of randomness and the thing being compared is its hash. A
 * constant-time compare on top would be ceremony, not security.
 */
export async function accountForToken(token) {
  if (typeof token !== 'string' || !token.startsWith(PREFIX)) return null;

  return useAgentToken(hash(token));
}

/* --- Management ----------------------------------------------------------- */

export async function createAgentToken(rawDeviceId, { label } = {}) {
  const accountId = await accountIdFor(rawDeviceId);
  const clean = optionalText(label, 'label', 60) ?? 'Claude Code';

  if ((await countAgentTokens(accountId)) >= MAX_TOKENS) {
    throw new HttpError(409, `That is ${MAX_TOKENS} already. Revoke one first.`);
  }

  const token = PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');

  const record = await insertAgentToken({
    id: randomUUID(),
    accountId,
    tokenHash: hash(token),
    label: clean
  });

  // The only time it is ever returned. Nothing stores it but the caller.
  return { agent: record, token };
}

export async function getAgentTokens(rawDeviceId) {
  return { agents: await listAgentTokens(await accountIdFor(rawDeviceId)) };
}

export async function removeAgentToken(rawDeviceId, id) {
  if (!id) throw badRequest('Which one?');

  const revoked = await revokeAgentToken(await accountIdFor(rawDeviceId), id);
  if (!revoked) throw notFound('No such connection.');

  return { agent: revoked };
}
