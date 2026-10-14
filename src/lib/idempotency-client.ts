/**
 * Client-side idempotency key generation (Rules 097–098).
 *
 * The key is minted once per logical submit intent and reused across network
 * retries so the server can dedupe the mutation.
 */
export const IDEMPOTENCY_KEY_PREFIX = 'sp_idem_';

/** High-entropy, regex-safe key: `sp_idem_<uuidv4>` (44 chars, within 16–128). */
export function generateIdempotencyKey(prefix: string = IDEMPOTENCY_KEY_PREFIX): string {
  return `${prefix}${crypto.randomUUID()}`;
}
