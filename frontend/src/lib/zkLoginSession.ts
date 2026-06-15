/**
 * zkLoginSession — Google OAuth + ZK proof adapter for PatientSession.
 *
 * Flow:
 *   1. generateEphemeralAndNonce() → store ephemeral keypair + randomness in
 *      sessionStorage, return Google OAuth URL with the nonce embedded.
 *   2. After OAuth redirect, call completeZkLogin(jwt) which:
 *      a. Fetches salt from Mysten salt server (TODO: replace with own server
 *         for production; currently uses demo hash of jwt.sub).
 *      b. Fetches ZK proof from the Mysten prover for the active network.
 *      c. Constructs a ZkLoginSession that can sign transactions.
 *
 * Hackathon shortcuts (documented):
 *   - SALT: deterministic mock derived from sub+aud via SHA-256 (no real salt
 *     server call). TODO(prod): call https://salt.api.mystenlabs.com/get_salt.
 *   - PROVER: calls Mysten's production prover on testnet/mainnet. The Google
 *     OAuth client id must be allowlisted by the prover.
 *   - GOOGLE_CLIENT_ID: read from VITE_ZKLOGIN_GOOGLE_CLIENT_ID or the legacy
 *     VITE_GOOGLE_CLIENT_ID. Production prover only supports allowlisted
 *     audiences; custom Google clients may require a matching prover override.
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  generateNonce,
  generateRandomness,
  getExtendedEphemeralPublicKey,
  getZkLoginSignature,
  jwtToAddress,
  decodeJwt,
  genAddressSeed,
  computeZkLoginAddressFromSeed,
} from '@mysten/sui/zklogin';
import type { Transaction } from '@mysten/sui/transactions';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { PatientSession } from './patientSession';
import { dAppKit } from './dappKit';

// ─────────────── constants ───────────────────────────────────────────────────

const NETWORK = (import.meta.env.VITE_SUI_NETWORK ?? 'testnet') as string;
const PROVER_URL =
  import.meta.env.VITE_ZKLOGIN_PROVER_URL ??
  (NETWORK === 'devnet'
    ? 'https://prover-dev.mystenlabs.com/v1'
    : 'https://prover.mystenlabs.com/v1');
const ZKLOGIN_ZKP_ENDPOINT =
  import.meta.env.VITE_ZKLOGIN_ZKP_ENDPOINT ?? '/api/zklogin/zkp';
const MYSTEN_DEMO_GOOGLE_CLIENT_ID =
  '25769832374-famecqrhe2gkebt5fvqms2263046lj96.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_ZKLOGIN_GOOGLE_CLIENT_ID ??
  import.meta.env.VITE_GOOGLE_CLIENT_ID ??
  MYSTEN_DEMO_GOOGLE_CLIENT_ID;

const SESSION_KEY = 'zklogin_ephemeral';

// ─────────────── storage helpers ─────────────────────────────────────────────

interface EphemeralStore {
  secretKey: string; // base64url-encoded 32-byte secret
  randomness: string;
  maxEpoch: number;
  nonce: string;
}

function saveEphemeral(store: EphemeralStore): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(store));
}

function loadEphemeral(): EphemeralStore | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as EphemeralStore) : null;
}

function clearEphemeral(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

// ─────────────── salt (hackathon stub) ───────────────────────────────────────

/**
 * Deterministic salt derived from sub+aud.
 * TODO(prod): replace with real salt server:
 *   POST https://salt.api.mystenlabs.com/get_salt { token: jwt }
 */
