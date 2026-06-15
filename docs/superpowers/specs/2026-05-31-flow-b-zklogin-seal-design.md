# Flow B — zkLogin Seal SessionKey self-decrypt & doctor consume

Date: 2026-05-31
Status: Approved design (pre-implementation)

## Problem

Flow B (patient self-decrypt via `seal_approve_owner`, and doctor consume via
`consume_grant` + `seal_approve`) only works for browser-wallet users. zkLogin
(and passkey) users cannot decrypt because the Seal `SessionKey` certificate
requires a personal-message signature, and the two Flow B UIs are hard-wired to
the wallet (`useCurrentAccount` + `kit.signPersonalMessage`), bypassing the
`PatientSession` abstraction entirely.

This was the top demo blocker (README Roadmap #1).

## Feasibility — confirmed by spike (2026-05-31)

A throwaway spike (`lib/spikeZkSeal.ts`, since deleted) constructed a zkLogin
personal-message signature from the persisted `zklogin_session` and ran the full
`viewOwnRecord` path against the **testnet Seal key server**. Result:

```
stage: fetching → session → decrypting → done
SUCCESS — key server accepted zkLogin SessionKey ✅
plaintext: "I have a headache"
```

**Conclusion: pure-frontend is feasible. No Enoki-signer / backend-decrypt
fallback needed.** The zkLogin personal-message signature is constructed
identically to the existing transaction path: ephemeral
`Ed25519Keypair.signPersonalMessage(msg)` → wrap with
`getZkLoginSignature({ inputs, maxEpoch, userSignature })`.

## Architecture — two layers

### Layer 1 — `PatientSession` gains a signing capability

Add to the `PatientSession` interface (`lib/patientSession.ts`):

```ts
signPersonalMessage(message: Uint8Array): Promise<{ signature: string }>;
```

Implement in all three adapters:

- **`WalletSession`** → delegate to `dAppKit.signPersonalMessage({ message })`.
- **`ZkLoginSession`** (`lib/zkLoginSession.ts`) → ephemeral
  `keypair.signPersonalMessage(msg)` + `getZkLoginSignature(...)` using the
  stored `proof`, `maxEpoch`, `addressSeed`. (Lift the proven spike logic into
  the class; mirrors `signAndExecute`.)
- **`PasskeySession`** (`lib/passkeySession.ts`) → WebAuthn keypair personal
  message signing. Implemented for completeness; **not on the demo critical
  path and not deeply tested this task** (demo path = wallet + zkLogin).

### Layer 2 — Flow B UIs route through the active session

`viewOwnRecord` and the doctor consume pipeline are already dependency-injected;
their core logic does **not** change. Only the injected signer/address source
changes.

| File | Current (wallet-only) | Change to |
|------|----------------------|-----------|
| `patient/RecordList.tsx` | `useCurrentAccount().address`, `kit.signPersonalMessage` | `getPatientSession().getAddress()`, `session.signPersonalMessage` |
| `doctor/ConsumePage.tsx` | `account.address`, `kit.signAndExecuteTransaction`, JSON-RPC `waitForTransaction`, `kit.signPersonalMessage` | `session.getAddress()`, `signAndGetObjectChanges(session, consumeTx)` (gRPC internals), `session.signPersonalMessage` |

`RecordList` follows the pattern already used by `RecordCreate`/`RecordShare`
(read `getPatientSession().getAddress()` at render; `PatientShell` gates
rendering until a session exists, so the address is stable). React-query keys
switch from the wallet account to the session address.

`ConsumePage`'s manual `kit.signAndExecuteTransaction` + JSON-RPC
`waitForTransaction` + `objectChanges` scan for the `DecryptionTicket` is
replaced by a **gRPC-native** created-object extraction (see "Data layer" below).

## Data flow

### Flow B-1 — patient self-decrypt (patient shell)

```
RecordList.handleView(id)
  session = getPatientSession()
  viewOwnRecord({
    recordId: id,
    address: session.getAddress(),
    signPersonalMessage: (msg) => session.signPersonalMessage(msg),   // only change
    suiClient, sealCompatibleClient, sealClient,                       // unchanged
  })
  → SessionKey(zkLogin sig) → seal_approve_owner PTB → key server → plaintext
```

### Flow B-2 — doctor consume (doctor shell)

```
ConsumePage.handleDecrypt()
  session = getPatientSession()
  consume_grant:  signAndGetObjectChanges(session, consumeTx) → ticketId  (gRPC internals)
  fetch blob via Walrus
  SessionKey:     sig = session.signPersonalMessage(sessionKey.getPersonalMessage())
  seal_approve(record, ticket, clock) PTB → key server → plaintext
  (all account.address → session.getAddress())
```

## Shared session abstraction (enables doctor zkLogin)

`doctor/Shell.tsx` and `ConsumePage` are currently wallet-only and lack the
`ZkLoginSession.restore()` + `setPatientSession` logic that `PatientShell` has.
To support zkLogin/passkey doctors, extract the shared logic rather than
duplicating it.

**1. `lib/useAuthSession.ts` hook** — lift the session-resolution logic out of
`PatientShell`:

```ts
function useAuthSession(): {
  session: PatientSession;
  activeAddress: string | null;
  isAuthenticated: boolean;
  authMethod: 'wallet' | 'zklogin' | 'passkey';
  onSessionReady(): void;   // AuthLogin callback
  logout(): void;
}
```

Contains: synchronous `ZkLoginSession.restore()` on init, `nonWalletAddress`
state, merge with `useCurrentAccount()` wallet address, `logout()` clearing all
three session types. Drops the no-op `useEffect` currently in `PatientShell`
(lines 28-33).

**2. `components/AuthControls.tsx`** — the header-right chrome (auth badge,
copy-address, faucet, sign-out, `ConnectButton`), driven by `useAuthSession`'s
return.

Apply:

- `PatientShell` → use hook + `<AuthControls>` (behaviour unchanged; pure extraction).
- `DoctorShell` → use hook + `<AuthControls>` + `<AuthLogin>` gate, replacing
  the current wallet-only `account ?` block. `AuthLogin` is already
  auth-method-generic (only calls `onSessionReady`), so it is reused as-is.

## Data layer — gRPC, no JSON-RPC for the Flow B tx path

Per Protocol 124, JSON-RPC (Quorum Driver) is being retired (removal targeted
April 2026). Flow B must not add new JSON-RPC dependencies. SDK is
`@mysten/sui` 2.16.0 (gRPC GA).

**Keep `signAndGetObjectChanges`'s signature and return contract** (`{ digest;
objectChanges: { type; objectType?; objectId? }[] }`) — it is shared by Flow A
(`RecordCreate` → `recordPipeline`) and the doctor pipeline, so the contract
must stay stable. **Swap only its internals** from JSON-RPC `waitForTransaction`
to gRPC:

```
const { digest } = await session.signAndExecute(tx)
const res = await grpc.waitForTransaction({   // NOT getTransaction — see note
  digest,
  include: { effects: true, objectTypes: true },
})
// map effects.changedObjects (idOperation === 'Created') + objectTypes map
// → existing shape: { type: 'created', objectType, objectId }
```

Use the gRPC-native **`waitForTransaction`** (exists on `SuiGrpcClient`'s
`BaseClient`, accepts `include`), **not** `getTransaction`: a bare
`getTransaction` immediately after execution can race the node's indexing and
404 — `waitForTransaction` blocks until the tx is queryable. This is the
gRPC equivalent of the JSON-RPC `waitForTransaction` it replaces.

This is one gRPC read replacing one JSON-RPC read — adapter-agnostic (works for
wallet, zkLogin, passkey alike) and migrates **Flow A off JSON-RPC for free**.
No pipeline interface changes. (Optional later optimization: have each adapter's
`signAndExecute` pass `include` so effects come back inline with the
`executeTransaction` result, eliminating the extra read entirely — deferred,
not required.)

`ConsumePage` switches from its hand-rolled `kit.signAndExecuteTransaction` +
JSON-RPC `waitForTransaction` to `signAndGetObjectChanges(session, consumeTx)`
and filters `objectChanges` for the `DecryptionTicket` type (same as
`doctorPipeline` already does).

**Explicitly NOT migrated (out of Flow B scope):** `queryRecordCreatedByPatient`
(`api/queries.ts`) uses JSON-RPC `queryEvents` — filter-by-event-type across
history, which gRPC does not expose. Its proper successor is GraphQL or a custom
indexer, tracked with the GrantRegistry/indexer roadmap item. The existing
JSON-RPC client in `dappKit.ts` / `queries.ts` remains only for this read.

## Error handling

- **zkLogin epoch expiry (HIGH — two independent clocks).** The Seal SessionKey
  TTL (`SEAL.sessionTtlMs`) and the zkLogin proof `maxEpoch` expire
  independently. If `maxEpoch < currentEpoch`, the key server rejects the
  zkLogin-signed certificate even when the SessionKey TTL still looks fresh —
  yielding an opaque mid-decrypt failure. `ZkLoginSession.signPersonalMessage`
  (and `signAndExecute`) MUST check `maxEpoch >= currentEpoch` up front and fail
  fast with "Please sign in with Google again." (Reuse the existing epoch fetch
  helper in `zkLoginSession.ts`.)
- Signer rejection (user declines): caught by the pipeline; existing
  `explainMoveError` in `RecordList`/`ConsumePage` is reused.
- Key-server rejection: not expected (spike proved acceptance); surfaced as-is
  if it ever occurs.

## Testing

- **Unit** (`lib/patientSession.test.ts` + `lib/zkLoginSession.test.ts`):
  - `ZkLoginSession.signPersonalMessage` — assert it ephemeral-signs and wraps
    via `getZkLoginSignature`, returning a serialized zkLogin signature.
  - `WalletSession.signPersonalMessage` — delegates to dAppKit (mock).
  - `PasskeySession.signPersonalMessage` — basic shape only.
- **Integration**: `viewOwnRecord` existing tests unchanged (signer is injected,
  source-agnostic).
- **Monkey / manual** (per project test rule):
  1. zkLogin login → patient self-decrypt (already passed via spike ✅).
  2. zkLogin login → doctor full share→consume.
  3. Decrypt with an **expired zkLogin session** (`maxEpoch` passed) → friendly
     "sign in again" error fired up front, no opaque key-server failure, no
     white screen.
  4. Switch account / sign out mid-decrypt → no crash.
- **gRPC effects parsing** (`signAndGetObjectChanges` internals): unit-test the
  `changedObjects` + `objectTypes` → `DecryptionTicket` extraction with a mocked
  gRPC `TransactionResult` (created/mutated/deleted mix; missing ticket → throws).

## Out of scope

- Real salt server (still the hackathon mock).
- Passkey deep testing.
- GrantRegistry / SuiNS / PWA (separate roadmap items).

## Files touched

- `lib/patientSession.ts` — interface + `WalletSession` method; swap
  `signAndGetObjectChanges` internals from JSON-RPC to gRPC `getTransaction`.
- `lib/zkLoginSession.ts` — `signPersonalMessage` method + `maxEpoch` pre-check.
- `lib/passkeySession.ts` — `signPersonalMessage` method.
- `lib/useAuthSession.ts` — new hook (extracted from `PatientShell`).
- `components/AuthControls.tsx` — new shared header chrome.
- `patient/Shell.tsx` — adopt hook + `AuthControls`.
- `patient/RecordList.tsx` — route through session.
- `doctor/Shell.tsx` — adopt hook + `AuthControls` + `AuthLogin` gate.
- `doctor/ConsumePage.tsx` — route through session.
- Tests: `lib/patientSession.test.ts`, `lib/zkLoginSession.test.ts`.
