/**
 * Doctor deep-link helpers.
 *
 * Link format: `${origin}/doctor#g=<grantId>&t=<base64url token>`
 * Both params live in the URL *hash fragment* — fragments are never sent to
 * the server and never appear in Referer headers, keeping the single-use
 * decrypt token off server logs.
 *
 * The pending-consume sessionStorage stash bridges the zkLogin OAuth round-trip:
 * Google's implicit flow overwrites the fragment with `#id_token=...`, so we
 * capture our params BEFORE login and restore them after.
 */

const PENDING_KEY = 'anampouch_pending_consume';

export interface ConsumeParams {
  g: string; // AccessGrant object id
  t: string; // base64url one-time token (preimage)
}

export function buildConsumeLink(origin: string, grantId: string, token: string): string {
  return `${origin}/doctor#g=${encodeURIComponent(grantId)}&t=${encodeURIComponent(token)}`;
}

/** Parse a location.hash (with or without leading '#'). Returns null unless both g and t are present and non-empty. */
export function parseConsumeHash(hash: string): ConsumeParams | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const g = params.get('g');
  const t = params.get('t');
  if (!g || !t) return null;
  return { g, t };
}

export function stashPendingConsume(p: ConsumeParams): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
}

export function restorePendingConsume(): ConsumeParams | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as ConsumeParams;
    if (!p?.g || !p?.t) return null;
    return p;
  } catch {
    return null;
  }
}

export function clearPendingConsume(): void {
  sessionStorage.removeItem(PENDING_KEY);
}
