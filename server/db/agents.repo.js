import { query, queryOne } from './pool.js';

/** Tokens an agent uses to open and close waits. Only hashes are stored. */

function toToken(row) {
  if (!row) return null;

  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at
  };
}

export async function insertAgentToken({ id, accountId, tokenHash, label }) {
  return toToken(
    await queryOne(
      `INSERT INTO agent_tokens (id, account_id, token_hash, label)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, accountId, tokenHash, label]
    )
  );
}

/**
 * Finds the account a token belongs to, and records that it was used.
 *
 * Looked up by hash, so a token is never compared in the clear, and revoked
 * rows are excluded here rather than by the caller - forgetting that check at
 * one call site would make revocation decorative.
 */
export async function useAgentToken(tokenHash) {
  const row = await queryOne(
    `UPDATE agent_tokens SET last_used_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING *`,
    [tokenHash]
  );

  return row ? { id: row.id, accountId: row.account_id, label: row.label } : null;
}

export async function listAgentTokens(accountId) {
  const rows = await query(
    `SELECT * FROM agent_tokens
     WHERE account_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [accountId]
  );

  return rows.map(toToken);
}

export async function revokeAgentToken(accountId, id) {
  return toToken(
    await queryOne(
      `UPDATE agent_tokens SET revoked_at = now()
       WHERE account_id = $1 AND id = $2 AND revoked_at IS NULL
       RETURNING *`,
      [accountId, id]
    )
  );
}

export async function countAgentTokens(accountId) {
  const row = await queryOne(
    'SELECT count(*)::int AS n FROM agent_tokens WHERE account_id = $1 AND revoked_at IS NULL',
    [accountId]
  );

  return row?.n ?? 0;
}
