# Flow B — zkLogin Seal SessionKey self-decrypt & doctor consume — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flow B (patient self-decrypt + doctor consume) work for zkLogin/passkey users — not just browser wallet — by giving `PatientSession` a `signPersonalMessage` capability and routing both Flow B UIs through the active session.

**Architecture:** Two layers. (1) `PatientSession` gains `signPersonalMessage(message): Promise<{signature}>`, implemented per adapter (wallet delegates to dApp-Kit; zkLogin does ephemeral-sign + `getZkLoginSignature` with an up-front `maxEpoch >= currentEpoch` check; passkey signs via WebAuthn keypair). (2) `RecordList` / `ConsumePage` drop their hard-wired `useCurrentAccount` + `kit.signPersonalMessage` and read `getPatientSession()` instead. A shared `useAuthSession` hook + `<AuthControls>` component are extracted from `PatientShell` so `DoctorShell` can also offer zkLogin. Separately, `signAndGetObjectChanges` swaps its JSON-RPC `waitForTransaction` internals for the gRPC equivalent (migrating Flow A off JSON-RPC for free).

**Tech Stack:** React 18, `@mysten/dapp-kit-react`, `@mysten/sui` 2.16 (gRPC GA), `@mysten/seal`, `@tanstack/react-query`, vitest.

**Spec:** `docs/superpowers/specs/2026-05-31-flow-b-zklogin-seal-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/src/lib/patientSession.ts` | `PatientSession` interface + `WalletSession` + `signAndGetObjectChanges` | Modify: add `signPersonalMessage` to interface + `WalletSession`; swap `signAndGetObjectChanges` internals JSON-RPC→gRPC |
| `frontend/src/lib/zkLoginSession.ts` | zkLogin adapter | Modify: extract `getCurrentEpoch()`, add `signPersonalMessage` with epoch pre-check |
| `frontend/src/lib/passkeySession.ts` | passkey adapter | Modify: add `signPersonalMessage` |
| `frontend/src/lib/useAuthSession.ts` | shared session-resolution hook | **Create** (extracted from `PatientShell`) |
| `frontend/src/components/AuthControls.tsx` | shared header-right chrome (badge, copy, faucet, sign-out, ConnectButton) | **Create** |
| `frontend/src/patient/Shell.tsx` | patient shell | Modify: adopt hook + `<AuthControls>` |
| `frontend/src/patient/RecordList.tsx` | patient record list + self-decrypt | Modify: route through session |
| `frontend/src/doctor/Shell.tsx` | doctor shell | Modify: adopt hook + `<AuthControls>` + `<AuthLogin>` gate |
| `frontend/src/doctor/ConsumePage.tsx` | doctor consume + decrypt | Modify: route through session |
| `frontend/src/lib/patientSession.test.ts` | unit tests | Modify: update `signAndGetObjectChanges` mock to gRPC; add `WalletSession.signPersonalMessage` |
| `frontend/src/lib/zkLoginSession.test.ts` | unit tests | **Create**: `signPersonalMessage` sign+wrap + epoch pre-check |

**Working directory for all commands:** `/Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch/frontend`

**Test runner:** `npx vitest run <path>` · **Type-check:** `npx tsc --noEmit`

---

## Task 1: `PatientSession.signPersonalMessage` interface + `WalletSession` impl

**Files:**
- Modify: `frontend/src/lib/patientSession.ts`
- Test: `frontend/src/lib/patientSession.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/patientSession.test.ts`. First extend the existing `vi.mock('./dappKit', ...)` to expose a `signPersonalMessage` spy, then add a describe block. Replace the current mock block (lines 6-12) with:

```ts
const h = vi.hoisted(() => ({
  waitForTransaction: vi.fn(),
  signPersonalMessage: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('./dappKit', () => ({
  dAppKit: {
    stores: { $connection: { get: () => ({ account: null }) } },
    signPersonalMessage: h.signPersonalMessage,
    getClient: h.getClient,
  },
  suiJsonRpc: { waitForTransaction: h.waitForTransaction },
}));
```

Then add this describe block at the end of the file:

```ts
import { WalletSession } from './patientSession';

describe('WalletSession.signPersonalMessage', () => {
  beforeEach(() => h.signPersonalMessage.mockReset());

  it('delegates to dAppKit.signPersonalMessage and returns the signature', async () => {
    h.signPersonalMessage.mockResolvedValue({ signature: '0xsig', bytes: 'b' });
    const msg = new Uint8Array([1, 2, 3]);
    const res = await new WalletSession().signPersonalMessage(msg);

    expect(h.signPersonalMessage).toHaveBeenCalledWith({ message: msg });
    expect(res).toEqual({ signature: '0xsig' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/patientSession.test.ts`
Expected: FAIL — `new WalletSession().signPersonalMessage is not a function`