async function deriveUserSalt(sub: string, aud: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${sub}:${aud}:anampouch-demo-salt`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  // Reduce to a ~128-bit unsigned integer string (take first 16 bytes)
  let salt = BigInt(0);
  for (let i = 0; i < 16; i++) {
    salt = (salt << BigInt(8)) | BigInt(hashArray[i]!);
  }
  return salt.toString();
}

// ─────────────── epoch helper ────────────────────────────────────────────────

async function fetchCurrentEpochFromFullnode(): Promise<number> {
  // Fetch via jsonRpc because grpc latestCheckpointSequenceNumber ≠ epoch API.
  // Use a simple fetch to the fullnode REST epoch endpoint.
  const url =
    NETWORK === 'mainnet'
      ? 'https://fullnode.mainnet.sui.io'
      : NETWORK === 'devnet'
        ? 'https://fullnode.devnet.sui.io'
      : 'https://fullnode.testnet.sui.io';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getLatestSuiSystemState', params: [] }),
  });
  const json = await res.json() as { result?: { epoch?: string } };
  return Number(json.result?.epoch ?? 0);
}

// Swappable in tests to avoid a live fullnode call.
let epochFetcher: () => Promise<number> = fetchCurrentEpochFromFullnode;
export function __setEpochFetcherForTest(fn: () => Promise<number>): void {
  epochFetcher = fn;
}
export function __resetEpochFetcherForTest(): void {
  epochFetcher = fetchCurrentEpochFromFullnode;
}

async function getCurrentEpoch(): Promise<number> {
  return epochFetcher();
}

async function getMaxEpoch(): Promise<number> {
  return (await getCurrentEpoch()) + 2; // valid for 2 more epochs
}

// ─────────────── step 1: initiate login ──────────────────────────────────────

/**
 * Generate a fresh ephemeral keypair, persist it, and return the Google OAuth
 * redirect URL containing the zkLogin nonce.
 *
 * @param redirectUri  Where Google should redirect after auth. Defaults to
 *                     `window.location.origin + /zklogin/callback`.
 */
export async function initiateZkLogin(
  redirectUri?: string,
): Promise<{ authUrl: string }> {
  const maxEpoch = await getMaxEpoch();
  const keypair = new Ed25519Keypair();
  const randomness = generateRandomness();
  const nonce = generateNonce(keypair.getPublicKey(), maxEpoch, randomness);

  const store: EphemeralStore = {
    secretKey: keypair.getSecretKey(), // Bech32 suiprivkey... string
    randomness,
    maxEpoch,
    nonce,
  };
  saveEphemeral(store);

  const callbackUri =
    redirectUri ?? `${window.location.origin}/zklogin/callback`;

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: callbackUri,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
  });

  return { authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
}

// ─────────────── step 2: complete after OAuth callback ───────────────────────

export interface ZkLoginProof {
  proofPoints: {
    a: string[];
    b: string[][];
    c: string[];
  };
  issBase64Details: {
    value: string;
    indexMod4: number;
  };
  headerBase64: string;
  addressSeed?: string;
}

export interface ZkLoginSessionState {
  address: string;
  proof: ZkLoginProof;
  ephemeralSecretKey: string;
  maxEpoch: number;
  randomness: string;
  userSalt: string;
  addressSeed: string;
  sub: string;
  iss: string;
  aud: string;
  keyClaimName: string;
  jwtNonce?: string; // TEMP diag: the nonce baked into the JWT at proof time
  proverUrl?: string;
}

interface EnokiZkpResponse {
  data?: ZkLoginProof & { addressSeed: string };
}

const ZK_SESSION_STORAGE_KEY = 'zklogin_session';

function saveZkSession(state: ZkLoginSessionState): void {
  sessionStorage.setItem(ZK_SESSION_STORAGE_KEY, JSON.stringify(state));
}

function loadZkSession(): ZkLoginSessionState | null {
  const raw = sessionStorage.getItem(ZK_SESSION_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as ZkLoginSessionState) : null;
}

export function clearZkLoginSession(): void {
  sessionStorage.removeItem(ZK_SESSION_STORAGE_KEY);
  clearEphemeral();
}

/**
 * Call this after Google redirects back with an `id_token` in the URL fragment
 * (#id_token=...) or query param (?id_token=...).
 */
export async function completeZkLogin(jwt: string): Promise<ZkLoginSession> {
  const ephemeral = loadEphemeral();
  if (!ephemeral) {
    throw new Error('No ephemeral keypair found in sessionStorage. Did you call initiateZkLogin()?');
  }

  const keypair = Ed25519Keypair.fromSecretKey(ephemeral.secretKey);
  const decodedJwt = decodeJwt(jwt);

  const sub = decodedJwt.sub as string;
  const iss = decodedJwt.iss as string;
  const aud = Array.isArray(decodedJwt.aud)
    ? (decodedJwt.aud[0] as string)
    : (decodedJwt.aud as string);
  const jwtNonce = (decodedJwt as { nonce?: string }).nonce;
  if (jwtNonce !== ephemeral.nonce) {
    throw new Error('zkLogin nonce mismatch. Start Google sign-in again.');
  }

  const extEphPubKey = getExtendedEphemeralPublicKey(keypair.getPublicKey());

  const proof = await fetchZkProof({
    jwt,
    ephemeralPublicKey: extEphPubKey,
    maxEpoch: ephemeral.maxEpoch,
    randomness: ephemeral.randomness,
    aud,
  });

  const userSalt = proof.addressSeed ? '' : await deriveUserSalt(sub, aud);
  const addressSeed = proof.addressSeed ?? genAddressSeed(
    BigInt(userSalt),
    'sub',
    sub,
    aud,
  ).toString();
  const address = proof.addressSeed
    ? computeZkLoginAddressFromSeed(BigInt(addressSeed), iss, false)
    : jwtToAddress(jwt, userSalt, false);

  const state: ZkLoginSessionState = {
    address,
    proof,
    ephemeralSecretKey: ephemeral.secretKey,
    maxEpoch: ephemeral.maxEpoch,
    randomness: ephemeral.randomness,
    userSalt,
    addressSeed,
    sub,
    iss,
    aud,
    keyClaimName: 'sub',
    jwtNonce,
    proverUrl: proof.addressSeed ? ZKLOGIN_ZKP_ENDPOINT : PROVER_URL,
  };

  saveZkSession(state);
  clearEphemeral();

  return new ZkLoginSession(state);
}

async function fetchZkProof(args: {
  jwt: string;
  ephemeralPublicKey: string;
  maxEpoch: number;
  randomness: string;
  aud: string;
}): Promise<ZkLoginProof> {
  const zkpRes = await fetch(ZKLOGIN_ZKP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jwt: args.jwt,
      ephemeralPublicKey: args.ephemeralPublicKey,
      maxEpoch: args.maxEpoch,
      randomness: args.randomness,
      network: NETWORK,
    }),
  });

  if (zkpRes.ok) {
    const json = (await zkpRes.json()) as EnokiZkpResponse;
    if (!json.data) {
      throw new Error('Enoki ZKP response missing data');
    }
    return json.data;
  }

  // The proxy (Vercel fn / Vite dev middleware) always responds with JSON.
  // A JSON error body means the proxy ran but Enoki rejected the request —
  // surface Enoki's details instead of masking it with the public-prover path.
  // Only a non-JSON body (e.g. an HTML 404/SPA fallback) means the proxy route
  // is genuinely absent, in which case we try the public prover directly.
  const zkpErrText = await zkpRes.text();
  let proxyError: { error?: string; details?: string } | null = null;
  try {
    const parsed = JSON.parse(zkpErrText) as unknown;
    // Guard against bare scalars (JSON.parse('404') === 404): only an object body
    // is a real proxy/Enoki JSON error.
    if (parsed && typeof parsed === 'object') {
      proxyError = parsed as { error?: string; details?: string };
    }
  } catch {
    // non-JSON body (e.g. an HTML error page)
  }
  if (proxyError) {
    throw new Error(
      `Enoki ZKP error ${zkpRes.status}: ${proxyError.details ?? proxyError.error ?? zkpErrText}`,
    );
  }
  // Non-JSON body. Only a 404 means the proxy route is genuinely absent → retry
  // via the public prover. Any other status (e.g. an HTML 5xx from a gateway
  // outage) is a real failure we must surface, not silently reroute around the
  // server-side proxy.
  if (zkpRes.status !== 404) {
    throw new Error(`Enoki ZKP error ${zkpRes.status}: ${zkpErrText}`);
  }

  const userSalt = await deriveUserSalt(decodeJwt(args.jwt).sub, args.aud);
  const proofRes = await fetch(PROVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jwt: args.jwt,
      extendedEphemeralPublicKey: args.ephemeralPublicKey,
      maxEpoch: String(args.maxEpoch),
      jwtRandomness: args.randomness,
      salt: userSalt,
      keyClaimName: 'sub',
    }),
  });

  if (!proofRes.ok) {
    const errText = await proofRes.text();
    if (errText.includes('audience') && errText.includes('not supported')) {
      throw new Error(
        `ZK prover does not support Google client id ${args.aud}. Configure ENOKI_API_KEY on Vercel and add this Google client id to your Enoki app.`,
      );
    }
    throw new Error(`ZK prover error ${proofRes.status}: ${errText}`);
  }

  return (await proofRes.json()) as ZkLoginProof;
}

// ─────────────── PatientSession adapter ──────────────────────────────────────

export class ZkLoginSession implements PatientSession {
  readonly authMethod = 'zklogin' as const;
  private state: ZkLoginSessionState;

  constructor(state: ZkLoginSessionState) {
    this.state = state;
  }

  /** Restore a previously completed session from sessionStorage. Returns null if none. */
  static restore(): ZkLoginSession | null {
    const state = loadZkSession();
    return state ? new ZkLoginSession(state) : null;
  }

  getAddress(): string {
    return this.state.address;
  }

  private getAddressSeed(): string {
    if (this.state.addressSeed) return this.state.addressSeed;
    if (!this.state.userSalt) {
      throw new Error('zkLogin session is missing addressSeed. Sign in again.');
    }
    return genAddressSeed(
      BigInt(this.state.userSalt),
      this.state.keyClaimName,
      this.state.sub,
      this.state.aud,
    ).toString();
  }

  async signAndExecute(tx: Transaction): Promise<{ digest: string }> {
    const keypair = Ed25519Keypair.fromSecretKey(this.state.ephemeralSecretKey);
    const client = dAppKit.getClient() as unknown as import('@mysten/sui/grpc').SuiGrpcClient;

    // Build and sign tx bytes with the same ephemeral key used in the ZK proof.
    tx.setSenderIfNotSet(this.state.address);
    const { bytes: txBytesBase64, signature: ephemeralSig } = await tx.sign({
      client: client as unknown as ClientWithCoreApi,
      signer: keypair,
    });
    const txBytes = base64ToBytes(txBytesBase64);

    const addressSeed = this.getAddressSeed();

    const zkSignature = getZkLoginSignature({
      inputs: {
        proofPoints: this.state.proof.proofPoints,
        issBase64Details: this.state.proof.issBase64Details,
        headerBase64: this.state.proof.headerBase64,
        addressSeed,
      },
      maxEpoch: String(this.state.maxEpoch),
      userSignature: ephemeralSig,
    });

    const result = await client.executeTransaction({
      transaction: txBytes,
      signatures: [zkSignature],
    });

    if (result.$kind === 'FailedTransaction') {
      throw new Error('zkLogin transaction failed');
    }
    return { digest: result.Transaction.digest };
  }

  async signPersonalMessage(message: Uint8Array): Promise<{ signature: string }> {
    // Two independent clocks: the Seal SessionKey TTL and the zkLogin proof's
    // maxEpoch expire separately. If maxEpoch has passed, the key server rejects
    // the certificate even when the SessionKey looks fresh — fail fast.
    const currentEpoch = await getCurrentEpoch();
    // maxEpoch is the inclusive last valid epoch — still signable when equal
    if (this.state.maxEpoch < currentEpoch) {
      throw new Error('Your Google session has expired. Please sign in with Google again.');
    }

    const keypair = Ed25519Keypair.fromSecretKey(this.state.ephemeralSecretKey);
    const { signature: ephemeralSig } = await keypair.signPersonalMessage(message);

    const zkSignature = getZkLoginSignature({
      inputs: {
        proofPoints: this.state.proof.proofPoints,
        issBase64Details: this.state.proof.issBase64Details,
        headerBase64: this.state.proof.headerBase64,
        addressSeed: this.getAddressSeed(),
      },
      maxEpoch: String(this.state.maxEpoch),
      userSignature: ephemeralSig,
    });

    return { signature: zkSignature };
  }
}
