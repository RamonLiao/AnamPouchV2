/**
 * Contract addresses & module identifiers.
 * `PACKAGE_ID` is injected at build time from `.env.local` after `sui client publish`.
 * Run `pnpm gen:constants` after each redeploy to refresh.
 */

const PACKAGE_ID = import.meta.env?.VITE_PORTABLE_HEALTH_PACKAGE_ID
  ?? process.env.VITE_PORTABLE_HEALTH_PACKAGE_ID;

if (!PACKAGE_ID || PACKAGE_ID === '0x0') {
  throw new Error(
    'VITE_PORTABLE_HEALTH_PACKAGE_ID is unset. Deploy contracts and update .env.local.',
  );
}

// The FIRST (original) package id. Two things require it instead of the
// upgraded `published-at` id:
//   1. Seal: SessionKey.create / encrypt reject any package whose on-chain
//      version !== 1, so the IBE namespace must use the original id.
//   2. Sui struct type tags always carry the defining (original) package id and
//      never change across upgrades, so object-type filters must match it.
// Move CALL targets still use PACKAGE_ID (published-at) so upgraded functions
// like seal_approve_owner resolve. Falls back to PACKAGE_ID for fresh deploys
// that have never been upgraded (original === published-at).
const ORIGINAL_PACKAGE_ID =
  import.meta.env?.VITE_PORTABLE_HEALTH_ORIGINAL_ID
  ?? process.env.VITE_PORTABLE_HEALTH_ORIGINAL_ID
  ?? PACKAGE_ID;

export const CONTRACT = {
  packageId: PACKAGE_ID as `0x${string}`,
  /** First-version package id — for Seal namespace + object-type matching. */
  originalPackageId: ORIGINAL_PACKAGE_ID as `0x${string}`,
  modules: {
    recordAnchor: 'record_anchor',
    accessGrant: 'access_grant',
  },
  fns: {
    createAnchor: `${PACKAGE_ID}::record_anchor::create_anchor`,
    revokeAnchor: `${PACKAGE_ID}::record_anchor::revoke_anchor`,
    issueGrant: `${PACKAGE_ID}::access_grant::issue_grant`,
    consumeGrant: `${PACKAGE_ID}::access_grant::consume_grant`,
    revokeGrant: `${PACKAGE_ID}::access_grant::revoke_grant`,
    sealApprove: `${PACKAGE_ID}::record_anchor::seal_approve`,
    sealApproveOwner: `${PACKAGE_ID}::record_anchor::seal_approve_owner`,
  },
  // Event type tags carry the defining (original) package id and never change
  // across upgrades, so event-type filters must use ORIGINAL_PACKAGE_ID.
  events: {
    recordCreated: `${ORIGINAL_PACKAGE_ID}::record_anchor::RecordCreated`,
    recordRevoked: `${ORIGINAL_PACKAGE_ID}::record_anchor::RecordRevoked`,
    grantIssued: `${ORIGINAL_PACKAGE_ID}::access_grant::GrantIssued`,
    grantConsumed: `${ORIGINAL_PACKAGE_ID}::access_grant::GrantConsumed`,
    grantRevoked: `${ORIGINAL_PACKAGE_ID}::access_grant::GrantRevoked`,
  },
} as const;

export const CLOCK_OBJECT_ID = '0x6';

function parseThreshold(raw: string | undefined): number {
  const n = raw === undefined || raw === '' ? 2 : parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`VITE_SEAL_THRESHOLD must be a positive integer, got: ${raw}`);
  }
  return n;
}

export const SEAL = {
  keyServerUrls: (import.meta.env.VITE_SEAL_KEY_SERVERS ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  threshold: parseThreshold(import.meta.env.VITE_SEAL_THRESHOLD),
  sessionTtlMs: 5 * 60 * 1000,
};

export const WALRUS = {
  publisherUrl: import.meta.env.VITE_WALRUS_PUBLISHER ?? 'https://publisher.walrus-testnet.walrus.space',
  aggregatorUrl: import.meta.env.VITE_WALRUS_AGGREGATOR ?? 'https://aggregator.walrus-testnet.walrus.space',
};

export const GEMINI = {
  apiKey: import.meta.env.VITE_GEMINI_API_KEY ?? '',
  model: import.meta.env.VITE_GEMINI_MODEL ?? 'gemini-flash-latest',
};