- [ ] **Step 3: Add `signPersonalMessage` to the interface and `WalletSession`**

In `frontend/src/lib/patientSession.ts`, add to the `PatientSession` interface (after the `signAndExecute` line):

```ts
export interface PatientSession {
  readonly authMethod: 'wallet' | 'zklogin' | 'passkey';
  getAddress(): string | null;
  signAndExecute(tx: Transaction): Promise<{ digest: string }>;
  /** Sign a Seal SessionKey personal message. Returns a serialized signature. */
  signPersonalMessage(message: Uint8Array): Promise<{ signature: string }>;
}
```

Add the method to `WalletSession` (after its `signAndExecute`):

```ts
  async signPersonalMessage(message: Uint8Array): Promise<{ signature: string }> {
    const { signature } = await dAppKit.signPersonalMessage({ message });
    return { signature };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/patientSession.test.ts`
Expected: PASS (the `signAndGetObjectChanges` tests will still pass — `h.getClient` is unused until Task 4)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/patientSession.ts frontend/src/lib/patientSession.test.ts
git commit -m "feat(session): add signPersonalMessage to PatientSession + WalletSession"
```

---

## Task 2: `ZkLoginSession.signPersonalMessage` + `maxEpoch` pre-check

**Files:**
- Modify: `frontend/src/lib/zkLoginSession.ts:106-123` (extract `getCurrentEpoch`), add method to `ZkLoginSession` class
- Test: `frontend/src/lib/zkLoginSession.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/zkLoginSession.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dappKit so importing zkLoginSession doesn't construct gRPC/Seal clients.
vi.mock('./dappKit', () => ({
  dAppKit: { getClient: vi.fn() },
}));

// Spy on the Ed25519 ephemeral signer + the zkLogin signature wrapper.
const h = vi.hoisted(() => ({
  signPersonalMessage: vi.fn(),
  getZkLoginSignature: vi.fn(() => 'ZK_WRAPPED_SIG'),
}));
vi.mock('@mysten/sui/keypairs/ed25519', () => ({
  Ed25519Keypair: {
    fromSecretKey: () => ({ signPersonalMessage: h.signPersonalMessage }),
  },
}));
vi.mock('@mysten/sui/zklogin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mysten/sui/zklogin')>()),
  getZkLoginSignature: h.getZkLoginSignature,
}));

import { ZkLoginSession, type ZkLoginSessionState, __setEpochFetcherForTest } from './zkLoginSession';

function state(maxEpoch: number): ZkLoginSessionState {
  return {
    address: '0xzk',
    proof: {
      proofPoints: { a: [], b: [[]], c: [] },
      issBase64Details: { value: 'v', indexMod4: 1 },
      headerBase64: 'h',
    },
    ephemeralSecretKey: 'suiprivkey1xxxx',
    maxEpoch,
    randomness: 'r',
    userSalt: '',
    addressSeed: '12345',
    sub: 'sub',
    iss: 'https://accounts.google.com',
    aud: 'aud',
    keyClaimName: 'sub',
  };
}

describe('ZkLoginSession.signPersonalMessage', () => {
  beforeEach(() => {
    h.signPersonalMessage.mockReset().mockResolvedValue({ signature: 'EPH_SIG' });
    h.getZkLoginSignature.mockClear();
  });

  it('ephemeral-signs and wraps via getZkLoginSignature when epoch is fresh', async () => {
    __setEpochFetcherForTest(async () => 10); // currentEpoch 10, maxEpoch 12 → valid
    const session = new ZkLoginSession(state(12));
    const res = await session.signPersonalMessage(new Uint8Array([9, 9]));

    expect(h.signPersonalMessage).toHaveBeenCalledWith(new Uint8Array([9, 9]));
    expect(h.getZkLoginSignature).toHaveBeenCalledWith(
      expect.objectContaining({ maxEpoch: '12', userSignature: 'EPH_SIG' }),
    );
    expect(res).toEqual({ signature: 'ZK_WRAPPED_SIG' });
  });

  it('fails fast with a friendly message when maxEpoch < currentEpoch', async () => {
    __setEpochFetcherForTest(async () => 20); // currentEpoch 20 > maxEpoch 12 → expired
    const session = new ZkLoginSession(state(12));
    await expect(session.signPersonalMessage(new Uint8Array([1]))).rejects.toThrow(
      /sign in with Google again/i,
    );
    expect(h.signPersonalMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/zkLoginSession.test.ts`
Expected: FAIL — `__setEpochFetcherForTest` is not exported / `signPersonalMessage` not a function

- [ ] **Step 3: Refactor epoch fetch + add the method**

In `frontend/src/lib/zkLoginSession.ts`, replace the `getMaxEpoch` block (lines 104-123) with an extracted current-epoch fetcher plus a test seam:

```ts
// ─────────────── epoch helper ────────────────────────────────────────────────

async function fetchCurrentEpochFromFullnode(): Promise<number> {
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
  const json = (await res.json()) as { result?: { epoch?: string } };
  return Number(json.result?.epoch ?? 0);
}

// Swappable in tests to avoid a live fullnode call.
let epochFetcher: () => Promise<number> = fetchCurrentEpochFromFullnode;
export function __setEpochFetcherForTest(fn: () => Promise<number>): void {
  epochFetcher = fn;
}

async function getCurrentEpoch(): Promise<number> {
  return epochFetcher();
}

async function getMaxEpoch(): Promise<number> {
  return (await getCurrentEpoch()) + 2; // valid for 2 more epochs
}
```

Then add the method to the `ZkLoginSession` class (after `signAndExecute`, before the closing brace). Note it imports `getZkLoginSignature` and `Ed25519Keypair` — both already imported at the top of the file:

```ts
  async signPersonalMessage(message: Uint8Array): Promise<{ signature: string }> {
    // Two independent clocks: the Seal SessionKey TTL and the zkLogin proof's
    // maxEpoch expire separately. If maxEpoch has passed, the key server rejects
    // the certificate even when the SessionKey looks fresh — fail fast.
    const currentEpoch = await getCurrentEpoch();
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/zkLoginSession.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/zkLoginSession.ts frontend/src/lib/zkLoginSession.test.ts
git commit -m "feat(zklogin): signPersonalMessage with maxEpoch pre-check"
```

---

## Task 3: `PasskeySession.signPersonalMessage`

**Files:**
- Modify: `frontend/src/lib/passkeySession.ts`
- Test: `frontend/src/lib/passkeySession.test.ts` (create)

> Passkey is not on the demo critical path (spec: "basic shape only"). One shape test.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/passkeySession.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('./dappKit', () => ({ dAppKit: { getClient: vi.fn() } }));
vi.mock('@mysten/sui/keypairs/passkey', () => ({
  BrowserPasskeyProvider: class {},
  PasskeyKeypair: class {},
  findCommonPublicKey: vi.fn(),
}));

import { PasskeySession } from './passkeySession';

describe('PasskeySession.signPersonalMessage', () => {
  it('delegates to the keypair and returns the signature', async () => {
    const keypair = {
      getPublicKey: () => ({ toSuiAddress: () => '0xpk' }),
      signPersonalMessage: vi.fn().mockResolvedValue({ signature: 'PK_SIG', bytes: 'b' }),
    };
    const session = new PasskeySession(keypair as never);
    const msg = new Uint8Array([7]);
    const res = await session.signPersonalMessage(msg);

    expect(keypair.signPersonalMessage).toHaveBeenCalledWith(msg);
    expect(res).toEqual({ signature: 'PK_SIG' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/passkeySession.test.ts`
Expected: FAIL — `session.signPersonalMessage is not a function`

- [ ] **Step 3: Add the method**

In `frontend/src/lib/passkeySession.ts`, add to the `PasskeySession` class (after `signAndExecute`):

```ts
  async signPersonalMessage(message: Uint8Array): Promise<{ signature: string }> {
    const { signature } = await this.keypair.signPersonalMessage(message);
    return { signature };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/passkeySession.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/passkeySession.ts frontend/src/lib/passkeySession.test.ts
git commit -m "feat(passkey): signPersonalMessage delegating to PasskeyKeypair"
```

---

## Task 4: Swap `signAndGetObjectChanges` internals JSON-RPC → gRPC

**Files:**
- Modify: `frontend/src/lib/patientSession.ts:62-77`
- Test: `frontend/src/lib/patientSession.test.ts` (rewrite the 3 existing `signAndGetObjectChanges` tests for the gRPC shape)

> Contract (`{digest; objectChanges:{type;objectType?;objectId?}[]}`) is unchanged — only the internal read swaps. This migrates Flow A off JSON-RPC for free. `queryRecordCreatedByPatient` (JSON-RPC `queryEvents`) stays — out of scope.

- [ ] **Step 1: Rewrite the failing test**

Replace the entire `describe('signAndGetObjectChanges', ...)` block in `frontend/src/lib/patientSession.test.ts` with a gRPC-shaped version. The gRPC `waitForTransaction({include:{effects,objectTypes}})` returns `{ $kind, Transaction: { effects: { changedObjects: [{objectId, idOperation}] }, objectTypes: Record<id,type> } }`:

```ts
describe('signAndGetObjectChanges (gRPC)', () => {
  beforeEach(() => {
    h.waitForTransaction.mockReset();
    h.getClient.mockReset();
    h.getClient.mockReturnValue({ waitForTransaction: h.waitForTransaction });
  });

  it('signs then maps created changedObjects + objectTypes into objectChanges', async () => {
    h.waitForTransaction.mockResolvedValue({
      $kind: 'Transaction',
      Transaction: {
        effects: {
          changedObjects: [
            { objectId: '0xrec', idOperation: 'Created' },
            { objectId: '0xgas', idOperation: 'None' },
          ],
        },
        objectTypes: {
          '0xrec': '0x2::record_anchor::RecordAnchor',
          '0xgas': '0x2::coin::Coin',
        },
      },
    });
    const session = fakeSession('0xdig');
    const res = await signAndGetObjectChanges(session, tx);

    expect(session.signAndExecute).toHaveBeenCalledWith(tx);
    expect(h.waitForTransaction).toHaveBeenCalledWith({
      digest: '0xdig',
      include: { effects: true, objectTypes: true },
    });
    expect(res.digest).toBe('0xdig');
    expect(res.objectChanges).toEqual([
      { type: 'created', objectType: '0x2::record_anchor::RecordAnchor', objectId: '0xrec' },
    ]);
  });

  it('returns empty objectChanges when effects have no created objects', async () => {
    h.waitForTransaction.mockResolvedValue({
      $kind: 'Transaction',
      Transaction: { effects: { changedObjects: [] }, objectTypes: {} },
    });
    const res = await signAndGetObjectChanges(fakeSession('0xd'), tx);
    expect(res.objectChanges).toEqual([]);
  });

  it('propagates a signing failure (no digest lookup)', async () => {
    const session: PatientSession = {
      authMethod: 'wallet',
      getAddress: () => '0xp',
      signAndExecute: vi.fn().mockRejectedValue(new Error('Transaction failed')),
      signPersonalMessage: vi.fn(),
    };
    await expect(signAndGetObjectChanges(session, tx)).rejects.toThrow('Transaction failed');
    expect(h.waitForTransaction).not.toHaveBeenCalled();
  });
});
```

Also update the `fakeSession` helper to satisfy the extended interface (add `signPersonalMessage`):

```ts
function fakeSession(digest: string): PatientSession {
  return {
    authMethod: 'zklogin',
    getAddress: () => '0xpatient',
    signAndExecute: vi.fn().mockResolvedValue({ digest }),
    signPersonalMessage: vi.fn(),
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/patientSession.test.ts`
Expected: FAIL — current impl calls `suiJsonRpc.waitForTransaction` with `options`, not `dAppKit.getClient().waitForTransaction` with `include`

- [ ] **Step 3: Swap the implementation to gRPC**

In `frontend/src/lib/patientSession.ts`, replace the `signAndGetObjectChanges` function body (lines 62-77) and update the import on line 15. New import:

```ts
import { dAppKit } from './dappKit';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
```

(Drop `suiJsonRpc` from the import — it is no longer used here. `queries.ts` keeps its own JSON-RPC client.)

New function:

```ts
/**
 * Sign+execute a tx via whichever auth method is active, then resolve the tx's
 * created objects via a gRPC `waitForTransaction` (NOT getTransaction — a bare
 * read immediately after execute can race the node's indexing and 404).
 * gRPC returns effects.changedObjects + a separate objectTypes map; we join them
 * back into the legacy { type:'created', objectType, objectId } shape so Flow A
 * (recordPipeline) and the doctor pipeline keep working unchanged.
 */
export async function signAndGetObjectChanges(
  session: PatientSession,
  tx: Transaction,
): Promise<{ digest: string; objectChanges: ObjectChange[] }> {
  const { digest } = await session.signAndExecute(tx);
  const grpc = dAppKit.getClient() as unknown as SuiGrpcClient;
  const res = await grpc.waitForTransaction({
    digest,
    include: { effects: true, objectTypes: true },
  });
  const txResult = res.Transaction;
  if (!txResult) {
    throw new Error('waitForTransaction returned no transaction effects');
  }
  const objectTypes = txResult.objectTypes ?? {};
  const objectChanges = (txResult.effects?.changedObjects ?? []).flatMap((c) =>
    c.idOperation === 'Created'
      ? [{ type: 'created', objectType: objectTypes[c.objectId], objectId: c.objectId }]
      : [],
  );
  return { digest, objectChanges };
}
```

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run src/lib/patientSession.test.ts && npx tsc --noEmit`
Expected: PASS (all patientSession tests) and zero TS errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/patientSession.ts frontend/src/lib/patientSession.test.ts
git commit -m "refactor(session): signAndGetObjectChanges uses gRPC waitForTransaction (migrate Flow A off JSON-RPC)"
```

---

## Task 5: `useAuthSession` hook (extract from `PatientShell`)

**Files:**
- Create: `frontend/src/lib/useAuthSession.ts`

> Pure extraction of `PatientShell`'s session-resolution logic so `DoctorShell` can reuse it. No behaviour change yet (PatientShell adopts it in Task 7).

- [ ] **Step 1: Create the hook**

Create `frontend/src/lib/useAuthSession.ts`:

```ts
/**
 * useAuthSession — shared auth-session resolution for patient + doctor shells.
 *
 * Encapsulates: synchronous ZkLoginSession.restore() on init, non-wallet address
 * state (zkLogin/passkey), merge with the connected browser-wallet address, and
 * a logout() that clears all three session kinds and reverts to WalletSession.
 */

import { useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { getPatientSession, setPatientSession, WalletSession } from './patientSession';
import { ZkLoginSession, clearZkLoginSession } from './zkLoginSession';
import { clearPasskeySession } from './passkeySession';

export interface AuthSession {
  authMethod: 'wallet' | 'zklogin' | 'passkey';
  activeAddress: string | null;
  isAuthenticated: boolean;
  /** True only for zkLogin/passkey (drives the custom badge/controls vs ConnectButton). */
  isNonWallet: boolean;
  /** AuthLogin onSessionReady callback. */
  onSessionReady: () => void;
  logout: () => void;
}

export function useAuthSession(): AuthSession {
  const walletAccount = useCurrentAccount();

  const [nonWalletAddress, setNonWalletAddress] = useState<string | null>(() => {
    const zk = ZkLoginSession.restore();
    if (zk) {
      setPatientSession(zk);
      return zk.getAddress();
    }
    return null;
  });

  function onSessionReady() {
    const s = getPatientSession();
    if (s.authMethod !== 'wallet') {
      setNonWalletAddress(s.getAddress());
    }
  }

  function logout() {
    clearZkLoginSession();
    clearPasskeySession();
    setPatientSession(new WalletSession());
    setNonWalletAddress(null);
  }

  const activeAddress = nonWalletAddress ?? walletAccount?.address ?? null;
  const session = getPatientSession();

  return {
    authMethod: session.authMethod,
    activeAddress,
    isAuthenticated: activeAddress !== null,
    isNonWallet: nonWalletAddress !== null,
    onSessionReady,
    logout,
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/useAuthSession.ts
git commit -m "feat(auth): extract useAuthSession hook (shared patient/doctor session logic)"
```

---

## Task 6: `<AuthControls>` shared header chrome

**Files:**
- Create: `frontend/src/components/AuthControls.tsx`

> The header-right block (auth badge, short address, copy button, faucet, sign-out) for non-wallet sessions, or `<ConnectButton>` for wallet. Lifted verbatim from `PatientShell` lines 49-141 (copy/faucet local state lives here now), driven by `useAuthSession`'s return.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/AuthControls.tsx`:

```tsx
import { useState } from 'react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import type { AuthSession } from '../lib/useAuthSession';

const NETWORK = (import.meta.env.VITE_SUI_NETWORK ?? 'testnet') as string;

export function AuthControls({ auth }: { auth: AuthSession }) {
  const [copied, setCopied] = useState(false);
  const [faucetStatus, setFaucetStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');

  const addr = auth.activeAddress;

  function handleCopyAddress() {
    if (!addr) return;
    navigator.clipboard.writeText(addr).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {/* clipboard blocked (insecure context / denied) — no-op */},
    );
  }

  async function handleFaucet() {
    if (!addr || NETWORK === 'mainnet') return;
    setFaucetStatus('pending');
    try {
      await requestSuiFromFaucetV2({
        host: getFaucetHost(NETWORK as 'testnet' | 'devnet' | 'localnet'),
        recipient: addr,
      });
      setFaucetStatus('done');
      setTimeout(() => setFaucetStatus('idle'), 4000);
    } catch {
      setFaucetStatus('error');
      setTimeout(() => setFaucetStatus('idle'), 4000);
    }
  }

  if (!auth.isNonWallet || !addr) {
    return <ConnectButton />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <span className="badge">
        {auth.authMethod === 'zklogin' ? 'Google (zkLogin)' : 'Passkey'}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
          {addr.slice(0, 6)}…{addr.slice(-4)}
        </span>
        <button
          onClick={handleCopyAddress}
          aria-label="Copy wallet address"
          title={copied ? 'Copied!' : 'Copy address'}
          className="btn-secondary"
          style={{ fontSize: 12, padding: '4px 6px', borderRadius: 6, lineHeight: 1 }}
        >
          {copied ? '✓' : '⧉'}
        </button>
        {NETWORK !== 'mainnet' && (
          <button
            onClick={handleFaucet}
            disabled={faucetStatus === 'pending'}
            aria-label="Request testnet SUI from faucet"
            title="Get testnet SUI for gas"
            className="btn-secondary"
            style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6 }}
          >
            {faucetStatus === 'pending'
              ? '⏳'
              : faucetStatus === 'done'
                ? '✓ Funded'
                : faucetStatus === 'error'
                  ? '⚠ Retry'
                  : '🚰 Faucet'}
          </button>
        )}
        <button
          onClick={auth.logout}
          className="btn-secondary"
          style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6 }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AuthControls.tsx
git commit -m "feat(auth): extract AuthControls shared header chrome"
```

---

## Task 7: `PatientShell` adopts `useAuthSession` + `<AuthControls>`

**Files:**
- Modify: `frontend/src/patient/Shell.tsx`

> Pure refactor — behaviour identical. Removes the no-op `useEffect` (spec) and the inlined copy/faucet logic now living in `AuthControls`.

- [ ] **Step 1: Rewrite `PatientShell`**

Replace the entire contents of `frontend/src/patient/Shell.tsx` with:

```tsx
import { Link, Outlet } from 'react-router-dom';
import { useAuthSession } from '../lib/useAuthSession';
import { AuthControls } from '../components/AuthControls';
import { AuthLogin } from './AuthLogin';

export function PatientShell() {
  const auth = useAuthSession();

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px' }}>
      <header className="header-container">
        <h1 className="logo-text">
          <Link to="/patient" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
            <img src="/anampouch_logo_transparent.png" alt="" style={{ width: 50, height: 50 }} />
            AnamPouch
          </Link>
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <AuthControls auth={auth} />
        </div>
      </header>

      {auth.isAuthenticated && (
        <nav style={{ marginBottom: 32, display: 'flex', gap: 8, background: 'var(--primary-soft)', padding: 6, borderRadius: 12, width: 'fit-content' }}>
          <Link to="/patient" className="nav-link">Records</Link>
          <Link to="/patient/new" className="nav-link">+ New visit</Link>
        </nav>
      )}

      <main>
        {auth.isAuthenticated ? (
          <div className="card" style={{ minHeight: 400 }}>
            <Outlet />
          </div>
        ) : (
          <AuthLogin onSessionReady={auth.onSessionReady} />
        )}
      </main>

      <footer style={{ marginTop: 64, padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, borderTop: '1px solid var(--border)' }}>
        <p>© 2026 AnamPouch — Your Health, Your Pouch.</p>
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + manual smoke**

Run: `npx tsc --noEmit`
Expected: zero errors.
Manual: `npm run dev`, open `/patient`, confirm wallet `ConnectButton` shows when logged out and the badge/copy/faucet/sign-out row shows after a zkLogin login (visual parity with before).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/patient/Shell.tsx
git commit -m "refactor(patient): PatientShell uses useAuthSession + AuthControls"
```

---

## Task 8: `RecordList` routes through the active session

**Files:**
- Modify: `frontend/src/patient/RecordList.tsx`

> Drop `useCurrentAccount` + `useDAppKit`. Read `getPatientSession()`. `PatientShell` gates rendering until authenticated, so the session/address is stable at render.

- [ ] **Step 1: Rewrite the imports + component head**

In `frontend/src/patient/RecordList.tsx`, replace the imports on lines 1-10 with:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { SealCompatibleClient } from '@mysten/seal';
import { queryRecordCreatedByPatient } from '../api/queries';
import { sealClient, suiJsonRpc, dAppKit } from '../lib/dappKit';
import { getPatientSession } from '../lib/patientSession';
import { viewOwnRecord, type ViewStage } from '../lib/patientPipeline';
import { explainMoveError } from '../lib/errors';
import type { ObjectId, SuiAddress } from '../types/contracts';
```

Replace the component head (lines 27-37) — drop the `account`/`kit` hooks, resolve the address from the session:

```tsx
export function RecordList() {
  const session = getPatientSession();
  const address = session.getAddress();
  const [expandedId, setExpandedId] = useState<ObjectId | null>(null);
  const [states, setStates] = useState<Record<string, ExpandState>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['records', address],
    enabled: !!address,
    queryFn: () => queryRecordCreatedByPatient(address as SuiAddress),
  });
```

- [ ] **Step 2: Rewrite `handleView` to use the session signer**

Replace the body of `handleView` (lines 39-65) — swap `account` → `address` and `kit.signPersonalMessage` → `session.signPersonalMessage`:

```tsx
  async function handleView(id: ObjectId) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (states[id]?.plaintext) return; // already decrypted, just expand

    if (!address) return;
    const update = (s: ExpandState) => setStates((prev) => ({ ...prev, [id]: s }));
    update({ stage: 'fetching' });
    try {
      const plaintext = await viewOwnRecord({
        recordId: id,
        address,
        signPersonalMessage: (msg) => session.signPersonalMessage(msg),
        suiClient: suiJsonRpc as any,
        sealCompatibleClient: dAppKit.getClient() as unknown as SealCompatibleClient,
        sealClient,
        onStage: (stage) => update({ stage }),
      });
      update({ stage: 'done', plaintext });
    } catch (e) {
      const friendly = explainMoveError(e);
      update({ stage: 'error', err: friendly.hint || (e as Error).message });
    }
  }
```

> Note: `viewOwnRecord`'s `signPersonalMessage` dep expects `(msg) => Promise<{signature}>` — `session.signPersonalMessage` matches exactly. Verify `viewOwnRecord`'s `SignPersonalMessageFn` type accepts `{signature: string}`; the wallet path previously passed dApp-Kit's `{signature, bytes}`, so a `{signature}`-only return is a structural subtype and type-checks.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors. If `viewOwnRecord` types the signer return more strictly than `{signature: string}`, widen the dep type in `patientPipeline.ts` to `Promise<{ signature: string }>` and re-run.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/patient/RecordList.tsx
git commit -m "feat(patient): RecordList decrypts via active session (zkLogin self-decrypt)"
```

---

## Task 9: `DoctorShell` adopts hook + `<AuthControls>` + `<AuthLogin>` gate

**Files:**
- Modify: `frontend/src/doctor/Shell.tsx`

> Doctor portal becomes auth-method-generic. `AuthLogin` only calls `onSessionReady`, so it is reused as-is. After login → render the consume outlet.

- [ ] **Step 1: Rewrite `DoctorShell`**

Replace the entire contents of `frontend/src/doctor/Shell.tsx` with:

```tsx
import { Link, Outlet } from 'react-router-dom';
import { useAuthSession } from '../lib/useAuthSession';
import { AuthControls } from '../components/AuthControls';
import { AuthLogin } from '../patient/AuthLogin';

export function DoctorShell() {
  const auth = useAuthSession();

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px' }}>
      <header className="header-container">
        <h1 className="logo-text">
          <Link to="/doctor" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 28 }}>🩺</span>
            AnamPouch <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: 16, marginLeft: 4 }}>Doctor Portal</span>
          </Link>
        </h1>
        <AuthControls auth={auth} />
      </header>

      <nav style={{ marginBottom: 32, display: 'flex', gap: 8, background: 'var(--primary-soft)', padding: 6, borderRadius: 12, width: 'fit-content' }}>
        <Link to="/doctor" className="nav-link">Consume Grant</Link>
        <Link to="/patient" className="nav-link">Patient App →</Link>
      </nav>

      <main>
        {auth.isAuthenticated ? (
          <div className="card" style={{ minHeight: 400 }}>
            <Outlet />
          </div>
        ) : (
          <AuthLogin onSessionReady={auth.onSessionReady} />
        )}
      </main>

      <footer style={{ marginTop: 64, padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, borderTop: '1px solid var(--border)' }}>
        <p>© 2026 AnamPouch — Secure Doctor Interface.</p>
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/doctor/Shell.tsx
git commit -m "feat(doctor): DoctorShell supports zkLogin via useAuthSession + AuthLogin gate"
```

---

## Task 10: `ConsumePage` routes through the active session (gRPC consume)

**Files:**
- Modify: `frontend/src/doctor/ConsumePage.tsx`

> Drop `useCurrentAccount`/`useDAppKit`. Use `getPatientSession()`. Replace the hand-rolled `kit.signAndExecuteTransaction` + JSON-RPC `waitForTransaction` + `objectChanges` scan with `signAndGetObjectChanges(session, consumeTx)` (gRPC internals from Task 4), then filter for the `DecryptionTicket`. SessionKey signing goes through `session.signPersonalMessage`.

- [ ] **Step 1: Rewrite imports + component head**

In `frontend/src/doctor/ConsumePage.tsx`, replace lines 1-11 with:

```tsx
import { useState } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { SessionKey, type SealCompatibleClient } from '@mysten/seal';
import { CONTRACT, CLOCK_OBJECT_ID, WALRUS, SEAL } from '../config/contract';
import { sealClient, suiJsonRpc, dAppKit } from '../lib/dappKit';
import { getPatientSession, signAndGetObjectChanges } from '../lib/patientSession';
import { buildConsumeGrantTx } from '../api/accessGrant';
import { decodeQrPayload } from '../lib/preimage';
import { fetchBlob } from '../lib/walrus';
import { explainMoveError } from '../lib/errors';
import type { ObjectId } from '../types/contracts';
```

Replace the hooks at the component head (lines 26-27):

```tsx
  const session = getPatientSession();
  const address = session.getAddress();
```

- [ ] **Step 2: Rewrite `handleDecrypt` consume + sign blocks**

Replace the guard and steps 2 & 4 inside `handleDecrypt`. First, the guard (line 39):

```tsx
    if (!address) return;
```

Replace step 2 (lines 56-77, `consume_grant` + JSON-RPC wait + manual ticket scan) with:

```tsx
      // 2. consume_grant — mints DecryptionTicket (gRPC internals, session-agnostic)
      setStage('consuming');
      const consumeTx = buildConsumeGrantTx({
        grantId: grantId.trim() as ObjectId,
        recordId,
        preimage,
      });
      const { objectChanges } = await signAndGetObjectChanges(session, consumeTx);
      const ticketChange = objectChanges.find(
        (c) =>
          c.type === 'created' &&
          typeof c.objectType === 'string' &&
          c.objectType.endsWith('::decryption_ticket::DecryptionTicket'),
      );
      if (!ticketChange?.objectId) throw new Error('DecryptionTicket not in tx effects');
      const ticketId = ticketChange.objectId as ObjectId;
```

Replace step 4 (lines 91-101, SessionKey via wallet) — swap `account.address` → `address`, `kit.signPersonalMessage` → `session.signPersonalMessage`:

```tsx
      // 4. SessionKey via the active session's personal_message signature
      setStage('session');
      const sessionKey = await SessionKey.create({
        address: address,
        packageId: CONTRACT.originalPackageId,
        ttlMin: SEAL.sessionTtlMs / 60_000,
        suiClient: dAppKit.getClient() as unknown as SealCompatibleClient,
      });
      const personalMsg = sessionKey.getPersonalMessage();
      const sig = await session.signPersonalMessage(personalMsg);
      sessionKey.setPersonalMessageSignature(sig.signature);
```

Finally, in step 5, replace `approveTx.setSender(account.address)` (line 118) with:

```tsx
      approveTx.setSender(address);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors. (`suiJsonRpc` is still imported — it is used in step 1 `getObject` for grant/record content, which stays JSON-RPC; do not remove it.)

- [ ] **Step 4: Run the full unit suite**

Run: `npx vitest run`
Expected: all pre-existing passing tests still pass (`patientPipeline`, `patientSession`, `zkLoginSession`, `passkeySession`); the known unrelated `redactor.test.ts` DOB failure may remain — note it, do not fix here.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/doctor/ConsumePage.tsx
git commit -m "feat(doctor): ConsumePage routes through active session + gRPC consume"
```

---

## Task 11: Monkey / manual end-to-end testing (per project test rule)

**Files:** none (manual + dev server)

> Project rule (`.claude/rules/test.md`): after unit/integration, do Monkey Testing — try to break it. These are manual demo-readiness checks; record results in `tasks/progress.md`.

- [ ] **Step 1: Restart dev server (env-safe)**

Run: `npm run dev` (Ctrl-C any stale server first — Vite inlines env at boot; see lessons 2026-05-02).

- [ ] **Step 2: Happy path — patient zkLogin self-decrypt**

Google login → `/patient` → create a record (Flow A) → click `👁 View` on it → confirm plaintext renders (key server accepts zkLogin SessionKey). This is the spike-proven path.

- [ ] **Step 3: Happy path — doctor zkLogin consume**

In the patient app, `Share via QR` to get grant ID + token. Open `/doctor`, Google login, paste both, `🔓 Decrypt Record` → confirm plaintext + traceability meta render. Confirm the consume tx resolves the ticket via gRPC (no JSON-RPC `waitForTransaction` call in the network tab for the consume step).

- [ ] **Step 4: Monkey — expired zkLogin session**

Simulate `maxEpoch < currentEpoch`: in devtools, edit `sessionStorage.zklogin_session` to set `maxEpoch` to a past value (e.g. `1`), then click `👁 View`. Expected: fast, friendly "Your Google session has expired. Please sign in with Google again." — **no** opaque key-server error, **no** white screen.

- [ ] **Step 5: Monkey — sign out mid-flow**

Start a decrypt, then click `Sign out` before it completes (or switch accounts). Expected: no crash, no unhandled rejection in console; UI returns to the login gate cleanly.

- [ ] **Step 6: Record results**

Append a session entry to `tasks/progress.md` (Recently Completed) summarizing pass/fail of steps 2-5 and any follow-ups.

---

## Self-Review notes (author checklist — completed)

- **Spec coverage:** Layer 1 (Tasks 1-3) ✓; Layer 2 UIs (Tasks 8, 10) ✓; shared abstraction (Tasks 5-7, 9) ✓; gRPC data layer (Task 4) ✓; error handling / epoch pre-check (Task 2) ✓; testing incl. Monkey (Tasks 1-4, 11) ✓. `queryEvents` explicitly out of scope — not touched ✓.
- **Type consistency:** `signPersonalMessage(message: Uint8Array): Promise<{signature: string}>` identical across interface + all 3 adapters + every call site; `signAndGetObjectChanges` return contract unchanged; `AuthSession` shape consumed identically by `AuthControls` + both shells.
- **Placeholder scan:** every code step contains full code; no TBD/"handle errors"/"similar to".
